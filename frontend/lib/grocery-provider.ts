import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthTokens,
  type Tool,
} from "@modelcontextprotocol/client";
import type {
  CartItem,
  DineoutRestaurantSuggestion,
  DineoutSlotSuggestion,
  RestaurantSuggestion,
  TrackingUpdate,
} from "@/lib/chat";
import { traceError, traceEvent } from "@/lib/debug-trace";
import { scoreIngredientProductMatch } from "@/lib/ingredient-search";
import {
  clearPersistedAuthState,
  getPersistedAuthState,
  savePersistedAuthState,
} from "@/lib/grocery-auth-store";

export type GroceryProviderId =
  | "swiggy-instamart"
  | "zepto"
  | "swiggy-food"
  | "swiggy-dineout";

export type SavedAddress = {
  id: string;
  addressLine: string;
  addressTag?: string;
  lat?: number;
  lng?: number;
};

export type AddressCreateInput = {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  tag?: string;
  lat?: number;
  lng?: number;
};

type SearchProduct = {
  id: string;
  name: string;
  quantity: string;
  price: number;
  score: number;
  packSizeScore: number;
};

type RestaurantSearchValue = {
  restaurants: RestaurantSuggestion[];
};

type FoodCartValue = {
  restaurantId: string;
  restaurantName: string;
  addressId: string;
  addressLine: string;
  paymentMethods: string[];
  items: CartItem[];
  subtotal: number;
  fees: number;
  total: number;
};

type DineoutRestaurantSearchValue = {
  restaurants: DineoutRestaurantSuggestion[];
};

type DineoutSlotValue = {
  restaurantId: string;
  restaurantName: string;
  slots: DineoutSlotSuggestion[];
};

type DineoutBookingValue = {
  bookingId: string;
  restaurantName: string;
  bookingStatus: string;
  dateLabel: string;
  timeLabel: string;
  guestCount: number;
  dealTitle?: string;
  addressLine?: string;
};

type DebugSearchValue = {
  payload: Record<string, unknown>;
  normalized?: unknown;
  meta?: Record<string, unknown>;
};

export type GroceryDebugAction =
  | "search"
  | "your_go_to_items"
  | "report_error";

export type GroceryDebugReportInput = {
  tool?: string | null;
  flowDescription?: string | null;
  userNotes?: string | null;
  toolContext?: Record<string, unknown> | null;
};

type CartBuildValue = {
  items: CartItem[];
  unresolvedIngredients: string[];
  subtotal: number;
  fees: number;
  total: number;
  note?: string;
};

type AuthState = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expiresAt?: string;
  delegatedUserId?: string;
  codeVerifier?: string;
  state?: string;
  pendingAuthUrl?: string;
  authorizationServerUrl?: string;
  resourceUrl?: string;
};

type MutableGlobal = typeof globalThis & {
  __vorelGroceryAuth?: Map<GroceryProviderId, Map<string, AuthState>>;
  __vorelGroceryAuthEvents?: AuthEvent[];
};

type RemoteGroceryProviderConfig = {
  id: GroceryProviderId;
  label: string;
  serverUrl: string;
  searchToolCandidates: string[];
  addressesToolCandidates?: string[];
  authScope?: string;
  supportsRefreshToken?: boolean;
  proactiveReauthWindowMs?: number;
  priceDivisor?: number;
  disconnect?: (args: { slug: string; state: AuthState }) => Promise<void>;
  getOrderDetailsWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    orderId: string;
  }) => Promise<GroceryOrderDetailsResult>;
  reportErrorWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    message: string;
    context?: Record<string, unknown>;
  }) => Promise<GroceryReportErrorResult>;
  createAddressWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    input: AddressCreateInput;
  }) => Promise<GroceryAddressMutationResult>;
  deleteAddressWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    addressId: string;
  }) => Promise<GroceryAddressMutationResult>;
  buildCartWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    missingIngredients: string[];
    addressId?: string | null;
    pushSetupStep: (step: { tool: string; ok: boolean }) => void;
  }) => Promise<CartBuildValue>;
  placeOrderWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    mockMode: boolean;
  }) => Promise<GroceryOrderReadyResult>;
  trackOrderWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    orderId: string;
  }) => Promise<GroceryTrackingReadyResult>;
  searchRestaurantsWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    query: string;
    addressId?: string | null;
  }) => Promise<RestaurantSearchValue>;
  buildFoodCartWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    addressId: string;
    restaurantId: string;
    query: string;
  }) => Promise<FoodCartValue>;
  searchDineoutRestaurantsWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    query: string;
    addressId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    entityType?: string | null;
  }) => Promise<DineoutRestaurantSearchValue>;
  debugSearchWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    query: string;
    addressId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    entityType?: string | null;
    pushSetupStep: (step: { tool: string; ok: boolean }) => void;
  }) => Promise<DebugSearchValue>;
  debugActionWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    action: GroceryDebugAction;
    query?: string | null;
    report?: GroceryDebugReportInput | null;
    addressId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    entityType?: string | null;
    pushSetupStep: (step: { tool: string; ok: boolean }) => void;
  }) => Promise<DebugSearchValue>;
  getDineoutSlotsWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    restaurantId: string;
    restaurantName: string;
    guestCount: number;
    latitude: number;
    longitude: number;
  }) => Promise<DineoutSlotValue>;
  bookDineoutTableWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    restaurantId: string;
    slotId: string;
    guestCount: number;
  }) => Promise<DineoutBookingValue>;
  getDineoutBookingStatusWithClient?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    bookingId: string;
  }) => Promise<DineoutBookingValue>;
  prepareSearch?: (args: {
    client: Client;
    tools: Tool[];
    slug: string;
    addressId?: string | null;
    pushSetupStep: (step: { tool: string; ok: boolean }) => void;
  }) => Promise<void>;
};

export type AuthEvent = {
  at: string;
  provider: GroceryProviderId;
  slug: string;
  stage:
    | "begin_auth"
    | "auth_redirect"
    | "preflight_reauth"
    | "token_expired"
    | "callback_received"
    | "callback_missing_fields"
    | "callback_error"
    | "finish_auth_start"
    | "finish_auth_success"
    | "finish_auth_error";
  detail?: Record<string, string>;
};

export type GroceryCartResult =
  | GroceryCartReadyResult
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryCartReadyResult = {
  status: "ready";
  items: CartItem[];
  unresolvedIngredients: string[];
  source: GroceryProviderId;
  subtotal: number;
  fees: number;
  total: number;
  note?: string;
};

export type GroceryOrderReadyResult = {
  status: "ready";
  source: GroceryProviderId;
  orderId: string;
  mockMode: boolean;
  tracking: GroceryTrackingReadyResult;
};

export type GroceryOrderResult =
  | GroceryOrderReadyResult
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryTrackingReadyResult = {
  status: "ready";
  source: GroceryProviderId;
  orderId: string;
  eta: string;
  stage: "confirmed" | "packing" | "on-the-way";
  updates: TrackingUpdate[];
  polledAt: string;
};

export type GroceryTrackingResult =
  | GroceryTrackingReadyResult
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryAddressResult =
  | {
      status: "ready";
      addresses: SavedAddress[];
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryDisconnectResult =
  | {
      status: "ready";
    }
  | GroceryUnavailableResult;

export type GroceryOrderDetailsResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      orderId: string;
      payload: Record<string, unknown>;
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryReportErrorResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      payload: Record<string, unknown>;
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryAddressMutationResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      address?: SavedAddress | null;
      deletedAddressId?: string;
      payload?: Record<string, unknown>;
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryRestaurantSearchResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      restaurants: RestaurantSuggestion[];
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryFoodCartResult =
  | ({
      status: "ready";
      source: GroceryProviderId;
    } & FoodCartValue)
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryDineoutSearchResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      restaurants: DineoutRestaurantSuggestion[];
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryDineoutSlotsResult =
  | ({
      status: "ready";
      source: GroceryProviderId;
    } & DineoutSlotValue)
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryDineoutBookingResult =
  | ({
      status: "ready";
      source: GroceryProviderId;
    } & DineoutBookingValue)
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryDebugSearchResult =
  | {
      status: "ready";
      source: GroceryProviderId;
      payload: Record<string, unknown>;
      normalized?: unknown;
      meta?: Record<string, unknown>;
    }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult;

export type GroceryUnavailableResult = {
  status: "unavailable";
  reason: string;
  errorCode?: string;
};

export type GroceryAuthRequiredResult = {
  status: "auth_required";
  authUrl: string;
  authReason: "expired" | "revoked" | "missing";
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const globalStore = globalThis as MutableGlobal;

function deriveExpiryDate(tokens: OAuthTokens) {
  const record = tokens as Record<string, unknown>;
  if (typeof record.expires_at === "number" && Number.isFinite(record.expires_at)) {
    return new Date(record.expires_at * 1000);
  }
  if (typeof record.expires_in === "number" && Number.isFinite(record.expires_in)) {
    return new Date(Date.now() + record.expires_in * 1000);
  }
  if (typeof record.exp === "number" && Number.isFinite(record.exp)) {
    return new Date(record.exp * 1000);
  }

  const accessToken = typeof record.access_token === "string" ? record.access_token : null;
  if (!accessToken) {
    return null;
  }

  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return new Date(payload.exp * 1000);
    }
  } catch {
    return null;
  }

  return null;
}

function deriveDelegatedUserId(tokens: OAuthTokens) {
  const record = tokens as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : null;
  if (!accessToken) {
    return null;
  }

  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return (
      (typeof payload.user_id === "string" && payload.user_id) ||
      (typeof payload.sub === "string" && payload.sub) ||
      null
    );
  } catch {
    return null;
  }
}

function getAuthEvents() {
  if (!globalStore.__vorelGroceryAuthEvents) {
    globalStore.__vorelGroceryAuthEvents = [];
  }
  return globalStore.__vorelGroceryAuthEvents;
}

export function recordGroceryAuthEvent(event: AuthEvent) {
  const events = getAuthEvents();
  events.unshift(event);
  if (events.length > 100) {
    events.length = 100;
  }
  traceEvent("grocery-auth", event.stage, {
    provider: event.provider,
    slug: event.slug,
    ...event.detail,
  });
}

export function listGroceryAuthEvents(provider?: GroceryProviderId, slug?: string) {
  return getAuthEvents().filter((event) => {
    if (provider && event.provider !== provider) return false;
    if (slug && event.slug !== slug.trim().toLowerCase()) return false;
    return true;
  });
}

type DebugSnapshot = {
  tools: string[];
  toolSchemas?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  addresses?: SavedAddress[];
  searchTool?: string;
  searchHistory?: Array<{
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
  }>;
  setupSteps?: Array<{
    tool: string;
    ok: boolean;
  }>;
  payload?: unknown;
  productCount?: number;
  bestProduct?: {
    id: string;
    name: string;
    quantity: string;
    price: number;
    score: number;
  } | null;
  updateCartRequest?: unknown;
  updateCartPayload?: unknown;
  getCartPayload?: unknown;
};

type MutableDebugGlobal = typeof globalThis & {
  __vorelGroceryDebug?: Record<string, DebugSnapshot>;
};

function setDebugSnapshot(providerId: GroceryProviderId, slug: string, snapshot: DebugSnapshot) {
  const debugStore = globalThis as MutableDebugGlobal;
  if (!debugStore.__vorelGroceryDebug) {
    debugStore.__vorelGroceryDebug = {};
  }
  debugStore.__vorelGroceryDebug[`${providerId}:${slug.trim().toLowerCase()}`] = snapshot;
}

export function getDebugSnapshot(providerId: GroceryProviderId, slug: string) {
  const debugStore = globalThis as MutableDebugGlobal;
  return debugStore.__vorelGroceryDebug?.[`${providerId}:${slug.trim().toLowerCase()}`] ?? null;
}

export function mergeDebugSnapshot(
  providerId: GroceryProviderId,
  slug: string,
  patch: Partial<DebugSnapshot>,
) {
  appendDebugSnapshot(providerId, slug, patch);
}

function appendDebugSnapshot(
  providerId: GroceryProviderId,
  slug: string,
  patch: Partial<DebugSnapshot>,
) {
  const current = getDebugSnapshot(providerId, slug) ?? { tools: [] };
  setDebugSnapshot(providerId, slug, {
    ...current,
    ...patch,
    searchHistory:
      patch.searchHistory ?? current.searchHistory,
  });
}

function getAuthStore(providerId: GroceryProviderId) {
  if (!globalStore.__vorelGroceryAuth) {
    globalStore.__vorelGroceryAuth = new Map();
  }

  const root = globalStore.__vorelGroceryAuth;
  if (!root.has(providerId)) {
    root.set(providerId, new Map());
  }

  return root.get(providerId)!;
}

function getAuthState(providerId: GroceryProviderId, slug: string) {
  const store = getAuthStore(providerId);
  const key = slug.trim().toLowerCase();
  if (!store.has(key)) {
    store.set(key, getPersistedAuthState(providerId, key));
  }
  return store.get(key)!;
}

function persistAuthState(
  providerId: GroceryProviderId,
  slug: string,
  state: AuthState,
) {
  savePersistedAuthState(providerId, slug, state);
}

function buildRedirectUrl(providerId: GroceryProviderId, slug: string) {
  return `${APP_URL}/callback?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(providerId)}`;
}

async function startAuthorization(
  config: RemoteGroceryProviderConfig,
  slug: string,
  stage: AuthEvent["stage"] = "begin_auth",
) {
  recordGroceryAuthEvent({
    at: new Date().toISOString(),
    provider: config.id,
    slug: slug.trim().toLowerCase(),
    stage,
  });

  const provider = createOAuthProvider(config, slug);
  const result = await auth(provider, {
    serverUrl: new URL(config.serverUrl),
  });

  if (result !== "REDIRECT") {
    throw new Error(`Expected ${config.label} auth redirect, got ${result}.`);
  }

  const authUrl = getAuthState(config.id, slug).pendingAuthUrl;
  if (!authUrl) {
    throw new Error(`${config.label} did not return an authorization URL.`);
  }

  recordGroceryAuthEvent({
    at: new Date().toISOString(),
    provider: config.id,
    slug: slug.trim().toLowerCase(),
    stage: "auth_redirect",
    detail: {
      authUrl,
      redirectUri: buildRedirectUrl(config.id, slug),
    },
  });

  return authUrl;
}

function isTokenNearExpiry(
  config: RemoteGroceryProviderConfig,
  state: AuthState,
) {
  if (!state.expiresAt) {
    return false;
  }

  const expiry = Date.parse(state.expiresAt);
  if (!Number.isFinite(expiry)) {
    return false;
  }

  const bufferMs = config.proactiveReauthWindowMs ?? 60_000;
  return expiry <= Date.now() + bufferMs;
}

function getErrorStatus(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number") {
      return record.status;
    }
    const cause = record.cause;
    if (cause && typeof cause === "object" && typeof (cause as Record<string, unknown>).status === "number") {
      return (cause as Record<string, unknown>).status as number;
    }
  }
  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

function classifyAuthReason(error: unknown): "expired" | "revoked" | "missing" {
  const status = getErrorStatus(error);
  if (status === 419) {
    return "revoked";
  }

  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("419") || message.includes("revoked")) {
    return "revoked";
  }

  if (message.includes("expired") || status === 401) {
    return "expired";
  }

  return "missing";
}

function pickToolName(tools: Tool[], candidates: string[]) {
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

function parseTextPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractPayload(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}) {
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
    const parsed = parseTextPayload(item.text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }

  return null;
}

function extractProducts(payload: Record<string, unknown> | null) {
  if (!payload) {
    return [];
  }

  const dataBlock =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;

  const collections = [
    payload.products,
    payload.items,
    payload.results,
    payload.data,
    dataBlock?.products,
    dataBlock?.items,
    dataBlock?.results,
  ];

  for (const collection of collections) {
    if (Array.isArray(collection)) {
      return collection;
    }
  }

  return [];
}

function extractAddresses(payload: Record<string, unknown> | null) {
  const candidateBlocks = [
    payload,
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null,
  ];

  for (const block of candidateBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const addresses =
      Array.isArray((block as Record<string, unknown>).addresses)
        ? ((block as Record<string, unknown>).addresses as unknown[])
        : Array.isArray((block as Record<string, unknown>).locations)
          ? ((block as Record<string, unknown>).locations as unknown[])
          : Array.isArray((block as Record<string, unknown>).savedLocations)
            ? ((block as Record<string, unknown>).savedLocations as unknown[])
            : Array.isArray((block as Record<string, unknown>).data)
              ? ((block as Record<string, unknown>).data as unknown[])
              : null;
    if (!addresses) {
      continue;
    }

    return addresses
      .map((address) => {
        if (!address || typeof address !== "object") {
          return null;
        }

        const record = address as Record<string, unknown>;
        if (typeof record.id !== "string" || !record.id) {
          return null;
        }

        return {
          id: record.id,
          addressLine:
            typeof record.addressLine === "string"
              ? record.addressLine
              : typeof record.address === "string"
                ? record.address
                : typeof record.locationName === "string"
                  ? record.locationName
                  : typeof record.name === "string"
                    ? record.name
                : "",
          addressTag:
            typeof record.addressTag === "string"
              ? record.addressTag
              : typeof record.tag === "string"
                ? record.tag
                : typeof record.name === "string"
                  ? record.name
                : undefined,
          lat:
            typeof record.lat === "number"
              ? record.lat
              : typeof record.latitude === "number"
                ? record.latitude
                : typeof asRecord(record.location)?.latitude === "number"
                  ? (asRecord(record.location)?.latitude as number)
                  : undefined,
          lng:
            typeof record.lng === "number"
              ? record.lng
              : typeof record.longitude === "number"
                ? record.longitude
                : typeof asRecord(record.location)?.longitude === "number"
                  ? (asRecord(record.location)?.longitude as number)
                  : undefined,
        } satisfies SavedAddress;
      })
      .filter(Boolean) as SavedAddress[];
  }

  return [];
}

function normalizePrice(product: Record<string, unknown>) {
  const candidates = [
    product.price,
    product.selling_price,
    product.sellingPrice,
    product.current_price,
    product.currentPrice,
    product.final_price,
    product.finalPrice,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate.replace(/[^\d.]/g, ""));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeNestedPrice(priceBlock: unknown) {
  if (!priceBlock || typeof priceBlock !== "object") {
    return null;
  }

  const price = priceBlock as Record<string, unknown>;
  const candidates = [
    price.offerPrice,
    price.offer_price,
    price.sellingPrice,
    price.selling_price,
    price.currentPrice,
    price.current_price,
    price.mrp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate.replace(/[^\d.]/g, ""));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeQuantity(product: Record<string, unknown>) {
  const candidates = [
    product.weight,
    product.quantity,
    product.pack_size,
    product.packSize,
    product.size,
    product.variant_name,
    product.variantName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "1 pack";
}

function scoreProductMatch(name: string, ingredient: string) {
  return scoreIngredientProductMatch(name, ingredient);
}

function estimatePackSizeScore(quantity: string) {
  const lower = quantity.toLowerCase();
  const numberMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const amount = numberMatch ? Number(numberMatch[1]) : null;

  if (amount === null || !Number.isFinite(amount)) {
    return Number.POSITIVE_INFINITY;
  }

  if (/\b(kg|kilogram|kilograms)\b/.test(lower)) {
    return amount * 1000;
  }
  if (/\b(g|gm|gram|grams)\b/.test(lower)) {
    return amount;
  }
  if (/\b(l|litre|liter|litres|liters)\b/.test(lower)) {
    return amount * 1000;
  }
  if (/\b(ml|millilitre|milliliter|millilitres|milliliters)\b/.test(lower)) {
    return amount;
  }
  if (/\b(pc|pcs|piece|pieces|pack|packs|bunch|bunches|cup|cups)\b/.test(lower)) {
    return amount;
  }

  return amount;
}

function normalizeVariation(variation: unknown) {
  if (!variation || typeof variation !== "object") {
    return null;
  }

  const record = variation as Record<string, unknown>;
  const idValue = record.spinId ?? record.id ?? record.sku;
  const nameValue = record.displayName ?? record.name ?? record.title;
  const quantityValue =
    record.quantityDescription ??
    record.quantity ??
    record.weight ??
    record.size;
  const price =
    normalizeNestedPrice(record.price) ?? normalizePrice(record);

  if (!idValue || !nameValue || price === null) {
    return null;
  }

  return {
    id: String(idValue),
    name: String(nameValue),
    quantity:
      typeof quantityValue === "string" && quantityValue.trim()
        ? quantityValue.trim()
        : "1 pack",
    price,
    inStock:
      record.isInStockAndAvailable === true ||
      record.inStock === true ||
      record.isAvail === true,
  };
}

function normalizeProduct(product: unknown, ingredient: string): SearchProduct | null {
  if (!product || typeof product !== "object") {
    return null;
  }

  const record = product as Record<string, unknown>;
  const productName =
    record.displayName ??
    record.name ??
    record.title ??
    record.product_name ??
    record.productName;
  const variations = Array.isArray(record.variations) ? record.variations : [];
  const normalizedVariations = variations
    .map((variation) => normalizeVariation(variation))
    .filter((variation): variation is NonNullable<typeof variation> => variation !== null);

  const bestVariation =
    normalizedVariations.find((variation) => variation.inStock) ??
    normalizedVariations[0];

  if (bestVariation && productName) {
    return {
      id: bestVariation.id,
      name: String(productName),
      quantity: bestVariation.quantity,
      price: bestVariation.price,
      score: scoreProductMatch(String(productName), ingredient),
      packSizeScore: estimatePackSizeScore(bestVariation.quantity),
    };
  }

  const idValue =
    record.id ?? record.product_id ?? record.productId ?? record.sku;
  const nameValue = productName;
  const price = normalizeNestedPrice(record.price) ?? normalizePrice(record);

  if (!idValue || !nameValue || price === null) {
    return null;
  }

  return {
    id: String(idValue),
    name: String(nameValue),
    quantity: normalizeQuantity(record),
    price,
    score: scoreProductMatch(String(nameValue), ingredient),
    packSizeScore: estimatePackSizeScore(normalizeQuantity(record)),
  };
}

function pickBestProduct(products: unknown[], ingredient: string) {
  return products
    .map((item) => normalizeProduct(item, ingredient))
    .filter((item): item is SearchProduct => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.packSizeScore !== right.packSizeScore) {
        return left.packSizeScore - right.packSizeScore;
      }
      if (left.price !== right.price) {
        return left.price - right.price;
      }
      return left.name.localeCompare(right.name);
    })[0] ?? null;
}

function createOAuthProvider(config: RemoteGroceryProviderConfig, slug: string): OAuthClientProvider {
  const state = getAuthState(config.id, slug);
  const persist = () => persistAuthState(config.id, slug, state);

  return {
    get redirectUrl() {
      return buildRedirectUrl(config.id, slug);
    },
    get clientMetadata() {
      return {
        client_name: "Vorel",
        redirect_uris: [buildRedirectUrl(config.id, slug)],
        grant_types:
          config.supportsRefreshToken === false
            ? ["authorization_code"]
            : ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: config.authScope ?? "offline_access",
      };
    },
    async state() {
      if (!state.state) {
        state.state = crypto.randomUUID();
        persist();
      }
      return state.state;
    },
    clientInformation() {
      return state.clientInformation;
    },
    saveClientInformation(clientInformation) {
      state.clientInformation = clientInformation;
      persist();
    },
    tokens() {
      return state.tokens;
    },
    saveTokens(tokens) {
      state.tokens = tokens;
      state.expiresAt = deriveExpiryDate(tokens)?.toISOString();
      state.delegatedUserId = deriveDelegatedUserId(tokens) ?? state.delegatedUserId;
      persist();
    },
    redirectToAuthorization(authorizationUrl) {
      state.pendingAuthUrl = authorizationUrl.toString();
      persist();
    },
    saveCodeVerifier(codeVerifier) {
      state.codeVerifier = codeVerifier;
      persist();
    },
    codeVerifier() {
      if (!state.codeVerifier) {
        throw new Error(`${config.label} auth has no code verifier for this slug.`);
      }
      return state.codeVerifier;
    },
    invalidateCredentials(scope) {
      if (scope === "all" || scope === "tokens") {
        state.tokens = undefined;
      }
      if (scope === "all" || scope === "client") {
        state.clientInformation = undefined;
      }
      if (scope === "all" || scope === "verifier") {
        state.codeVerifier = undefined;
        state.state = undefined;
      }
      persist();
    },
    saveAuthorizationServerUrl(authorizationServerUrl) {
      state.authorizationServerUrl = authorizationServerUrl;
      persist();
    },
    authorizationServerUrl() {
      return state.authorizationServerUrl;
    },
    saveResourceUrl(resourceUrl) {
      state.resourceUrl = resourceUrl;
      persist();
    },
    resourceUrl() {
      return state.resourceUrl;
    },
  };
}

async function withClient<T>(
  config: RemoteGroceryProviderConfig,
  slug: string,
  run: (client: Client) => Promise<T>,
): Promise<
  | { status: "ready"; value: T }
  | GroceryAuthRequiredResult
  | GroceryUnavailableResult
> {
  const authState = getAuthState(config.id, slug);
  traceEvent("grocery-provider", "client_prepare", {
    provider: config.id,
    slug,
    hasTokens: Boolean(authState.tokens),
    expiresAt: authState.expiresAt ?? "",
  });
  if (authState.tokens && isTokenNearExpiry(config, authState)) {
    recordGroceryAuthEvent({
      at: new Date().toISOString(),
      provider: config.id,
      slug: slug.trim().toLowerCase(),
      stage: "token_expired",
      detail: {
        expiresAt: authState.expiresAt ?? "",
      },
    });

    const authUrl = await startAuthorization(config, slug, "preflight_reauth");
    return { status: "auth_required", authUrl, authReason: "expired" };
  }

  const provider = createOAuthProvider(config, slug);
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), {
    authProvider: provider,
  });
  const client = new Client({
    name: "vorel",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    traceEvent("grocery-provider", "client_connected", {
      provider: config.id,
      slug,
    });
    const value = await run(client);
    await transport.close();
    traceEvent("grocery-provider", "client_completed", {
      provider: config.id,
      slug,
    });
    return { status: "ready", value };
  } catch (error) {
    await transport.close().catch(() => undefined);

    if (error instanceof UnauthorizedError) {
      const authReason = classifyAuthReason(error);
      const authUrl = await startAuthorization(config, slug, "preflight_reauth");
      traceError("grocery-provider", "client_unauthorized", error, {
        provider: config.id,
        slug,
        authReason,
      });
      return { status: "auth_required", authUrl, authReason };
    }

    traceError("grocery-provider", "client_failed", error, {
      provider: config.id,
      slug,
    });
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : `Unknown ${config.label} error`,
      errorCode:
        error &&
        typeof error === "object" &&
        "providerErrorCode" in error &&
        typeof (error as { providerErrorCode?: unknown }).providerErrorCode === "string"
          ? (error as { providerErrorCode: string }).providerErrorCode
          : undefined,
    };
  }
}

export function createRemoteGroceryProvider(config: RemoteGroceryProviderConfig) {
  return {
    id: config.id,
    label: config.label,
    async beginAuth(slug: string) {
      return startAuthorization(config, slug, "begin_auth");
    },
    async finishAuth(slug: string, code: string, state: string | null) {
      recordGroceryAuthEvent({
        at: new Date().toISOString(),
        provider: config.id,
        slug: slug.trim().toLowerCase(),
        stage: "finish_auth_start",
        detail: {
          hasCode: code ? "true" : "false",
          hasState: state ? "true" : "false",
        },
      });
      const authState = getAuthState(config.id, slug);

      if (authState.state && state && authState.state !== state) {
        throw new Error(`${config.label} auth state mismatch.`);
      }

      const provider = createOAuthProvider(config, slug);
      const result = await auth(provider, {
        serverUrl: new URL(config.serverUrl),
        authorizationCode: code,
      });

      if (result !== "AUTHORIZED") {
        recordGroceryAuthEvent({
          at: new Date().toISOString(),
          provider: config.id,
          slug: slug.trim().toLowerCase(),
          stage: "finish_auth_error",
          detail: {
            result,
          },
        });
        throw new Error(`${config.label} auth did not complete successfully: ${result}.`);
      }

      authState.pendingAuthUrl = undefined;
      authState.state = undefined;
      authState.codeVerifier = undefined;
      persistAuthState(config.id, slug, authState);
      recordGroceryAuthEvent({
        at: new Date().toISOString(),
        provider: config.id,
        slug: slug.trim().toLowerCase(),
        stage: "finish_auth_success",
      });
    },
    hasTokens(slug: string) {
      return Boolean(getAuthState(config.id, slug).tokens?.access_token);
    },
    async listAddresses(slug: string): Promise<GroceryAddressResult> {
      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        appendDebugSnapshot(config.id, slug, {
          tools: tools.map((tool) => tool.name),
          toolSchemas: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        const addressesTool = config.addressesToolCandidates
          ? pickToolName(tools, config.addressesToolCandidates)
          : undefined;

        if (!addressesTool) {
          appendDebugSnapshot(config.id, slug, {
            addresses: [],
          });
          return [];
        }

        const result = await client.callTool({
          name: addressesTool,
          arguments: {},
        });

        if (result.isError) {
          throw new Error(`${config.label} address lookup failed.`);
        }

        const addresses = extractAddresses(extractPayload(result));
        appendDebugSnapshot(config.id, slug, {
          addresses,
        });
        return addresses;
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        addresses: clientResult.value,
      };
    },
    async buildCart(
      slug: string,
      missingIngredients: string[],
      addressId?: string | null,
    ): Promise<GroceryCartResult> {
      traceEvent("grocery-provider", "build_cart_start", {
        provider: config.id,
        slug,
        missingIngredients,
        addressId: addressId ?? "",
      });
      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        if (config.buildCartWithClient) {
          return config.buildCartWithClient({
            client,
            tools,
            slug,
            missingIngredients,
            addressId,
            pushSetupStep(step) {
              appendDebugSnapshot(config.id, slug, {
                setupSteps: [
                  ...((getDebugSnapshot(config.id, slug)?.setupSteps ?? []) as Array<{
                    tool: string;
                    ok: boolean;
                  }>),
                  step,
                ],
              });
            },
          });
        }

        const searchTool = pickToolName(tools, config.searchToolCandidates);
        appendDebugSnapshot(config.id, slug, {
          tools: tools.map((tool) => tool.name),
          searchTool,
        });

        if (!searchTool) {
          throw new Error(`Could not find a ${config.label} product search tool.`);
        }

        if (config.prepareSearch) {
          const setupSteps: Array<{ tool: string; ok: boolean }> = [];
          await config.prepareSearch({
            client,
            tools,
            slug,
            addressId,
            pushSetupStep(step) {
              setupSteps.push(step);
            },
          });
          appendDebugSnapshot(config.id, slug, {
            setupSteps,
          });
        }

        const products: SearchProduct[] = [];
        const unresolvedIngredients: string[] = [];

        for (const ingredient of missingIngredients) {
          const result = await client.callTool({
            name: searchTool,
            arguments: addressId
              ? { query: ingredient, addressId }
              : { query: ingredient },
          });

          if (result.isError) {
            unresolvedIngredients.push(ingredient);
            continue;
          }

          const extractedProducts = extractProducts(extractPayload(result));
          const product = pickBestProduct(extractedProducts, ingredient);

          setDebugSnapshot(config.id, slug, {
            tools: tools.map((tool) => tool.name),
            searchTool,
            payload: extractPayload(result),
            productCount: extractedProducts.length,
            bestProduct: product,
          });

          if (product) {
            products.push(product);
          } else {
            unresolvedIngredients.push(ingredient);
          }
        }

        return {
          items: products.map((product) => ({
            id: product.id,
            name: product.name,
            quantity: product.quantity,
            price: Math.round(product.price / (config.priceDivisor ?? 1)),
          })),
          unresolvedIngredients,
          subtotal: products.reduce(
            (sum, product) => sum + Math.round(product.price / (config.priceDivisor ?? 1)),
            0,
          ),
          fees: products.length ? 27 : 0,
          total:
            products.reduce(
              (sum, product) => sum + Math.round(product.price / (config.priceDivisor ?? 1)),
              0,
            ) + (products.length ? 27 : 0),
          note: undefined,
        };
      });

      if (clientResult.status !== "ready") {
        traceEvent("grocery-provider", "build_cart_finished", {
          provider: config.id,
          slug,
          status: clientResult.status,
          reason: clientResult.status === "unavailable" ? clientResult.reason : "",
        });
        return clientResult;
      }

      traceEvent("grocery-provider", "build_cart_finished", {
        provider: config.id,
        slug,
        status: "ready",
        itemCount: clientResult.value.items.length,
        unresolvedIngredients: clientResult.value.unresolvedIngredients,
        total: clientResult.value.total,
      });
      return {
        status: "ready",
        source: config.id,
        items: clientResult.value.items,
        unresolvedIngredients: clientResult.value.unresolvedIngredients,
        subtotal: clientResult.value.subtotal,
        fees: clientResult.value.fees,
        total: clientResult.value.total,
        note: clientResult.value.note,
      };
    },
    async placeOrder(slug: string, mockMode: boolean): Promise<GroceryOrderResult> {
      if (!config.placeOrderWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} order placement is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.placeOrderWithClient!({
          client,
          tools,
          slug,
          mockMode,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return clientResult.value;
    },
    async trackOrder(slug: string, orderId: string): Promise<GroceryTrackingResult> {
      if (!config.trackOrderWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} order tracking is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.trackOrderWithClient!({
          client,
          tools,
          slug,
          orderId,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return clientResult.value;
    },
    async searchRestaurants(
      slug: string,
      query: string,
      addressId?: string | null,
    ): Promise<GroceryRestaurantSearchResult> {
      if (!config.searchRestaurantsWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} restaurant search is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.searchRestaurantsWithClient!({
          client,
          tools,
          slug,
          query,
          addressId,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        restaurants: clientResult.value.restaurants,
      };
    },
    async buildFoodCart(
      slug: string,
      addressId: string,
      restaurantId: string,
      query: string,
    ): Promise<GroceryFoodCartResult> {
      if (!config.buildFoodCartWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} food cart build is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.buildFoodCartWithClient!({
          client,
          tools,
          slug,
          addressId,
          restaurantId,
          query,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready" as const,
        source: config.id,
        ...clientResult.value,
      };
    },
    async searchDineoutRestaurants(
      slug: string,
      query: string,
      addressId?: string | null,
      latitude?: number | null,
      longitude?: number | null,
      entityType?: string | null,
    ): Promise<GroceryDineoutSearchResult> {
      if (!config.searchDineoutRestaurantsWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} dineout search is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.searchDineoutRestaurantsWithClient!({
          client,
          tools,
          slug,
          query,
          addressId,
          latitude,
          longitude,
          entityType,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        restaurants: clientResult.value.restaurants,
      };
    },
    async debugSearch(
      slug: string,
      query: string,
      addressId?: string | null,
      latitude?: number | null,
      longitude?: number | null,
      entityType?: string | null,
    ): Promise<GroceryDebugSearchResult> {
      if (!config.debugSearchWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} debug search is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        appendDebugSnapshot(config.id, slug, {
          tools: tools.map((tool) => tool.name),
        });
        return config.debugSearchWithClient!({
          client,
          tools,
          slug,
          query,
          addressId,
          latitude,
          longitude,
          entityType,
          pushSetupStep(step) {
            appendDebugSnapshot(config.id, slug, {
              setupSteps: [
                ...((getDebugSnapshot(config.id, slug)?.setupSteps ?? []) as Array<{
                  tool: string;
                  ok: boolean;
                }>),
                step,
              ],
            });
          },
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        payload: clientResult.value.payload,
        normalized: clientResult.value.normalized,
        meta: clientResult.value.meta,
      };
    },
    async debugAction(
      slug: string,
      action: GroceryDebugAction,
      query?: string | null,
      report?: GroceryDebugReportInput | null,
      addressId?: string | null,
      latitude?: number | null,
      longitude?: number | null,
      entityType?: string | null,
    ): Promise<GroceryDebugSearchResult> {
      if (!config.debugActionWithClient) {
        if (action === "search" && config.debugSearchWithClient && query) {
          return this.debugSearch(
            slug,
            query,
            addressId,
            latitude,
            longitude,
            entityType,
          );
        }

        return {
          status: "unavailable",
          reason: `${config.label} debug action ${action} is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        appendDebugSnapshot(config.id, slug, {
          tools: tools.map((tool) => tool.name),
        });
        return config.debugActionWithClient!({
          client,
          tools,
          slug,
          action,
          query,
          report,
          addressId,
          latitude,
          longitude,
          entityType,
          pushSetupStep(step) {
            appendDebugSnapshot(config.id, slug, {
              setupSteps: [
                ...((getDebugSnapshot(config.id, slug)?.setupSteps ?? []) as Array<{
                  tool: string;
                  ok: boolean;
                }>),
                step,
              ],
            });
          },
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        payload: clientResult.value.payload,
        normalized: clientResult.value.normalized,
        meta: clientResult.value.meta,
      };
    },
    async getDineoutSlots(
      slug: string,
      restaurantId: string,
      restaurantName: string,
      guestCount: number,
      latitude: number,
      longitude: number,
    ): Promise<GroceryDineoutSlotsResult> {
      if (!config.getDineoutSlotsWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} dineout slot lookup is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.getDineoutSlotsWithClient!({
          client,
          tools,
          slug,
          restaurantId,
          restaurantName,
          guestCount,
          latitude,
          longitude,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready" as const,
        source: config.id,
        ...clientResult.value,
      };
    },
    async bookDineoutTable(
      slug: string,
      restaurantId: string,
      slotId: string,
      guestCount: number,
    ): Promise<GroceryDineoutBookingResult> {
      if (!config.bookDineoutTableWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} dineout booking is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.bookDineoutTableWithClient!({
          client,
          tools,
          slug,
          restaurantId,
          slotId,
          guestCount,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        ...clientResult.value,
      };
    },
    async getDineoutBookingStatus(
      slug: string,
      bookingId: string,
    ): Promise<GroceryDineoutBookingResult> {
      if (!config.getDineoutBookingStatusWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} dineout booking status is not available.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.getDineoutBookingStatusWithClient!({
          client,
          tools,
          slug,
          bookingId,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }

      return {
        status: "ready",
        source: config.id,
        ...clientResult.value,
      };
    },
    async disconnect(slug: string): Promise<GroceryDisconnectResult> {
      const authState = getAuthState(config.id, slug);

      try {
        if (config.disconnect) {
          await config.disconnect({
            slug,
            state: authState,
          });
        }
      } catch (error) {
        return {
          status: "unavailable",
          reason:
            error instanceof Error
              ? error.message
              : `Could not disconnect ${config.label}.`,
        };
      }

      clearPersistedAuthState(config.id, slug);
      getAuthStore(config.id).delete(slug.trim().toLowerCase());
      return { status: "ready" };
    },
    async getOrderDetails(
      slug: string,
      orderId: string,
    ): Promise<GroceryOrderDetailsResult> {
      if (!config.getOrderDetailsWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} order details are not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.getOrderDetailsWithClient!({
          client,
          tools,
          slug,
          orderId,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }
      return clientResult.value;
    },
    async reportError(
      slug: string,
      message: string,
      context?: Record<string, unknown>,
    ): Promise<GroceryReportErrorResult> {
      if (!config.reportErrorWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} error reporting is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.reportErrorWithClient!({
          client,
          tools,
          slug,
          message,
          context,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }
      return clientResult.value;
    },
    async createAddress(
      slug: string,
      input: AddressCreateInput,
    ): Promise<GroceryAddressMutationResult> {
      if (!config.createAddressWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} address creation is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.createAddressWithClient!({
          client,
          tools,
          slug,
          input,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }
      return clientResult.value;
    },
    async deleteAddress(
      slug: string,
      addressId: string,
    ): Promise<GroceryAddressMutationResult> {
      if (!config.deleteAddressWithClient) {
        return {
          status: "unavailable",
          reason: `${config.label} address deletion is not wired yet.`,
        };
      }

      const clientResult = await withClient(config, slug, async (client) => {
        const { tools } = await client.listTools();
        return config.deleteAddressWithClient!({
          client,
          tools,
          slug,
          addressId,
        });
      });

      if (clientResult.status !== "ready") {
        return clientResult;
      }
      return clientResult.value;
    },
  };
}
