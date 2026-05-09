import { createRemoteGroceryProvider } from "@/lib/grocery-provider";
import { mergeDebugSnapshot } from "@/lib/grocery-provider";
import { getDebugSnapshot } from "@/lib/grocery-provider";
import { traceEvent } from "@/lib/debug-trace";
import {
  getIngredientQueryCandidates,
  scoreIngredientProductMatch,
} from "@/lib/ingredient-search";
import type { CartItem, TrackingUpdate } from "@/lib/chat";

type ToolResultLike = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

type SwiggyVariant = {
  spinId: string;
  quantity: string;
  price: number;
};

type SwiggySearchHit = {
  name: string;
  variant: SwiggyVariant;
  score: number;
};

type SwiggyToolFailure = {
  message: string;
  retryable: boolean;
  code?: string;
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

function classifySwiggyFailure(message: string): SwiggyToolFailure {
  const lower = message.toLowerCase();

  if (
    lower.includes("out of stock") ||
    lower.includes("item out of stock")
  ) {
    return {
      message: "Some grocery items are out of stock at this address.",
      retryable: false,
      code: "ITEM_OUT_OF_STOCK",
    };
  }

  if (lower.includes("address") && lower.includes("serviceable")) {
    return {
      message: "This address is not serviceable on Swiggy Instamart.",
      retryable: false,
      code: "ADDRESS_NOT_SERVICEABLE",
    };
  }

  if (lower.includes("minimum order")) {
    return {
      message: "The Swiggy Instamart cart is below the minimum order amount.",
      retryable: false,
      code: "MIN_ORDER_NOT_MET",
    };
  }

  if (lower.includes("cart expired") || lower.includes("abandoned")) {
    return {
      message: "The Swiggy Instamart cart expired and needs to be rebuilt.",
      retryable: false,
      code: "CART_EXPIRED",
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("internal")
  ) {
    return {
      message: "Swiggy Instamart is temporarily unavailable. Try again shortly.",
      retryable: true,
    };
  }

  return {
    message,
    retryable: false,
  };
}

function assertSwiggySuccess(result: ToolResultLike, context: string) {
  if (result.isError) {
    throw new Error(`${context} failed.`);
  }

  const payload = parseToolPayload(result);
  if (!payload) {
    throw new Error(`${context} returned an unreadable response.`);
  }

  if (payload.success === false) {
    const errorBlock = asRecord(payload.error);
    const failure = classifySwiggyFailure(
      stringifyUnknown(errorBlock?.message) ?? `${context} failed.`,
    );
    const error = new Error(failure.message);
    (error as Error & { retryable?: boolean }).retryable = failure.retryable;
    (error as Error & { providerErrorCode?: string }).providerErrorCode = failure.code;
    throw error;
  }

  return payload;
}

function scoreProductMatch(name: string, ingredient: string) {
  return scoreIngredientProductMatch(name, ingredient);
}

function extractNumber(value: unknown) {
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

function normalizeSwiggyVariant(variant: Record<string, unknown>) {
  const spinId =
    stringifyUnknown(variant.spinId) ??
    stringifyUnknown(variant.variantId) ??
    stringifyUnknown(variant.productVariantId) ??
    stringifyUnknown(variant.storeProductId) ??
    stringifyUnknown(variant.cartProductId) ??
    stringifyUnknown(variant.id) ??
    stringifyUnknown(variant.sku);
  const quantity =
    stringifyUnknown(variant.quantityDescription) ??
    stringifyUnknown(variant.packSize) ??
    stringifyUnknown(variant.variantName) ??
    stringifyUnknown(variant.quantity) ??
    stringifyUnknown(variant.weight) ??
    stringifyUnknown(variant.size) ??
    "1 pack";
  const price =
    extractNumber(variant.offerPrice) ??
    extractNumber(variant.sellingPrice) ??
    extractNumber(variant.finalPrice) ??
    extractNumber(variant.defaultPrice) ??
    extractNumber(variant.mrp) ??
    extractNumber(asRecord(variant.price)?.offerPrice) ??
    extractNumber(asRecord(variant.price)?.sellingPrice) ??
    extractNumber(asRecord(variant.price)?.finalPrice) ??
    extractNumber(asRecord(variant.price)?.defaultPrice) ??
    extractNumber(asRecord(variant.price)?.mrp) ??
    extractNumber(variant.price);

  if (!spinId || price === null) {
    return null;
  }

  return {
    spinId,
    quantity,
    price,
  } satisfies SwiggyVariant;
}

function pickBestSwiggyProduct(payload: Record<string, unknown>, ingredient: string) {
  const data = asRecord(payload.data) ?? payload;
  const products = Array.isArray(data.products) ? data.products : [];

  const candidates: SwiggySearchHit[] = [];
  for (const entry of products) {
    const product = asRecord(entry);
    if (!product) {
      continue;
    }

    const name =
      stringifyUnknown(product.displayName) ??
      stringifyUnknown(product.name) ??
      stringifyUnknown(product.title);
    if (!name) {
      continue;
    }

    const variants = Array.isArray(product.variants)
      ? product.variants
      : Array.isArray(product.variations)
        ? product.variations
        : [];
    const normalizedVariants = variants
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((variant) => normalizeSwiggyVariant(variant))
      .filter((variant): variant is SwiggyVariant => variant !== null);
    const productAsVariant = normalizeSwiggyVariant(product);
    const bestVariant =
      normalizedVariants.find((variant) => variant.price > 0) ??
      normalizedVariants[0] ??
      productAsVariant;

    if (!bestVariant) {
      continue;
    }

    candidates.push({
      name,
      variant: bestVariant,
      score: scoreProductMatch(name, ingredient),
    });
  }

  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

function flattenNumericValues(value: unknown, path = ""): Array<{ path: string; value: number }> {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [{ path, value }];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenNumericValues(item, `${path}[${index}]`),
    );
  }

  return Object.entries(value).flatMap(([key, nested]) =>
    flattenNumericValues(nested, path ? `${path}.${key}` : key),
  );
}

function findNumericByKeywords(
  payload: Record<string, unknown>,
  required: string[],
  excluded: string[] = [],
) {
  const flattened = flattenNumericValues(payload);
  const match = flattened.find(({ path }) => {
    const lower = path.toLowerCase();
    return (
      required.every((token) => lower.includes(token)) &&
      excluded.every((token) => !lower.includes(token))
    );
  });

  return match?.value ?? null;
}

function extractBillBreakdownTotals(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const billBreakdown = asRecord(data.billBreakdown);
  const lineItems = Array.isArray(billBreakdown?.lineItems)
    ? billBreakdown.lineItems
    : [];
  const toPayValue = extractNumber(asRecord(billBreakdown?.toPay)?.value);

  let subtotal: number | null = null;
  let fees = 0;

  for (const entry of lineItems) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const label = stringifyUnknown(record.label)?.toLowerCase() ?? "";
    const value = extractNumber(record.value);

    if (label.includes("item total") && value !== null) {
      subtotal = value;
      continue;
    }

    if (value === null) {
      continue;
    }

    if (
      label.includes("tip") ||
      label.includes("saving") ||
      label.includes("discount")
    ) {
      continue;
    }

    fees += value;
  }

  if (subtotal === null && toPayValue === null) {
    return null;
  }

  return {
    subtotal,
    fees,
    total: toPayValue,
  };
}

function extractCartTotals(payload: Record<string, unknown>, items: CartItem[]) {
  const subtotalFallback = items.reduce((sum, item) => sum + item.price, 0);
  const billBreakdownTotals = extractBillBreakdownTotals(payload);
  const total =
    billBreakdownTotals?.total ??
    findNumericByKeywords(payload, ["grand", "total"]) ??
    findNumericByKeywords(payload, ["total"], ["sub", "item", "mrp", "discount"]) ??
    subtotalFallback;
  const subtotal =
    billBreakdownTotals?.subtotal ??
    findNumericByKeywords(payload, ["sub", "total"]) ??
    findNumericByKeywords(payload, ["item", "total"]) ??
    subtotalFallback;
  const fees =
    billBreakdownTotals?.fees ??
    findNumericByKeywords(payload, ["delivery", "fee"]) ??
    findNumericByKeywords(payload, ["delivery", "charge"]) ??
    findNumericByKeywords(payload, ["handling", "fee"]) ??
    Math.max(0, total - subtotal);

  return {
    subtotal: Math.round(subtotal),
    fees: Math.round(fees),
    total: Math.round(total),
  };
}

function buildTrackingUpdates(stage: "confirmed" | "packing" | "on-the-way") {
  const states: TrackingUpdate[] = [
    {
      id: "track-1",
      label: "Order confirmed",
      detail: "Swiggy confirmed the grocery order.",
      complete: true,
    },
    {
      id: "track-2",
      label: "Packing groceries",
      detail: "The store is packing the grocery items.",
      complete: stage !== "confirmed",
    },
    {
      id: "track-3",
      label: "On the way",
      detail: "The delivery partner is on the way.",
      complete: stage === "on-the-way",
    },
  ];

  return states;
}

function mapTrackingStage(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const raw =
    stringifyUnknown(data.status) ??
    stringifyUnknown(data.orderStatus) ??
    stringifyUnknown(data.deliveryStatus) ??
    stringifyUnknown(data.stage) ??
    "confirmed";
  const lower = raw.toLowerCase();

  if (
    lower.includes("out for delivery") ||
    lower.includes("on the way") ||
    lower.includes("rider")
  ) {
    return "on-the-way" as const;
  }

  if (
    lower.includes("packing") ||
    lower.includes("preparing") ||
    lower.includes("picked")
  ) {
    return "packing" as const;
  }

  return "confirmed" as const;
}

function extractEta(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const direct =
    stringifyUnknown(data.eta) ??
    stringifyUnknown(data.estimatedDeliveryTime) ??
    stringifyUnknown(data.deliveryEta);

  if (direct) {
    return direct;
  }

  const etaMins =
    extractNumber(data.etaMinutes) ??
    extractNumber(data.estimatedDeliveryMinutes) ??
    extractNumber(data.deliveryEtaMinutes);

  if (etaMins !== null) {
    return `${Math.round(etaMins)} min`;
  }

  return "10-20 min";
}

function extractOrderId(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  return (
    stringifyUnknown(data.orderId) ??
    stringifyUnknown(data.id) ??
    stringifyUnknown(data.order_id)
  );
}

function extractLatestOrderId(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const orders = Array.isArray(data.orders)
    ? data.orders
    : Array.isArray(data.items)
      ? data.items
      : [];

  for (const entry of orders) {
    const order = asRecord(entry);
    const id =
      stringifyUnknown(order?.orderId) ??
      stringifyUnknown(order?.id) ??
      stringifyUnknown(order?.order_id);
    if (id) {
      return id;
    }
  }

  return null;
}

function normalizeSavedAddress(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const address =
    asRecord(data.address) ??
    asRecord(data.createdAddress) ??
    asRecord(data.savedAddress) ??
    asRecord(data.item);

  if (!address) {
    return null;
  }

  const id =
    stringifyUnknown(address.id) ??
    stringifyUnknown(address.addressId);
  if (!id) {
    return null;
  }

  const addressLine =
    stringifyUnknown(address.addressLine) ??
    stringifyUnknown(address.address) ??
    stringifyUnknown(address.formattedAddress) ??
    stringifyUnknown(address.line1) ??
    "";
  const addressTag =
    stringifyUnknown(address.addressTag) ??
    stringifyUnknown(address.tag);

  return {
    id,
    addressLine,
    ...(addressTag ? { addressTag } : {}),
  };
}

async function trackSwiggyOrder(args: {
  client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResultLike> };
  tools: Array<{ name: string }>;
  orderId: string;
}) {
  const trackTool = pickToolName(args.tools, ["track_order"]);
  if (!trackTool) {
    throw new Error("Swiggy Instamart track_order tool is unavailable.");
  }

  const result = await args.client.callTool({
    name: trackTool,
    arguments: { orderId: args.orderId },
  });
  const payload = assertSwiggySuccess(result, "Swiggy Instamart track_order");
  const stage = mapTrackingStage(payload);

  return {
    status: "ready",
    source: "swiggy-instamart",
    orderId: args.orderId,
    eta: extractEta(payload),
    stage,
    updates: buildTrackingUpdates(stage),
    polledAt: new Date().toISOString(),
  } as const;
}

async function runInstamartDebugSearch(args: {
  client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResultLike> };
  tools: Array<{ name: string }>;
  query: string;
  addressId?: string | null;
  pushSetupStep: (step: { tool: string; ok: boolean }) => void;
}) {
  if (!args.addressId) {
    throw new Error("Swiggy Instamart needs a delivery address before search.");
  }

  const searchTool = pickToolName(args.tools, ["search_products"]);
  const clearCartTool = pickToolName(args.tools, ["clear_cart"]);

  if (!searchTool) {
    throw new Error("Swiggy Instamart search_products tool is unavailable.");
  }

  if (clearCartTool) {
    const clearResult = await args.client.callTool({
      name: clearCartTool,
      arguments: {},
    });
    args.pushSetupStep({ tool: clearCartTool, ok: !clearResult.isError });
    if (!clearResult.isError) {
      assertSwiggySuccess(clearResult, "Swiggy Instamart clear_cart");
    }
  }

  const result = await args.client.callTool({
    name: searchTool,
    arguments: { query: args.query, addressId: args.addressId },
  });
  const payload = assertSwiggySuccess(
    result,
    `Swiggy Instamart search for ${args.query}`,
  );
  const data = asRecord(payload.data) ?? payload;
  const products = Array.isArray(data.products) ? data.products : [];
  const normalized = products.slice(0, 20).map((entry) => {
    const product = asRecord(entry);
    return {
      name:
        stringifyUnknown(product?.displayName) ??
        stringifyUnknown(product?.name) ??
        stringifyUnknown(product?.title) ??
        "",
      quantity:
        stringifyUnknown(product?.quantity) ??
        stringifyUnknown(product?.unit) ??
        "",
    };
  });

  return {
    payload,
    normalized,
    meta: {
      action: "search",
      query: args.query,
      addressId: args.addressId,
      searchTool,
      productCount: products.length,
    },
  };
}

async function runInstamartGoToItems(args: {
  client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResultLike> };
  tools: Array<{ name: string }>;
  addressId?: string | null;
}) {
  if (!args.addressId) {
    throw new Error("Swiggy Instamart needs a delivery address before fetching go-to items.");
  }

  const tool = pickToolName(args.tools, ["your_go_to_items"]);
  if (!tool) {
    throw new Error("Swiggy Instamart your_go_to_items tool is unavailable.");
  }

  const result = await args.client.callTool({
    name: tool,
    arguments: { addressId: args.addressId },
  });
  const payload = assertSwiggySuccess(result, "Swiggy Instamart your_go_to_items");
  const data = asRecord(payload.data) ?? payload;
  const products = Array.isArray(data.products) ? data.products : [];
  const normalized = products.slice(0, 20).map((entry) => {
    const product = asRecord(entry);
    const variants = Array.isArray(product?.variants)
      ? product.variants
      : Array.isArray(product?.variations)
        ? product.variations
        : [];
    return {
      name:
        stringifyUnknown(product?.displayName) ??
        stringifyUnknown(product?.name) ??
        stringifyUnknown(product?.title) ??
        "",
      variantCount: variants.length,
      sampleVariant:
        normalizeSwiggyVariant(asRecord(variants[0]) ?? {}) ??
        normalizeSwiggyVariant(product ?? {}),
    };
  });

  return {
    payload,
    normalized,
    meta: {
      action: "your_go_to_items",
      addressId: args.addressId,
      tool,
      productCount: products.length,
    },
  };
}

function buildInstamartReportErrorArgs(
  message: string,
  context?: Record<string, unknown>,
) {
  const toolContextRecord = asRecord(context?.toolContext) ?? {};
  const tool =
    typeof context?.tool === "string" && context.tool
      ? context.tool
      : "search_products";
  const flowDescription =
    typeof context?.flowDescription === "string" ? context.flowDescription : undefined;
  const userNotes =
    typeof context?.userNotes === "string" ? context.userNotes : undefined;
  const toolContext: Record<string, unknown> = {
    ...toolContextRecord,
  };

  for (const [key, value] of Object.entries(context ?? {})) {
    if (
      key === "tool" ||
      key === "flowDescription" ||
      key === "toolContext" ||
      key === "userNotes"
    ) {
      continue;
    }
    toolContext[key] = value;
  }

  return {
    tool,
    domain: "im",
    errorMessage: message,
    ...(flowDescription ? { flowDescription } : {}),
    ...(Object.keys(toolContext).length ? { toolContext } : {}),
    ...(userNotes ? { userNotes } : {}),
  };
}

export const swiggyInstamartProvider = createRemoteGroceryProvider({
  id: "swiggy-instamart",
  label: "Swiggy Instamart",
  serverUrl: "https://mcp.swiggy.com/im",
  authScope: "mcp:tools",
  supportsRefreshToken: false,
  proactiveReauthWindowMs: 60_000,
  disconnect: async ({ state }) => {
    const accessToken = (state.tokens as Record<string, unknown> | undefined)?.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      return;
    }

    const response = await fetch("https://mcp.swiggy.com/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 401 && response.status !== 419) {
      throw new Error(`Swiggy logout failed with HTTP ${response.status}.`);
    }
  },
  searchToolCandidates: [
    "search_products",
    "search product",
    "searchProducts",
    "search",
  ],
  addressesToolCandidates: ["get_addresses", "addresses", "list_addresses"],
  getOrderDetailsWithClient: async ({ client, tools, orderId }) => {
    const tool = pickToolName(tools, ["get_order_details"]);
    if (!tool) {
      throw new Error("Swiggy Instamart get_order_details tool is unavailable.");
    }

    const result = await client.callTool({
      name: tool,
      arguments: { orderId },
    });
    const payload = assertSwiggySuccess(result, "Swiggy Instamart get_order_details");

    return {
      status: "ready",
      source: "swiggy-instamart",
      orderId,
      payload,
    };
  },
  reportErrorWithClient: async ({ client, tools, message, context }) => {
    const tool = pickToolName(tools, ["report_error"]);
    if (!tool) {
      throw new Error("Swiggy Instamart report_error tool is unavailable.");
    }

    const result = await client.callTool({
      name: tool,
      arguments: buildInstamartReportErrorArgs(message, context),
    });
    const payload = assertSwiggySuccess(result, "Swiggy Instamart report_error");

    return {
      status: "ready",
      source: "swiggy-instamart",
      payload,
    };
  },
  createAddressWithClient: async ({ client, tools, input }) => {
    const tool = pickToolName(tools, ["create_address"]);
    if (!tool) {
      throw new Error("Swiggy Instamart create_address tool is unavailable.");
    }

    const result = await client.callTool({
      name: tool,
      arguments: {
        ...input,
      },
    });
    const payload = assertSwiggySuccess(result, "Swiggy Instamart create_address");

    return {
      status: "ready",
      source: "swiggy-instamart",
      address: normalizeSavedAddress(payload),
      payload,
    };
  },
  deleteAddressWithClient: async ({ client, tools, addressId }) => {
    const tool = pickToolName(tools, ["delete_address"]);
    if (!tool) {
      throw new Error("Swiggy Instamart delete_address tool is unavailable.");
    }

    const result = await client.callTool({
      name: tool,
      arguments: { addressId },
    });
    const payload = assertSwiggySuccess(result, "Swiggy Instamart delete_address");

    return {
      status: "ready",
      source: "swiggy-instamart",
      deletedAddressId: addressId,
      payload,
    };
  },
  buildCartWithClient: async ({
    client,
    tools,
    slug,
    missingIngredients,
    addressId,
    pushSetupStep,
  }) => {
    if (!addressId) {
      throw new Error("Swiggy Instamart needs a delivery address before building the cart.");
    }

    const searchTool = pickToolName(tools, ["search_products"]);
    const clearCartTool = pickToolName(tools, ["clear_cart"]);
    const updateCartTool = pickToolName(tools, ["update_cart"]);
    const getCartTool = pickToolName(tools, ["get_cart"]);

    if (!searchTool || !updateCartTool || !getCartTool) {
      throw new Error("Swiggy Instamart cart tools are incomplete in this session.");
    }

    const selectedItems: CartItem[] = [];
    const updateItems: Array<{ spinId: string; quantity: number }> = [];
    const unresolvedIngredients: string[] = [];
    traceEvent("swiggy-instamart", "cart_build_prepare", {
      slug,
      addressId: addressId ?? "",
      missingIngredients,
    });

    for (const ingredient of missingIngredients) {
      let bestHit: SwiggySearchHit | null = null;
      let searchFailure = false;
      const queriesTried: string[] = [];

      for (const query of getIngredientQueryCandidates(ingredient)) {
        queriesTried.push(query);
        const result = await client.callTool({
          name: searchTool,
          arguments: { query, addressId },
        });

        if (result.isError) {
          searchFailure = true;
          traceEvent("swiggy-instamart", "search_result", {
            slug,
            ingredient,
            query,
            status: "tool_error",
          });
          continue;
        }

        const payload = assertSwiggySuccess(result, `Swiggy Instamart search for ${query}`);
        const productEntries = Array.isArray((asRecord(payload.data) ?? payload).products)
          ? ((asRecord(payload.data) ?? payload).products as unknown[])
          : [];
        const candidateHit = pickBestSwiggyProduct(payload, ingredient);
        const productCount = productEntries.length;
        const sampleNames = productEntries
          .slice(0, 5)
          .map((entry) => {
            const product = asRecord(entry);
            return (
              stringifyUnknown(product?.displayName) ??
              stringifyUnknown(product?.name) ??
              stringifyUnknown(product?.title) ??
              ""
            );
          })
          .filter(Boolean);
        traceEvent("swiggy-instamart", "search_result", {
          slug,
          ingredient,
          query,
          status: "ok",
          productCount,
          sampleNames,
          bestHit: candidateHit
            ? {
                name: candidateHit.name,
                quantity: candidateHit.variant.quantity,
                price: candidateHit.variant.price,
                score: candidateHit.score,
              }
            : null,
        });
        mergeDebugSnapshot("swiggy-instamart", slug, {
          searchHistory: [
            ...((getDebugSnapshot("swiggy-instamart", slug)?.searchHistory ?? []) as Array<{
              ingredient: string;
              query: string;
              payload?: unknown;
              productCount?: number;
              sampleNames?: string[];
              bestProduct?: {
                id?: string;
                name: string;
                quantity: string;
                price: number;
                score: number;
              } | null;
            }>),
            {
              ingredient,
              query,
              payload,
              productCount,
              sampleNames,
              bestProduct: candidateHit
                ? {
                    id: candidateHit.variant.spinId,
                    name: candidateHit.name,
                    quantity: candidateHit.variant.quantity,
                    price: candidateHit.variant.price,
                    score: candidateHit.score,
                  }
                : null,
            },
          ],
        });
        if (!candidateHit) {
          continue;
        }

        if (!bestHit || candidateHit.score > bestHit.score) {
          bestHit = candidateHit;
        }

        if (candidateHit.score > 0) {
          break;
        }
      }

      if (searchFailure && !bestHit) {
        unresolvedIngredients.push(ingredient);
        traceEvent("swiggy-instamart", "ingredient_unresolved", {
          slug,
          ingredient,
          queriesTried,
          reason: "tool_error_no_hit",
        });
        continue;
      }

      if (!bestHit || bestHit.score <= 0) {
        unresolvedIngredients.push(ingredient);
        traceEvent("swiggy-instamart", "ingredient_unresolved", {
          slug,
          ingredient,
          queriesTried,
          reason: "no_scored_hit",
        });
        continue;
      }

      selectedItems.push({
        id: bestHit.variant.spinId,
        name: bestHit.name,
        quantity: bestHit.variant.quantity,
        price: Math.round(bestHit.variant.price),
      });
      updateItems.push({
        spinId: bestHit.variant.spinId,
        quantity: 1,
      });
      traceEvent("swiggy-instamart", "ingredient_selected", {
        slug,
        ingredient,
        spinId: bestHit.variant.spinId,
        name: bestHit.name,
        quantity: bestHit.variant.quantity,
        price: bestHit.variant.price,
        score: bestHit.score,
      });
    }

    if (!updateItems.length) {
      traceEvent("swiggy-instamart", "cart_build_empty", {
        slug,
        unresolvedIngredients,
      });
      return {
        items: selectedItems,
        unresolvedIngredients,
        subtotal: 0,
        fees: 0,
        total: 0,
      };
    }

    if (clearCartTool) {
      const result = await client.callTool({
        name: clearCartTool,
        arguments: {},
      });
      pushSetupStep({ tool: clearCartTool, ok: !result.isError });
      if (!result.isError) {
        assertSwiggySuccess(result, "Swiggy Instamart clear_cart");
      }
    }

    if (updateItems.length) {
      mergeDebugSnapshot("swiggy-instamart", slug, {
        updateCartRequest: {
          selectedAddressId: addressId,
          items: updateItems,
        },
      });
      const result = await client.callTool({
        name: updateCartTool,
        arguments: {
          selectedAddressId: addressId,
          items: updateItems,
        },
      });
      pushSetupStep({ tool: updateCartTool, ok: !result.isError });
      const updatePayload = assertSwiggySuccess(result, "Swiggy Instamart update_cart");
      mergeDebugSnapshot("swiggy-instamart", slug, {
        updateCartPayload: updatePayload,
      });
      traceEvent("swiggy-instamart", "cart_updated", {
        slug,
        itemCount: updateItems.length,
        items: updateItems,
      });
    }

    const cartResult = await client.callTool({
      name: getCartTool,
      arguments: {},
    });
    const cartPayload = assertSwiggySuccess(cartResult, "Swiggy Instamart get_cart");
    mergeDebugSnapshot("swiggy-instamart", slug, {
      getCartPayload: cartPayload,
    });
    const totals = extractCartTotals(cartPayload, selectedItems);
    traceEvent("swiggy-instamart", "cart_fetched", {
      slug,
      itemCount: selectedItems.length,
      unresolvedIngredients,
      subtotal: totals.subtotal,
      fees: totals.fees,
      total: totals.total,
    });

    return {
      items: selectedItems,
      unresolvedIngredients,
      subtotal: totals.subtotal,
      fees: totals.fees,
      total: totals.total,
    };
  },
  debugSearchWithClient: async ({
    client,
    tools,
    query,
    addressId,
    pushSetupStep,
  }) => {
    return runInstamartDebugSearch({
      client,
      tools,
      query,
      addressId,
      pushSetupStep,
    });
  },
  debugActionWithClient: async ({
    client,
    tools,
    action,
    query,
    report,
    addressId,
    pushSetupStep,
  }) => {
    if (action === "search") {
      if (!query) {
        throw new Error("Swiggy Instamart debug search needs a query.");
      }
      return runInstamartDebugSearch({
        client,
        tools,
        query,
        addressId,
        pushSetupStep,
      });
    }

    if (action === "your_go_to_items") {
      return runInstamartGoToItems({
        client,
        tools,
        addressId,
      });
    }

    if (action === "report_error") {
      const tool = pickToolName(tools, ["report_error"]);
      if (!tool) {
        throw new Error("Swiggy Instamart report_error tool is unavailable.");
      }

      const errorMessage =
        report?.userNotes?.trim() ||
        query?.trim() ||
        "Debug lab report: search_products returned unexpected empty results.";
      const reportArgs = buildInstamartReportErrorArgs(errorMessage, {
        tool: report?.tool?.trim() || "search_products",
        flowDescription:
          report?.flowDescription?.trim() ||
          "Debugging Instamart search behavior in the internal Swiggy lab.",
        toolContext: {
          addressId,
          query: query?.trim() || undefined,
          ...(report?.toolContext ?? {}),
        },
        userNotes: report?.userNotes?.trim() || undefined,
      });
      const result = await client.callTool({
        name: tool,
        arguments: reportArgs,
      });
      const payload = assertSwiggySuccess(result, "Swiggy Instamart report_error");
      return {
        payload,
        meta: {
          action: "report_error",
          tool,
          request: reportArgs,
        },
      };
    }

    throw new Error(`Unsupported Swiggy Instamart debug action: ${action}.`);
  },
  placeOrderWithClient: async ({ client, tools, mockMode }) => {
    if (mockMode) {
      const mockOrderId = `SW-MOCK-${String(Date.now()).slice(-6)}`;
      return {
        status: "ready",
        source: "swiggy-instamart",
        orderId: mockOrderId,
        mockMode: true,
        tracking: {
          status: "ready",
          source: "swiggy-instamart",
          orderId: mockOrderId,
          eta: "11 min",
          stage: "confirmed",
          updates: buildTrackingUpdates("confirmed"),
          polledAt: new Date().toISOString(),
        },
      };
    }

    const checkoutTool = pickToolName(tools, ["checkout"]);
    const getOrdersTool = pickToolName(tools, ["get_orders"]);
    if (!checkoutTool) {
      throw new Error("Swiggy Instamart checkout tool is unavailable.");
    }

    let orderId: string | null = null;

    try {
      const checkoutResult = await client.callTool({
        name: checkoutTool,
        arguments: { paymentMethod: "COD" },
      });
      const checkoutPayload = assertSwiggySuccess(
        checkoutResult,
        "Swiggy Instamart checkout",
      );
      orderId = extractOrderId(checkoutPayload);
    } catch (error) {
      const retryable = Boolean(
        error &&
          typeof error === "object" &&
          "retryable" in error &&
          (error as { retryable?: boolean }).retryable,
      );

      if (!retryable || !getOrdersTool) {
        throw error;
      }

      const ordersResult = await client.callTool({
        name: getOrdersTool,
        arguments: {},
      });
      const ordersPayload = assertSwiggySuccess(
        ordersResult,
        "Swiggy Instamart get_orders",
      );
      orderId = extractLatestOrderId(ordersPayload);
      if (!orderId) {
        throw error;
      }
    }

    if (!orderId) {
      throw new Error("Swiggy Instamart checkout did not return an order ID.");
    }

    const tracking = await trackSwiggyOrder({
      client,
      tools,
      orderId,
    });

    return {
      status: "ready",
      source: "swiggy-instamart",
      orderId,
      mockMode: false,
      tracking,
    };
  },
  trackOrderWithClient: async ({ client, tools, orderId }) =>
    trackSwiggyOrder({
      client,
      tools,
      orderId,
    }),
});

export const beginInstamartAuth = swiggyInstamartProvider.beginAuth;
export const finishInstamartAuth = swiggyInstamartProvider.finishAuth;
export const hasInstamartTokens = swiggyInstamartProvider.hasTokens;
export const listInstamartAddresses = swiggyInstamartProvider.listAddresses;
export const buildInstamartCart = swiggyInstamartProvider.buildCart;
