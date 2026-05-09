import { createRemoteGroceryProvider } from "@/lib/grocery-provider";
import type {
  DineoutRestaurantSuggestion,
  DineoutSlotSuggestion,
} from "@/lib/chat";

type ToolResultLike = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

function pickToolName(
  tools: Array<{ name: string }>,
  candidates: string[],
) {
  const lowered = new Map(
    tools.map((tool) => [tool.name.trim().toLowerCase(), tool.name]),
  );

  for (const candidate of candidates) {
    const exact = lowered.get(candidate.toLowerCase());
    if (exact) {
      return exact;
    }
  }

  return tools.find((tool) =>
    candidates.some((candidate) =>
      tool.name.toLowerCase().includes(candidate.toLowerCase()),
    ),
  )?.name;
}

function parseToolPayload(result: ToolResultLike) {
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object" &&
    !Array.isArray(result.structuredContent)
  ) {
    return result.structuredContent as Record<string, unknown>;
  }

  for (const item of result.content ?? []) {
    if (item.type !== "text" || !item.text) {
      continue;
    }

    const trimmed = item.text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringifyUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function assertSwiggyDineoutSuccess(result: ToolResultLike, context: string) {
  if (result.isError) {
    throw new Error(`${context} failed.`);
  }

  const payload = parseToolPayload(result);
  if (!payload) {
    throw new Error(`${context} returned an unreadable response.`);
  }

  if (payload.success === false) {
    const errorBlock = asRecord(payload.error);
    throw new Error(
      stringifyUnknown(errorBlock?.message) ?? `${context} failed.`,
    );
  }

  return payload;
}

function normalizeDineoutRestaurants(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const entries = Array.isArray(data.restaurants)
    ? data.restaurants
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.data)
        ? data.data
        : [];

  return entries
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      const id =
        stringifyUnknown(record.id) ??
        stringifyUnknown(record.restaurantId) ??
        stringifyUnknown(record.restaurant_id);
      const name =
        stringifyUnknown(record.name) ??
        stringifyUnknown(record.restaurantName) ??
        stringifyUnknown(record.restaurant_name);

      if (!id || !name) {
        return null;
      }

      const cuisines = Array.isArray(record.cuisines)
        ? record.cuisines.filter((item): item is string => typeof item === "string")
        : typeof record.cuisine === "string"
          ? [record.cuisine]
          : [];
      const highlights = Array.isArray(record.highlights)
        ? record.highlights
            .map((item) =>
              typeof item === "string"
                ? item
                : stringifyUnknown(asRecord(item)?.title) ??
                  stringifyUnknown(asRecord(item)?.text),
            )
            .filter((item): item is string => Boolean(item))
            .slice(0, 3)
        : [];
      const offer =
        stringifyUnknown(record.offerText) ??
        stringifyUnknown(record.offer) ??
        stringifyUnknown(asRecord(record.bestOffer)?.title) ??
        stringifyUnknown(asRecord(record.offerDetails)?.title);
      const availabilityRaw =
        stringifyUnknown(record.availability) ??
        stringifyUnknown(record.availabilityStatus) ??
        stringifyUnknown(record.bookingStatus) ??
        "";
      const availabilityUpper = availabilityRaw.toUpperCase();
      const availabilityStatus =
        availabilityUpper.includes("UNAVAILABLE") ||
        availabilityUpper.includes("CLOSED")
          ? "UNAVAILABLE"
          : availabilityUpper.includes("LIMIT")
            ? "LIMITED"
            : "AVAILABLE";

      return {
        id,
        name,
        cuisines,
        costForTwo:
          stringifyUnknown(record.costForTwo) ??
          stringifyUnknown(record.costForTwoText) ??
          (numberFromUnknown(record.costForTwoValue)
            ? `₹${numberFromUnknown(record.costForTwoValue)} for two`
            : "₹₹"),
        distance:
          stringifyUnknown(record.distanceText) ??
          (typeof record.distance === "number"
            ? `${record.distance.toFixed(1)} km`
            : "Nearby"),
        rating:
          typeof record.rating === "number"
            ? record.rating.toFixed(1)
            : stringifyUnknown(record.rating) ?? "N/A",
        availabilityStatus,
        highlights,
        offer: offer ?? null,
        ctaLabel: "See table slots",
      } satisfies DineoutRestaurantSuggestion;
    })
    .filter((item): item is DineoutRestaurantSuggestion => item !== null)
    .filter((item) => item.availabilityStatus !== "UNAVAILABLE");
}

function inferDineoutEntityType(query: string) {
  const lower = query.toLowerCase();
  if (
    lower.includes("pub") ||
    lower.includes("bar") ||
    lower.includes("brewery") ||
    lower.includes("cafe") ||
    lower.includes("buffet") ||
    lower.includes("lounge")
  ) {
    return "RESTAURANT_CATEGORY";
  }
  if (
    lower.includes("italian") ||
    lower.includes("chinese") ||
    lower.includes("biryani") ||
    lower.includes("sushi") ||
    lower.includes("thai") ||
    lower.includes("north indian") ||
    lower.includes("south indian")
  ) {
    return "CUISINE";
  }
  return null;
}

function normalizeDineoutSlots(
  payload: Record<string, unknown>,
  restaurantId: string,
  restaurantName: string,
  guestCount: number,
) {
  const data = asRecord(payload.data) ?? payload;
  const entries = Array.isArray(data.slots) ? data.slots : [];
  const slots: DineoutSlotSuggestion[] = [];

  for (const entry of entries) {
    const slot = asRecord(entry);
    if (!slot) {
      continue;
    }
    const deals = Array.isArray(slot.deals) ? slot.deals : [];
    const freeDeal =
      deals
        .map((deal) => asRecord(deal))
        .find(
          (deal) =>
            deal &&
            (deal.isFree === true ||
              numberFromUnknown(deal.bookingPrice) === 0 ||
              numberFromUnknown(deal.displayFee) === 0),
        ) ?? null;
    if (!freeDeal) {
      continue;
    }

    const slotId =
      stringifyUnknown(freeDeal.slotId) ??
      stringifyUnknown(slot.slotId) ??
      stringifyUnknown(slot.id);
    const timeLabel =
      stringifyUnknown(slot.displayTime) ??
      stringifyUnknown(slot.time) ??
      stringifyUnknown(slot.slotTime);
    const dateLabel =
      stringifyUnknown(slot.dateStr) ??
      stringifyUnknown(slot.date);
    if (!slotId || !timeLabel || !dateLabel) {
      continue;
    }

    slots.push({
      id: `${restaurantId}:${slotId}`,
      slotId,
      restaurantId,
      restaurantName,
      dateLabel,
      timeLabel,
      slotGroupName: stringifyUnknown(slot.slotGroupName) ?? "Dining",
      guestCount,
      dealTitle:
        stringifyUnknown(freeDeal.title) ??
        stringifyUnknown(freeDeal.dealTitle) ??
        undefined,
      ctaLabel: "Book this table",
    });
  }

  return slots.slice(0, 8);
}

function extractBooking(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const restaurantName =
    stringifyUnknown(data.restaurantName) ??
    stringifyUnknown(data.restaurant_name) ??
    "Restaurant";
  const status =
    stringifyUnknown(data.status) ??
    stringifyUnknown(data.bookingStatus) ??
    "CONFIRMED";
  const dateLabel =
    stringifyUnknown(data.date) ??
    stringifyUnknown(data.bookingDate) ??
    stringifyUnknown(data.dateStr) ??
    "Today";
  const timeLabel =
    stringifyUnknown(data.time) ??
    stringifyUnknown(data.displayTime) ??
    stringifyUnknown(data.slotTime) ??
    "Selected slot";

  return {
    bookingId:
      stringifyUnknown(data.bookingId) ??
      stringifyUnknown(data.id) ??
      "",
    restaurantName,
    bookingStatus: status,
    dateLabel,
    timeLabel,
    guestCount:
      numberFromUnknown(data.guestCount) ??
      numberFromUnknown(data.guests) ??
      2,
    dealTitle:
      stringifyUnknown(data.dealTitle) ??
      stringifyUnknown(data.offerTitle) ??
      undefined,
    addressLine:
      stringifyUnknown(data.address) ??
      stringifyUnknown(data.restaurantAddress) ??
      undefined,
  };
}

export const swiggyDineoutProvider = createRemoteGroceryProvider({
  id: "swiggy-dineout",
  label: "Swiggy Dineout",
  serverUrl: "https://mcp.swiggy.com/dineout",
  searchToolCandidates: ["search_restaurants_dineout"],
  addressesToolCandidates: ["get_saved_locations"],
  authScope: "mcp:tools",
  supportsRefreshToken: false,
  proactiveReauthWindowMs: 60_000,
  disconnect: async ({ state }) => {
    const accessToken =
      state.tokens &&
      typeof state.tokens === "object" &&
      "access_token" in state.tokens &&
      typeof state.tokens.access_token === "string"
        ? state.tokens.access_token
        : null;

    if (!accessToken) {
      return;
    }

    await fetch("https://mcp.swiggy.com/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },
  searchDineoutRestaurantsWithClient: async ({
    client,
    tools,
    query,
    addressId,
    latitude,
    longitude,
    entityType,
  }) => {
    const searchTool = pickToolName(tools, ["search_restaurants_dineout"]);
    if (!searchTool) {
      throw new Error("Swiggy Dineout search_restaurants_dineout tool is unavailable.");
    }

    const result = await client.callTool({
      name: searchTool,
      arguments: addressId
        ? {
            query,
            addressId,
            ...(entityType ? { entityType } : {}),
          }
        : {
            query,
            ...(typeof latitude === "number" ? { latitude } : {}),
            ...(typeof longitude === "number" ? { longitude } : {}),
            ...(entityType ?? inferDineoutEntityType(query)
              ? { entityType: entityType ?? inferDineoutEntityType(query) }
              : {}),
          },
    });
    const payload = assertSwiggyDineoutSuccess(
      result,
      "Swiggy Dineout search_restaurants_dineout",
    );
    const restaurants = normalizeDineoutRestaurants(payload);

    if (!restaurants.length) {
      throw new Error(`I could not find any bookable Dineout restaurants for ${query}.`);
    }

    return { restaurants: restaurants.slice(0, 6) };
  },
  debugSearchWithClient: async ({
    client,
    tools,
    query,
    addressId,
    latitude,
    longitude,
    entityType,
  }) => {
    const searchTool = pickToolName(tools, ["search_restaurants_dineout"]);
    if (!searchTool) {
      throw new Error("Swiggy Dineout search_restaurants_dineout tool is unavailable.");
    }

    const inferredEntityType = entityType ?? inferDineoutEntityType(query);
    const result = await client.callTool({
      name: searchTool,
      arguments: addressId
        ? {
            query,
            addressId,
            ...(inferredEntityType ? { entityType: inferredEntityType } : {}),
          }
        : {
            query,
            ...(typeof latitude === "number" ? { latitude } : {}),
            ...(typeof longitude === "number" ? { longitude } : {}),
            ...(inferredEntityType ? { entityType: inferredEntityType } : {}),
          },
    });

    const payload = assertSwiggyDineoutSuccess(
      result,
      "Swiggy Dineout search_restaurants_dineout",
    );
    const restaurants = normalizeDineoutRestaurants(payload);

    return {
      payload,
      normalized: restaurants,
      meta: {
        query,
        addressId,
        latitude,
        longitude,
        entityType: inferredEntityType ?? null,
        searchTool,
        restaurantCount: restaurants.length,
      },
    };
  },
  getDineoutSlotsWithClient: async ({
    client,
    tools,
    restaurantId,
    restaurantName,
    guestCount,
    latitude,
    longitude,
  }) => {
    const slotsTool = pickToolName(tools, ["get_available_slots"]);
    if (!slotsTool) {
      throw new Error("Swiggy Dineout get_available_slots tool is unavailable.");
    }

    const result = await client.callTool({
      name: slotsTool,
      arguments: {
        restaurantId,
        date: new Date().toISOString().slice(0, 10),
        guestCount,
        latitude,
        longitude,
      },
    });
    const payload = assertSwiggyDineoutSuccess(
      result,
      "Swiggy Dineout get_available_slots",
    );
    const slots = normalizeDineoutSlots(payload, restaurantId, restaurantName, guestCount);

    if (!slots.length) {
      throw new Error(`I could not find any free table slots for ${restaurantName} right now.`);
    }

    return {
      restaurantId,
      restaurantName,
      slots,
    };
  },
  bookDineoutTableWithClient: async ({
    client,
    tools,
    restaurantId,
    slotId,
    guestCount,
  }) => {
    const bookTool = pickToolName(tools, ["book_table"]);
    if (!bookTool) {
      throw new Error("Swiggy Dineout book_table tool is unavailable.");
    }

    const result = await client.callTool({
      name: bookTool,
      arguments: {
        restaurantId,
        slotId,
        guestCount,
      },
    });
    const payload = assertSwiggyDineoutSuccess(result, "Swiggy Dineout book_table");
    const booking = extractBooking(payload);
    if (!booking.bookingId) {
      throw new Error("Swiggy Dineout did not return a booking id.");
    }
    return booking;
  },
  getDineoutBookingStatusWithClient: async ({ client, tools, bookingId }) => {
    const statusTool = pickToolName(tools, ["get_booking_status"]);
    if (!statusTool) {
      throw new Error("Swiggy Dineout get_booking_status tool is unavailable.");
    }

    const result = await client.callTool({
      name: statusTool,
      arguments: { bookingId },
    });
    const payload = assertSwiggyDineoutSuccess(
      result,
      "Swiggy Dineout get_booking_status",
    );
    const booking = extractBooking(payload);
    if (!booking.bookingId) {
      booking.bookingId = bookingId;
    }
    return booking;
  },
});
