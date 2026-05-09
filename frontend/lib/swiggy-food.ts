import { createRemoteGroceryProvider } from "@/lib/grocery-provider";
import type { CartItem, RestaurantSuggestion, TrackingUpdate } from "@/lib/chat";

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

function assertSwiggyFoodSuccess(result: ToolResultLike, context: string) {
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

function normalizeRestaurants(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const entries = Array.isArray(data.restaurants)
    ? data.restaurants
    : Array.isArray(data.results)
      ? data.results
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

      const availabilityStatus =
        stringifyUnknown(record.availabilityStatus) === "CLOSED" ||
        stringifyUnknown(record.availabilityStatus) === "UNAVAILABLE"
          ? (stringifyUnknown(record.availabilityStatus) as "CLOSED" | "UNAVAILABLE")
          : "OPEN";

      const etaText =
        stringifyUnknown(record.deliveryTime) ??
        stringifyUnknown(record.deliveryTimeText) ??
        stringifyUnknown(record.eta) ??
        "30-40 min";
      const distanceText =
        stringifyUnknown(record.distanceText) ??
        (typeof record.distanceKm === "number"
          ? `${record.distanceKm.toFixed(1)} km`
          : "Nearby");
      const ratingText =
        typeof record.rating === "number"
          ? record.rating.toFixed(1)
          : stringifyUnknown(record.rating) ?? "N/A";
      const costForTwo =
        stringifyUnknown(record.costForTwo) ??
        stringifyUnknown(record.costForTwoText) ??
        stringifyUnknown(record.priceForTwo) ??
        stringifyUnknown(record.priceForTwoMessage);
      const aggregatedDiscountInfo = asRecord(record.aggregatedDiscountInfo);
      const aggregatedDiscountInfoV3 = asRecord(record.aggregatedDiscountInfoV3);
      const shortDescriptionList = Array.isArray(
        aggregatedDiscountInfo?.shortDescriptionList,
      )
        ? aggregatedDiscountInfo.shortDescriptionList
        : [];
      const firstShortDescription =
        shortDescriptionList.find((entry) => typeof entry === "string") ?? null;
      const offer =
        stringifyUnknown(record.offerText) ??
        stringifyUnknown(record.offer) ??
        stringifyUnknown(record.discountText) ??
        stringifyUnknown(firstShortDescription) ??
        stringifyUnknown(aggregatedDiscountInfoV3?.subHeader) ??
        stringifyUnknown(aggregatedDiscountInfoV3?.header);
      const highlights = [
        stringifyUnknown(record.badgeText),
        stringifyUnknown(record.promotedText),
        stringifyUnknown(record.ribbonText),
        stringifyUnknown(record.slaString),
      ].filter((entry): entry is string => Boolean(entry));

      return {
        id,
        name,
        cuisines,
        eta: etaText,
        etaMinutes: numberFromUnknown(etaText),
        distance: distanceText,
        distanceKm:
          numberFromUnknown(record.distanceKm) ?? numberFromUnknown(distanceText),
        rating: ratingText,
        availabilityStatus,
        costForTwo,
        offer,
        highlights,
        ctaLabel: "Choose restaurant",
      } satisfies RestaurantSuggestion;
    })
    .filter((item): item is RestaurantSuggestion => item !== null);
}

function tokenizeDish(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreDishMatch(name: string, query: string) {
  const nameTokens = new Set(tokenizeDish(name));
  const queryTokens = tokenizeDish(query);
  let score = 0;
  for (const token of queryTokens) {
    if (nameTokens.has(token)) {
      score += 3;
    }
    if (name.toLowerCase().includes(token)) {
      score += 1;
    }
  }
  return score;
}

type MenuItemSelection = {
  itemId: string;
  name: string;
  quantityLabel: string;
  price: number;
  cartItem: Record<string, unknown>;
};

function pickFirstVariation(item: Record<string, unknown>) {
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const first = variations.find((entry) => asRecord(entry));
  const variation = asRecord(first);
  if (!variation) {
    return null;
  }

  const variationId =
    stringifyUnknown(variation.id) ??
    stringifyUnknown(variation.variationId) ??
    stringifyUnknown(variation.variantId);
  const groupId =
    stringifyUnknown(variation.groupId) ??
    stringifyUnknown(variation.variationGroupId);

  if (!variationId) {
    return null;
  }

  return {
    cartField: [
      {
        variationId,
        ...(groupId ? { groupId } : {}),
      },
    ],
    quantityLabel:
      stringifyUnknown(variation.name) ??
      stringifyUnknown(variation.displayName) ??
      "1 serving",
    price:
      numberFromUnknown(variation.price) ??
      numberFromUnknown(asRecord(variation.price)?.value) ??
      null,
  };
}

function pickFirstVariantV2(item: Record<string, unknown>) {
  const variants = Array.isArray(item.variantsV2) ? item.variantsV2 : [];
  const first = variants.find((entry) => asRecord(entry));
  const variant = asRecord(first);
  if (!variant) {
    return null;
  }

  const variantId =
    stringifyUnknown(variant.id) ??
    stringifyUnknown(variant.variantId);
  if (!variantId) {
    return null;
  }

  return {
    cartField: [
      {
        variantId,
      },
    ],
    quantityLabel:
      stringifyUnknown(variant.name) ??
      stringifyUnknown(variant.displayName) ??
      "1 serving",
    price:
      numberFromUnknown(variant.price) ??
      numberFromUnknown(asRecord(variant.price)?.value) ??
      null,
  };
}

function pickMenuItem(payload: Record<string, unknown>, query: string) {
  const data = asRecord(payload.data) ?? payload;
  const entries = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.results)
      ? data.results
      : [];

  const rankedSelections: Array<{
    score: number;
    selection: MenuItemSelection;
  } | null> = entries
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) {
        return null;
      }

      const itemId =
        stringifyUnknown(item.id) ??
        stringifyUnknown(item.itemId);
      const name =
        stringifyUnknown(item.name) ??
        stringifyUnknown(item.itemName);
      if (!itemId || !name) {
        return null;
      }

      const variation = pickFirstVariation(item);
      const variantV2 = pickFirstVariantV2(item);
      const basePrice = numberFromUnknown(item.price) ?? 0;

      if (variation) {
        return {
          score: scoreDishMatch(name, query),
          selection: {
            itemId,
            name,
            quantityLabel: variation.quantityLabel,
            price: variation.price ?? basePrice,
            cartItem: {
              itemId,
              quantity: 1,
              variations: variation.cartField,
            },
          } satisfies MenuItemSelection,
        };
      }

      if (variantV2) {
        return {
          score: scoreDishMatch(name, query),
          selection: {
            itemId,
            name,
            quantityLabel: variantV2.quantityLabel,
            price: variantV2.price ?? basePrice,
            cartItem: {
              itemId,
              quantity: 1,
              variantsV2: variantV2.cartField,
            },
          } satisfies MenuItemSelection,
        };
      }

      return {
        score: scoreDishMatch(name, query),
        selection: {
          itemId,
          name,
          quantityLabel: "1 serving",
          price: basePrice,
          cartItem: {
            itemId,
            quantity: 1,
          },
        } satisfies MenuItemSelection,
      };
    })
    .filter((entry) => entry !== null);

  const validSelections = rankedSelections.filter(
    (
      entry,
    ): entry is {
      score: number;
      selection: MenuItemSelection;
    } => entry !== null,
  );

  return validSelections.sort((left, right) => right.score - left.score)[0]?.selection ?? null;
}

function extractFoodCart(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const entries = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.cartItems)
      ? data.cartItems
      : [];

  const items: CartItem[] = entries
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) {
        return null;
      }
      const id =
        stringifyUnknown(item.id) ??
        stringifyUnknown(item.itemId) ??
        stringifyUnknown(item.cartItemId);
      const name =
        stringifyUnknown(item.name) ??
        stringifyUnknown(item.itemName);
      const quantity =
        typeof item.quantity === "number"
          ? `${item.quantity} x`
          : stringifyUnknown(item.quantityLabel) ?? "1 x";
      const price =
        numberFromUnknown(item.price) ??
        numberFromUnknown(item.totalPrice) ??
        0;
      if (!id || !name) {
        return null;
      }
      return {
        id,
        name,
        quantity,
        price: Math.round(price),
      } satisfies CartItem;
    })
    .filter((item): item is CartItem => item !== null);

  const availablePaymentMethods = Array.isArray(data.availablePaymentMethods)
    ? data.availablePaymentMethods
        .map((entry) => stringifyUnknown(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  return {
    restaurantName:
      stringifyUnknown(data.restaurantName) ??
      stringifyUnknown(data.restaurant_name) ??
      "Restaurant",
    addressLine:
      stringifyUnknown(data.deliveryAddressText) ??
      stringifyUnknown(data.deliveryAddress) ??
      stringifyUnknown(data.addressText) ??
      "Selected address",
    items,
    subtotal:
      numberFromUnknown(data.subtotal) ??
      numberFromUnknown(data.itemTotal) ??
      items.reduce((sum, item) => sum + item.price, 0),
    fees:
      numberFromUnknown(data.deliveryFee) ??
      numberFromUnknown(data.fees) ??
      numberFromUnknown(data.chargesTotal) ??
      0,
    total:
      numberFromUnknown(data.total) ??
      numberFromUnknown(data.grandTotal) ??
      numberFromUnknown(data.payableAmount) ??
      items.reduce((sum, item) => sum + item.price, 0),
    availablePaymentMethods,
  };
}

function buildFoodTrackingUpdates(stage: "confirmed" | "packing" | "on-the-way"): TrackingUpdate[] {
  const steps = [
    {
      id: "food-track-1",
      label: "Order confirmed",
      detail: "The restaurant accepted your food order.",
    },
    {
      id: "food-track-2",
      label: "Preparing food",
      detail: "The kitchen is preparing your dish.",
    },
    {
      id: "food-track-3",
      label: "On the way",
      detail: "Your rider is on the way with the order.",
    },
  ];

  const completedCount =
    stage === "confirmed" ? 1 : stage === "packing" ? 2 : 3;

  return steps.map((step, index) => ({
    ...step,
    complete: index < completedCount,
  }));
}

function extractFoodTracking(payload: Record<string, unknown>, orderId: string) {
  const data = asRecord(payload.data) ?? payload;
  const status =
    stringifyUnknown(data.status) ??
    stringifyUnknown(data.orderStatus) ??
    "confirmed";
  const lower = status.toLowerCase();
  const stage =
    lower.includes("deliver") || lower.includes("way")
      ? ("on-the-way" as const)
      : lower.includes("prep") || lower.includes("pack")
        ? ("packing" as const)
        : ("confirmed" as const);

  return {
    status: "ready" as const,
    source: "swiggy-food" as const,
    orderId,
    eta:
      stringifyUnknown(data.eta) ??
      stringifyUnknown(data.deliveryTime) ??
      "30-40 min",
    stage,
    updates: buildFoodTrackingUpdates(stage),
    polledAt: new Date().toISOString(),
  };
}

export const swiggyFoodProvider = createRemoteGroceryProvider({
  id: "swiggy-food",
  label: "Swiggy Food",
  serverUrl: "https://mcp.swiggy.com/food",
  searchToolCandidates: ["search_restaurants"],
  addressesToolCandidates: ["get_addresses"],
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
  searchRestaurantsWithClient: async ({
    client,
    tools,
    query,
    addressId,
  }) => {
    if (!addressId) {
      throw new Error("Swiggy Food needs a delivery address before restaurant search.");
    }

    const searchTool = pickToolName(tools, ["search_restaurants"]);
    if (!searchTool) {
      throw new Error("Swiggy Food search_restaurants tool is unavailable.");
    }

    const result = await client.callTool({
      name: searchTool,
      arguments: {
        addressId,
        query,
      },
    });

    const payload = assertSwiggyFoodSuccess(result, "Swiggy Food search_restaurants");
    const restaurants = normalizeRestaurants(payload).filter(
      (item) => item.availabilityStatus === "OPEN",
    );

    if (!restaurants.length) {
      throw new Error(`I could not find any open Swiggy Food restaurants for ${query} near this address.`);
    }

    return {
      restaurants: restaurants.slice(0, 8),
    };
  },
  debugSearchWithClient: async ({
    client,
    tools,
    query,
    addressId,
  }) => {
    if (!addressId) {
      throw new Error("Swiggy Food needs a delivery address before restaurant search.");
    }

    const searchTool = pickToolName(tools, ["search_restaurants"]);
    if (!searchTool) {
      throw new Error("Swiggy Food search_restaurants tool is unavailable.");
    }

    const result = await client.callTool({
      name: searchTool,
      arguments: {
        addressId,
        query,
      },
    });

    const payload = assertSwiggyFoodSuccess(result, "Swiggy Food search_restaurants");
    const restaurants = normalizeRestaurants(payload);

    return {
      payload,
      normalized: restaurants,
      meta: {
        query,
        addressId,
        searchTool,
        restaurantCount: restaurants.length,
      },
    };
  },
  buildFoodCartWithClient: async ({
    client,
    tools,
    addressId,
    restaurantId,
    query,
  }) => {
    const flushTool = pickToolName(tools, ["flush_food_cart"]);
    const searchMenuTool = pickToolName(tools, ["search_menu"]);
    const updateCartTool = pickToolName(tools, ["update_food_cart"]);
    const getCartTool = pickToolName(tools, ["get_food_cart"]);

    if (!searchMenuTool || !updateCartTool || !getCartTool) {
      throw new Error("Swiggy Food cart tools are incomplete in this session.");
    }

    if (flushTool) {
      const flushResult = await client.callTool({
        name: flushTool,
        arguments: {},
      });
      if (!flushResult.isError) {
        assertSwiggyFoodSuccess(flushResult, "Swiggy Food flush_food_cart");
      }
    }

    const menuResult = await client.callTool({
      name: searchMenuTool,
      arguments: {
        addressId,
        query,
        restaurantIdOfAddedItem: restaurantId,
      },
    });
    const menuPayload = assertSwiggyFoodSuccess(menuResult, "Swiggy Food search_menu");
    const selection = pickMenuItem(menuPayload, query);

    if (!selection) {
      throw new Error(`I could not find ${query} on this restaurant's menu.`);
    }

    const restaurantData = asRecord(menuPayload.data) ?? menuPayload;
    const restaurantName =
      stringifyUnknown(restaurantData.restaurantName) ??
      stringifyUnknown(restaurantData.restaurant_name) ??
      stringifyUnknown(restaurantData.name) ??
      "Restaurant";

    const updateResult = await client.callTool({
      name: updateCartTool,
      arguments: {
        restaurantId,
        restaurantName,
        addressId,
        cartItems: [selection.cartItem],
      },
    });
    assertSwiggyFoodSuccess(updateResult, "Swiggy Food update_food_cart");

    const cartResult = await client.callTool({
      name: getCartTool,
      arguments: {},
    });
    const cartPayload = assertSwiggyFoodSuccess(cartResult, "Swiggy Food get_food_cart");
    const cart = extractFoodCart(cartPayload);

    return {
      restaurantId,
      restaurantName: cart.restaurantName || restaurantName,
      addressId,
      addressLine: cart.addressLine,
      paymentMethods: cart.availablePaymentMethods,
      items: cart.items.length
        ? cart.items
        : [
            {
              id: selection.itemId,
              name: selection.name,
              quantity: selection.quantityLabel,
              price: Math.round(selection.price),
            },
          ],
      subtotal: Math.round(cart.subtotal),
      fees: Math.round(cart.fees),
      total: Math.round(cart.total),
    };
  },
  placeOrderWithClient: async ({ client, tools, mockMode, slug }) => {
    const orderId = `SW-FOOD-MOCK-${String(Date.now()).slice(-6)}`;
    if (mockMode) {
      return {
        status: "ready",
        source: "swiggy-food",
        orderId,
        mockMode: true,
        tracking: {
          status: "ready",
          source: "swiggy-food",
          orderId,
          eta: "32 min",
          stage: "confirmed",
          updates: buildFoodTrackingUpdates("confirmed"),
          polledAt: new Date().toISOString(),
        },
      };
    }

    const addressesTool = pickToolName(tools, ["get_addresses"]);
    const getCartTool = pickToolName(tools, ["get_food_cart"]);
    const placeOrderTool = pickToolName(tools, ["place_food_order"]);
    const getOrdersTool = pickToolName(tools, ["get_food_orders"]);
    if (!addressesTool || !getCartTool || !placeOrderTool) {
      throw new Error("Swiggy Food order tools are incomplete in this session.");
    }

    const addressResult = await client.callTool({ name: addressesTool, arguments: {} });
    const addressPayload = assertSwiggyFoodSuccess(addressResult, "Swiggy Food get_addresses");
    const addresses = (() => {
      const data = asRecord(addressPayload.data) ?? addressPayload;
      const entries = Array.isArray(data.addresses) ? data.addresses : Array.isArray(data.data) ? data.data : [];
      return entries
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null);
    })();
    const addressId =
      addresses.find((entry) => stringifyUnknown(entry.label) === "Home")?.id ??
      addresses[0]?.id;
    if (typeof addressId !== "string") {
      throw new Error(`Swiggy Food has no saved address for ${slug}.`);
    }

    const cartResult = await client.callTool({ name: getCartTool, arguments: {} });
    const cartPayload = assertSwiggyFoodSuccess(cartResult, "Swiggy Food get_food_cart");
    const cart = extractFoodCart(cartPayload);
    if (cart.total >= 1000) {
      throw new Error("This Swiggy Food cart exceeds the ₹1000 MCP cap. Use the Swiggy app to place it directly.");
    }

    const paymentMethod = cart.availablePaymentMethods[0];
    const orderResult = await client.callTool({
      name: placeOrderTool,
      arguments: paymentMethod
        ? { addressId, paymentMethod }
        : { addressId },
    });

    try {
      const payload = assertSwiggyFoodSuccess(orderResult, "Swiggy Food place_food_order");
      const data = asRecord(payload.data) ?? payload;
      const placedOrderId =
        stringifyUnknown(data.orderId) ??
        stringifyUnknown(data.id) ??
        orderId;
      return {
        status: "ready",
        source: "swiggy-food",
        orderId: placedOrderId,
        mockMode: false,
        tracking: extractFoodTracking(payload, placedOrderId),
      };
    } catch (error) {
      if (!getOrdersTool) {
        throw error;
      }
      const recoveryResult = await client.callTool({
        name: getOrdersTool,
        arguments: {},
      });
      const recoveryPayload = assertSwiggyFoodSuccess(
        recoveryResult,
        "Swiggy Food get_food_orders",
      );
      const data = asRecord(recoveryPayload.data) ?? recoveryPayload;
      const orders = Array.isArray(data.orders) ? data.orders : [];
      const latestOrder = asRecord(orders[0]);
      const recoveredOrderId =
        stringifyUnknown(latestOrder?.orderId) ??
        stringifyUnknown(latestOrder?.id);
      if (!recoveredOrderId) {
        throw error;
      }
      return {
        status: "ready",
        source: "swiggy-food",
        orderId: recoveredOrderId,
        mockMode: false,
        tracking: extractFoodTracking(recoveryPayload, recoveredOrderId),
      };
    }
  },
  trackOrderWithClient: async ({ client, tools, orderId }) => {
    const trackTool = pickToolName(tools, ["track_food_order"]);
    if (!trackTool) {
      throw new Error("Swiggy Food track_food_order tool is unavailable.");
    }
    const result = await client.callTool({
      name: trackTool,
      arguments: { orderId },
    });
    const payload = assertSwiggyFoodSuccess(result, "Swiggy Food track_food_order");
    return extractFoodTracking(payload, orderId);
  },
});
