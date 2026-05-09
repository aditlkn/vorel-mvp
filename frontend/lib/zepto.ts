import { createRemoteGroceryProvider, getDebugSnapshot, mergeDebugSnapshot } from "@/lib/grocery-provider";
import { getIngredientQueryCandidates, scoreIngredientProductMatch } from "@/lib/ingredient-search";
import type { CartItem, TrackingUpdate } from "@/lib/chat";

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

type ToolResultLike = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

type ZeptoSearchProduct = {
  productVariantId: string;
  storeProductId: string;
  cartProductId: string | null;
  variantId: string | null;
  name: string;
  price: number;
  mrp: number | null;
  packSize: string;
  availableQuantity: number | null;
  isAd: boolean;
  imageUrl: string | null;
  score: number;
  packSizeScore: number;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringifyUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function extractPayload(result: ToolResultLike) {
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

  return {};
}

function assertZeptoSuccess(result: ToolResultLike, context: string) {
  if (result.isError) {
    throw new Error(`${context} failed.`);
  }

  return extractPayload(result);
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

function estimatePackSizeScore(quantity: string) {
  const lower = quantity.toLowerCase();
  const numberMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const amount = numberMatch ? Number(numberMatch[1]) : null;

  if (amount === null || !Number.isFinite(amount)) {
    return Number.POSITIVE_INFINITY;
  }

  if (/\b(kg|kilogram|kilograms)\b/.test(lower)) return amount * 1000;
  if (/\b(g|gm|gram|grams)\b/.test(lower)) return amount;
  if (/\b(l|ltr|litre|liter|litres|liters)\b/.test(lower)) return amount * 1000;
  if (/\b(ml|millilitre|milliliter|millilitres|milliliters)\b/.test(lower)) return amount;
  if (/\b(pc|pcs|piece|pieces|pack|packs|bunch|bunches|cup|cups)\b/.test(lower)) return amount;
  return amount;
}

function normalizeZeptoSearchProduct(product: unknown, ingredient: string) {
  const record = asRecord(product);
  if (!record) return null;

  const productVariantId =
    stringifyUnknown(record.productVariantId) ??
    stringifyUnknown(record.id) ??
    stringifyUnknown(record.variantId);
  const storeProductId =
    stringifyUnknown(record.storeProductId) ??
    stringifyUnknown(record.store_product_id);
  const name =
    stringifyUnknown(record.name) ??
    stringifyUnknown(record.displayName) ??
    stringifyUnknown(record.title);
  const price = extractNumber(record.price);

  if (!productVariantId || !storeProductId || !name || price === null) {
    return null;
  }

  const packSize =
    stringifyUnknown(record.packSize) ??
    stringifyUnknown(record.pack_size) ??
    stringifyUnknown(record.weight) ??
    stringifyUnknown(record.quantity) ??
    "1 pack";

  return {
    productVariantId,
    storeProductId,
    cartProductId: stringifyUnknown(record.cartProductId),
    variantId: stringifyUnknown(record.variantId),
    name,
    price,
    mrp: extractNumber(record.mrp),
    packSize,
    availableQuantity: extractNumber(record.availableQuantity),
    isAd: record.isAd === true,
    imageUrl: stringifyUnknown(record.imageUrl),
    score: scoreIngredientProductMatch(name, ingredient),
    packSizeScore: estimatePackSizeScore(packSize),
  } satisfies ZeptoSearchProduct;
}

function pickBestZeptoProduct(payload: Record<string, unknown>, ingredient: string) {
  const products = Array.isArray(payload.products)
    ? payload.products
    : Array.isArray(asRecord(payload.data)?.products)
      ? (asRecord(payload.data)?.products as unknown[])
      : [];

  return products
    .map((product) => normalizeZeptoSearchProduct(product, ingredient))
    .filter((product): product is ZeptoSearchProduct => product !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.packSizeScore !== right.packSizeScore) return left.packSizeScore - right.packSizeScore;
      if (left.price !== right.price) return left.price - right.price;
      return left.name.localeCompare(right.name);
    })[0] ?? null;
}

function flattenNumericValues(value: unknown, path = ""): Array<{ path: string; value: number }> {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [{ path, value }];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenNumericValues(item, `${path}[${index}]`));
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

function extractZeptoCartTotals(payload: Record<string, unknown>, fallbackItems: CartItem[]) {
  const subtotalPaisa =
    findNumericByKeywords(payload, ["subtotal"]) ??
    findNumericByKeywords(payload, ["sub", "total"]) ??
    findNumericByKeywords(payload, ["item", "total"]) ??
    fallbackItems.reduce((sum, item) => sum + item.price * 100, 0);
  const totalPaisa =
    findNumericByKeywords(payload, ["total", "payable"]) ??
    findNumericByKeywords(payload, ["grand", "total"]) ??
    findNumericByKeywords(payload, ["total"]) ??
    subtotalPaisa;
  const feesPaisa = Math.max(0, totalPaisa - subtotalPaisa);

  return {
    subtotal: Math.round(subtotalPaisa / 100),
    fees: Math.round(feesPaisa / 100),
    total: Math.round(totalPaisa / 100),
  };
}

function buildTrackingUpdates(stage: "confirmed" | "packing" | "on-the-way"): TrackingUpdate[] {
  return [
    {
      id: "order-confirmed",
      label: "Order confirmed",
      detail: "Zepto accepted your order.",
      complete: true,
    },
    {
      id: "packing",
      label: "Packing",
      detail: "Your order is being packed.",
      complete: stage === "packing" || stage === "on-the-way",
    },
    {
      id: "out-for-delivery",
      label: "On the way",
      detail: "Your rider is heading to you.",
      complete: stage === "on-the-way",
    },
  ];
}

function mapZeptoTrackingStage(payload: Record<string, unknown>) {
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
    lower.includes("dispatched") ||
    lower.includes("rider")
  ) {
    return "on-the-way" as const;
  }
  if (
    lower.includes("packing") ||
    lower.includes("picked") ||
    lower.includes("processing") ||
    lower.includes("prepared")
  ) {
    return "packing" as const;
  }
  return "confirmed" as const;
}

function extractZeptoEta(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  const direct =
    stringifyUnknown(data.eta) ??
    stringifyUnknown(data.estimatedDeliveryTime) ??
    stringifyUnknown(data.deliveryEta);
  if (direct) return direct;
  const etaMins =
    extractNumber(data.etaMinutes) ??
    extractNumber(data.estimatedDeliveryMinutes) ??
    extractNumber(data.deliveryEtaMinutes);
  if (etaMins !== null) {
    return `${Math.round(etaMins)} min`;
  }
  return "10-20 min";
}

function extractZeptoOrderId(payload: Record<string, unknown>) {
  const data = asRecord(payload.data) ?? payload;
  return (
    stringifyUnknown(data.orderId) ??
    stringifyUnknown(data.id) ??
    stringifyUnknown(data.order_id)
  );
}

async function runZeptoSetup(args: {
  client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResultLike> };
  tools: Array<{ name: string }>;
  addressId?: string | null;
  pushSetupStep?: (step: { tool: string; ok: boolean }) => void;
}) {
  if (args.addressId) {
    const selectAddressTool = pickToolName(args.tools, [
      "select_saved_address",
      "select address",
    ]);
    if (selectAddressTool) {
      const result = await args.client.callTool({
        name: selectAddressTool,
        arguments: { addressId: args.addressId },
      });
      args.pushSetupStep?.({ tool: selectAddressTool, ok: !result.isError });
      if (result.isError) {
        throw new Error("Zepto address selection failed.");
      }
    }
  }

  const serviceabilityTool = pickToolName(args.tools, [
    "get_location_serviceability",
    "serviceability",
  ]);
  if (serviceabilityTool) {
    const result = await args.client.callTool({
      name: serviceabilityTool,
      arguments: {},
    });
    args.pushSetupStep?.({ tool: serviceabilityTool, ok: !result.isError });
  }

  const selectStoreTool = pickToolName(args.tools, ["select_store", "select store"]);
  if (selectStoreTool) {
    const result = await args.client.callTool({
      name: selectStoreTool,
      arguments: {},
    });
    args.pushSetupStep?.({ tool: selectStoreTool, ok: !result.isError });
  }
}

export const zeptoProvider = createRemoteGroceryProvider({
  id: "zepto",
  label: "Zepto",
  serverUrl: "https://mcp.zepto.co.in/mcp",
  priceDivisor: 100,
  searchToolCandidates: [
    "search_products",
    "search products",
    "search product",
    "searchProducts",
    "search",
  ],
  addressesToolCandidates: [
    "list_saved_addresses",
    "get_addresses",
    "addresses",
    "list_addresses",
    "address",
  ],
  prepareSearch: async ({ client, tools, addressId, pushSetupStep }) => {
    await runZeptoSetup({
      client,
      tools,
      addressId,
      pushSetupStep,
    });
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
      throw new Error("Zepto needs a delivery address before building the cart.");
    }

    await runZeptoSetup({ client, tools, addressId, pushSetupStep });

    const searchTool = pickToolName(tools, ["search_products"]);
    const updateCartTool = pickToolName(tools, ["update_cart"]);
    const viewCartTool = pickToolName(tools, ["view_cart"]);

    if (!searchTool || !updateCartTool || !viewCartTool) {
      throw new Error("Zepto cart tools are incomplete in this session.");
    }

    const selectedProducts: ZeptoSearchProduct[] = [];
    const unresolvedIngredients: string[] = [];

    for (const ingredient of missingIngredients) {
      let bestHit: ZeptoSearchProduct | null = null;
      for (const query of getIngredientQueryCandidates(ingredient)) {
        const result = await client.callTool({
          name: searchTool,
          arguments: { query },
        });
        const payload = assertZeptoSuccess(result, `Zepto search for ${query}`);
        const candidate = pickBestZeptoProduct(payload, ingredient);
        if (candidate && (!bestHit || candidate.score > bestHit.score)) {
          bestHit = candidate;
        }
        if (candidate && candidate.score > 0) {
          break;
        }
      }

      if (!bestHit || bestHit.score <= 0) {
        unresolvedIngredients.push(ingredient);
        continue;
      }

      selectedProducts.push(bestHit);
    }

    const cartItems: CartItem[] = selectedProducts.map((product) => ({
      id: product.productVariantId,
      name: product.name,
      quantity: product.packSize,
      price: Math.round(product.price / 100),
    }));

    if (!selectedProducts.length) {
      return {
        items: cartItems,
        unresolvedIngredients,
        subtotal: 0,
        fees: 0,
        total: 0,
      };
    }

    const updateCartRequest = {
      addressId,
      deviceId: slug,
      replaceCart: true,
      cartItems: selectedProducts.map((product) => ({
        productVariantId: product.productVariantId,
        storeProductId: product.storeProductId,
        quantity: 1,
        name: product.name,
        label: product.name,
        price: product.price,
        mrp: product.mrp,
        imageUrl: product.imageUrl ?? null,
        packSize: product.packSize,
        availableQuantity: product.availableQuantity,
        isAd: product.isAd,
        variantId: product.variantId ?? product.productVariantId,
        cartProductId: product.cartProductId ?? product.productVariantId,
      })),
    };

    mergeDebugSnapshot("zepto", slug, {
      updateCartRequest,
    });

    const updateResult = await client.callTool({
      name: updateCartTool,
      arguments: {
        deviceId: slug,
        cartItems: updateCartRequest.cartItems,
        replaceCart: true,
      },
    });
    pushSetupStep({ tool: updateCartTool, ok: !updateResult.isError });
    const updatePayload = assertZeptoSuccess(updateResult, "Zepto update_cart");
    mergeDebugSnapshot("zepto", slug, {
      updateCartPayload: updatePayload,
    });

    const viewCartResult = await client.callTool({
      name: viewCartTool,
      arguments: {},
    });
    const cartPayload = assertZeptoSuccess(viewCartResult, "Zepto view_cart");
    mergeDebugSnapshot("zepto", slug, {
      getCartPayload: cartPayload,
    });
    const totals = extractZeptoCartTotals(cartPayload, cartItems);

    return {
      items: cartItems,
      unresolvedIngredients,
      subtotal: totals.subtotal,
      fees: totals.fees,
      total: totals.total,
    };
  },
  placeOrderWithClient: async ({ client, tools, slug, mockMode }) => {
    if (mockMode) {
      const mockOrderId = `ZP-MOCK-${String(Date.now()).slice(-6)}`;
      return {
        status: "ready",
        source: "zepto",
        orderId: mockOrderId,
        mockMode: true,
        tracking: {
          status: "ready",
          source: "zepto",
          orderId: mockOrderId,
          eta: "11 min",
          stage: "confirmed",
          updates: buildTrackingUpdates("confirmed"),
          polledAt: new Date().toISOString(),
        },
      };
    }

    const snapshot = getDebugSnapshot("zepto", slug);
    const draft = asRecord(snapshot?.updateCartRequest);
    const addressId = stringifyUnknown(draft?.addressId);
    const cartItems = Array.isArray(draft?.cartItems) ? draft.cartItems : [];
    const deviceId = stringifyUnknown(draft?.deviceId) ?? slug;

    if (!addressId || !cartItems.length) {
      throw new Error("Zepto checkout needs a live cart and selected address before ordering.");
    }

    await runZeptoSetup({ client, tools, addressId });

    const updateCartTool = pickToolName(tools, ["update_cart"]);
    const getPaymentMethodsTool = pickToolName(tools, ["get_payment_methods"]);
    const createOrderTool = pickToolName(tools, ["create_order"]);

    if (!updateCartTool || !getPaymentMethodsTool || !createOrderTool) {
      throw new Error("Zepto order tools are incomplete in this session.");
    }

    const syncResult = await client.callTool({
      name: updateCartTool,
      arguments: {
        deviceId,
        cartItems,
        replaceCart: true,
      },
    });
    assertZeptoSuccess(syncResult, "Zepto update_cart before order");

    const paymentMethodsResult = await client.callTool({
      name: getPaymentMethodsTool,
      arguments: {},
    });
    const paymentMethodsPayload = assertZeptoSuccess(
      paymentMethodsResult,
      "Zepto get_payment_methods",
    );
    mergeDebugSnapshot("zepto", slug, {
      payload: paymentMethodsPayload,
    });

    const previewResult = await client.callTool({
      name: createOrderTool,
      arguments: {
        confirmOrder: false,
        riderTip: 0,
        userAddressId: addressId,
        useZeptoCash: false,
      },
    });
    const previewPayload = assertZeptoSuccess(previewResult, "Zepto create_order preview");
    mergeDebugSnapshot("zepto", slug, {
      payload: previewPayload,
    });

    const orderResult = await client.callTool({
      name: createOrderTool,
      arguments: {
        confirmOrder: true,
        riderTip: 0,
        userAddressId: addressId,
        useZeptoCash: false,
      },
    });
    const orderPayload = assertZeptoSuccess(orderResult, "Zepto create_order");
    const orderId = extractZeptoOrderId(orderPayload);
    if (!orderId) {
      throw new Error("Zepto checkout did not return an order ID.");
    }

    const tracking = await zeptoTrackOrder({
      client,
      tools,
      orderId,
    });

    return {
      status: "ready",
      source: "zepto",
      orderId,
      mockMode: false,
      tracking,
    };
  },
  trackOrderWithClient: async ({ client, tools, orderId }) => {
    return zeptoTrackOrder({
      client,
      tools,
      orderId,
    });
  },
});

async function zeptoTrackOrder(args: {
  client: { callTool: (input: { name: string; arguments?: Record<string, unknown> }) => Promise<ToolResultLike> };
  tools: Array<{ name: string }>;
  orderId: string;
}) {
  const detailTool = pickToolName(args.tools, ["get_order_detail"]);
  const historyTool = pickToolName(args.tools, ["list_order_history"]);

  let payload: Record<string, unknown> | null = null;

  if (detailTool) {
    const result = await args.client.callTool({
      name: detailTool,
      arguments: { orderId: args.orderId },
    });
    payload = assertZeptoSuccess(result, "Zepto get_order_detail");
  } else if (historyTool) {
    const result = await args.client.callTool({
      name: historyTool,
      arguments: { limit: 10 },
    });
    payload = assertZeptoSuccess(result, "Zepto list_order_history");
  }

  if (!payload) {
    throw new Error("Zepto order tracking tools are unavailable.");
  }

  const stage = mapZeptoTrackingStage(payload);

  return {
    status: "ready",
    source: "zepto",
    orderId: args.orderId,
    eta: extractZeptoEta(payload),
    stage,
    updates: buildTrackingUpdates(stage),
    polledAt: new Date().toISOString(),
  } as const;
}
