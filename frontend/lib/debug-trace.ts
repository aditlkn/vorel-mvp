import { AsyncLocalStorage } from "node:async_hooks";

type TraceContext = {
  traceId: string;
  slug?: string;
  route?: string;
};

type TraceRecord = {
  at: string;
  traceId: string;
  slug: string;
  route: string;
  scope: string;
  event: string;
  detail: unknown;
};

type MutableTraceGlobal = typeof globalThis & {
  __vorelTraceEvents?: TraceRecord[];
};

const traceStorage = new AsyncLocalStorage<TraceContext>();
const traceGlobal = globalThis as MutableTraceGlobal;

function makeTraceId() {
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isTracingEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.VOREL_DEBUG_TRACE === "1";
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitize(item));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !(
          lower.includes("token") ||
          lower.includes("authorization") ||
          lower.includes("cookie") ||
          lower.includes("secret") ||
          lower.includes("password")
        );
      })
      .slice(0, 20)
      .map(([key, nested]) => [key, sanitize(nested)]);

    return Object.fromEntries(entries);
  }

  return String(value);
}

export function getTraceContext() {
  return traceStorage.getStore() ?? null;
}

function getTraceEventsStore() {
  if (!traceGlobal.__vorelTraceEvents) {
    traceGlobal.__vorelTraceEvents = [];
  }
  return traceGlobal.__vorelTraceEvents;
}

export async function runWithTrace<T>(
  input: Omit<TraceContext, "traceId"> & { traceId?: string },
  fn: () => Promise<T>,
) {
  const context: TraceContext = {
    traceId: input.traceId ?? makeTraceId(),
    slug: input.slug,
    route: input.route,
  };

  return traceStorage.run(context, fn);
}

export function traceEvent(scope: string, event: string, detail?: Record<string, unknown>) {
  if (!isTracingEnabled()) {
    return;
  }

  const context = getTraceContext();
  const payload: TraceRecord = {
    at: new Date().toISOString(),
    traceId: context?.traceId ?? "trace-none",
    slug: context?.slug ?? "",
    route: context?.route ?? "",
    scope,
    event,
    detail: sanitize(detail ?? {}),
  };

  const store = getTraceEventsStore();
  store.unshift(payload);
  if (store.length > 300) {
    store.length = 300;
  }

  console.log(`[vorel-trace] ${JSON.stringify(payload)}`);
}

export function listTraceEvents(input?: {
  slug?: string;
  traceId?: string;
  limit?: number;
}) {
  const slug = input?.slug?.trim().toLowerCase();
  const traceId = input?.traceId?.trim();
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 300));

  return getTraceEventsStore()
    .filter((event) => {
      if (slug && event.slug !== slug) {
        return false;
      }
      if (traceId && event.traceId !== traceId) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export function summarizeTraceEvents(
  events: TraceRecord[],
): Array<{
  at: string;
  traceId: string;
  scope: string;
  event: string;
  summary: string;
}> {
  return events
    .filter((event) =>
      [
        "message_received",
        "process_start",
        "local_intent_parsed",
        "intent_llm_requested",
        "intent_llm_used",
        "intent_llm_skipped",
        "intent_llm_generic_failed",
        "intent_llm_anthropic_failed",
        "intent_llm_exception",
        "follow_up_requested",
        "recipes_ranked",
        "recipe_refresh_requested",
        "recipe_selected",
        "address_selected",
        "build_cart_start",
        "build_cart_finished",
        "cart_state_built",
        "grocery_order_result",
        "food_order_result",
        "tracking_refresh_result",
        "session_finalized",
        "message_failed",
      ].includes(event.event),
    )
    .map((event) => ({
      at: event.at,
      traceId: event.traceId,
      scope: event.scope,
      event: event.event,
      summary: summarizeEvent(event),
    }));
}

function summarizeEvent(event: TraceRecord) {
  const detail = (event.detail ?? {}) as Record<string, unknown>;

  switch (event.event) {
    case "message_received":
      return `User: ${String(detail.text ?? "").slice(0, 120)}`;
    case "process_start":
      return `Stage ${String(detail.stage ?? "")} started`;
    case "local_intent_parsed":
      return `Intent -> source=${String(detail.intentSource ?? "")}, mode=${String(detail.discoveryMode ?? "")}, pantry=${String(detail.pantryCount ?? 0)}, time=${String(detail.maxTime ?? "")}, diet=${String(detail.diet ?? "")}, refresh=${String(detail.refreshIntent ?? false)}`;
    case "intent_llm_requested":
      return `LLM fallback requested (${String(detail.reason ?? "low_confidence")})`;
    case "intent_llm_used":
      return `LLM fallback used (${String(detail.intentSource ?? detail.provider ?? "unknown")}) with confidence ${String(detail.confidence ?? "")}`;
    case "intent_llm_skipped":
      return `LLM fallback returned no usable result`;
    case "intent_llm_generic_failed":
      return `DeepSeek fallback failed (${String(detail.status ?? detail.reason ?? "unknown")})`;
    case "intent_llm_anthropic_failed":
      return `Anthropic fallback failed (${String(detail.status ?? detail.reason ?? "unknown")})`;
    case "intent_llm_exception":
      return `Intent fallback exception: ${String(detail.message ?? "unknown")}`;
    case "follow_up_requested":
      return `Asked follow-up: ${String(detail.missing ?? "")}`;
    case "recipes_ranked":
      return `Ranked ${String(detail.count ?? 0)} recipes`;
    case "recipe_refresh_requested":
      return `Reroll requested`;
    case "recipe_selected":
      return `Selected recipe: ${String(detail.recipe ?? "")}`;
    case "address_selected":
      return `Selected address`;
    case "build_cart_start":
      return `Building ${String(detail.provider ?? "")} cart`;
    case "build_cart_finished":
      return `Cart build ${String(detail.status ?? "")}`;
    case "cart_state_built":
      return `Cart state: ${String(detail.kind ?? "")}`;
    case "grocery_order_result":
      return `Grocery order ${String(detail.status ?? "")}`;
    case "food_order_result":
      return `Food order ${String(detail.status ?? "")}`;
    case "tracking_refresh_result":
      return `Tracking refresh ${String(detail.status ?? "")}`;
    case "session_finalized":
      return `Assistant replied with ${String((detail.lastAssistant as Record<string, unknown> | undefined)?.type ?? "")}`;
    case "message_failed":
      return `Request failed: ${String((detail.error as Record<string, unknown> | undefined)?.message ?? "")}`;
    default:
      return event.event;
  }
}

export function traceError(scope: string, event: string, error: unknown, detail?: Record<string, unknown>) {
  const normalized =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
        }
      : {
          message: String(error),
        };

  traceEvent(scope, event, {
    ...detail,
    error: normalized,
  });
}
