"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatSession,
  DineoutSlotSuggestion,
  RecipeSuggestion,
} from "@/lib/chat";

type ChatShellProps = {
  session: ChatSession;
};

type DebugTraceSummaryItem = {
  at: string;
  traceId: string;
  scope: string;
  event: string;
  summary: string;
};

type DebugTraceEvent = {
  at: string;
  traceId: string;
  slug: string;
  route: string;
  scope: string;
  event: string;
  detail: unknown;
};

type DebugTracePayload = {
  summary: DebugTraceSummaryItem[];
  events: DebugTraceEvent[];
};

type ResolvedIntentEvent = {
  at: string;
  stage: string;
  resolved: Record<string, unknown>;
};

type QuickReplyChip = {
  label: string;
  text?: string;
  href?: string;
};

type StarterMode = NonNullable<ChatSession["entryMode"]>;

const modeIntro: Record<
  StarterMode,
  {
    eyebrow: string;
    title: string;
    detail: string;
    bullets: string[];
    chips: string[];
  }
> = {
  "cook-dinner": {
    eyebrow: "Dinner flow",
    title: "Start from what you want to cook tonight",
    detail:
      "Use this when you want recipe ideas first and only buy what is missing later.",
    bullets: [
      "Best input: craving, pantry, time, and diet.",
      "Outcome: recipe picks, then a pantry-aware missing-ingredients flow.",
    ],
    chips: [
      "I have paneer, onions and rice. 30 mins, veg",
      "Something new, non veg, 45 mins",
      "Quick chicken dinner ideas",
    ],
  },
  "grocery-shopping": {
    eyebrow: "Shopping flow",
    title: "Start from a grocery list, not a recipe",
    detail:
      "Use this when you already know what you need and want a live provider cart fast.",
    bullets: [
      "Best input: list, budget, brand preference, and provider.",
      "Outcome: a live Instamart or Zepto cart instead of recipe discovery.",
    ],
    chips: [
      "Milk, eggs, bread, bananas",
      "Restock fruit, curd and snacks",
      "Need tomatoes, coriander and yogurt on Zepto",
    ],
  },
  "eat-out": {
    eyebrow: "Tonight’s plan",
    title: "Start with delivery or going out",
    detail:
      "Use this when you want Vorel to branch early into delivery or dine-out instead of treating it like cooking.",
    bullets: [
      "Best input: order in or go out, then cuisine, area, budget, or vibe.",
      "Outcome: delivery restaurants or bookable dine-out options.",
    ],
    chips: [
      "Order in, ramen or Thai, non veg",
      "Date night in Koramangala or Indiranagar",
      "Go out for cocktails with friends",
    ],
  },
  "meal-plan": {
    eyebrow: "Planning flow",
    title: "Start with the scope of the plan",
    detail:
      "Use this when you want a multi-meal answer instead of a single dish suggestion.",
    bullets: [
      "Best input: week or party, people, meal count, diet, and prep constraints.",
      "Outcome: a multi-meal plan you can refine or cook from.",
    ],
    chips: [
      "Plan 5 dinners for 2, high protein veg",
      "Party menu for 8, mostly finger food",
      "Meal prep lunches for 4 days",
    ],
  },
  "free-text": {
    eyebrow: "Open route",
    title: "Start anywhere and let Vorel route it",
    detail:
      "Use this when you are not sure which lane fits and want to type naturally.",
    bullets: [
      "Best input: say what you want done in plain language.",
      "Outcome: Vorel routes you into cooking, shopping, dine-out, or planning.",
    ],
    chips: [
      "I want to eat well tonight but don’t know what",
      "Help me restock the kitchen",
      "Need a date night plan in Bangalore",
    ],
  },
};

function formatCurrency(value: number) {
  return `₹${value}`;
}

function dedupeChips(chips: QuickReplyChip[]) {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = `${chip.label}:${chip.text ?? chip.href ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rankLabelsByFrequency(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([label]) => label);
}

function inferTextPromptChips(
  text: string,
  entryMode: StarterMode,
): QuickReplyChip[] {
  const lower = text.toLowerCase();

  if (lower.includes("delivery or do you want to go out")) {
    return [
      { label: "Order in", text: "Order in" },
      { label: "Go out", text: "Go out" },
      { label: "Date night", text: "Date night" },
      { label: "Non veg", text: "Non veg" },
    ];
  }

  if (lower.includes("what’s the occasion") || lower.includes("what's the occasion")) {
    return [
      { label: "No special occasion", text: "No special occasion" },
      { label: "Date night", text: "Date night" },
      { label: "Birthday", text: "Birthday" },
      { label: "Pub hopping", text: "Pub hopping" },
    ];
  }

  if (lower.includes("party size") || lower.includes("budget") || lower.includes("which area")) {
    return [
      { label: "For 2", text: "For 2 people" },
      { label: "Budget", text: "Budget friendly" },
      { label: "Mid-range", text: "Mid-range" },
      { label: "Koramangala", text: "Koramangala" },
      { label: "Indiranagar", text: "Indiranagar" },
    ];
  }

  if (lower.includes("what you already have at home") || lower.includes("what’s in your fridge") || lower.includes("what's in your fridge")) {
    return [
      { label: "Onions, tomatoes", text: "I have onions and tomatoes" },
      { label: "Basic groceries", text: "I have basic groceries" },
      { label: "Order missing items", text: "Assume I need to order the missing groceries" },
    ];
  }

  if (lower.includes("how much time you have")) {
    return [
      { label: "20 mins", text: "20 mins" },
      { label: "30 mins", text: "30 mins" },
      { label: "45 mins", text: "45 mins" },
    ];
  }

  if (lower.includes("veg or non-veg")) {
    return [
      { label: "Veg", text: "Veg" },
      { label: "Non veg", text: "Non veg" },
      { label: "Both", text: "Okay with both veg and non veg" },
    ];
  }

  if (lower.includes("tell me the grocery list")) {
    return [
      { label: "Basic restock", text: "Milk, eggs, bread, bananas" },
      { label: "Fruit and veg", text: "Tomatoes, onions, bananas, spinach" },
      { label: "Use Instamart", text: "Use Swiggy Instamart" },
      { label: "Use Zepto", text: "Use Zepto" },
    ];
  }

  if (entryMode === "eat-out" && lower.includes("what you feel like ordering")) {
    return [
      { label: "Biryani", text: "Biryani" },
      { label: "Burgers", text: "Burgers" },
      { label: "Thai", text: "Thai" },
      { label: "Ramen", text: "Ramen" },
    ];
  }

  return [];
}

export function ChatShell({ session }: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [stage, setStage] = useState(session.stage);
  const [inputValue, setInputValue] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [isDockOpen, setIsDockOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [debugTrace, setDebugTrace] = useState<DebugTracePayload | null>(null);
  const [isDebugLoading, setIsDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [activeDockItem, setActiveDockItem] = useState<"tracking" | "recipe">("tracking");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dockRailRef = useRef<HTMLDivElement | null>(null);

  const resolvedIntentEvents = useMemo<ResolvedIntentEvent[]>(() => {
    return (debugTrace?.events ?? [])
      .filter(
        (event) =>
          event.scope === "chat-engine" &&
          event.event === "local_intent_parsed" &&
          typeof event.detail === "object" &&
          event.detail !== null &&
          "resolved" in event.detail,
      )
      .map((event) => {
        const detail = event.detail as Record<string, unknown>;
        return {
          at: event.at,
          stage: String(detail.stage ?? ""),
          resolved:
            typeof detail.resolved === "object" && detail.resolved !== null
              ? (detail.resolved as Record<string, unknown>)
              : {},
        };
      });
  }, [debugTrace]);

  const entryMode = session.entryMode ?? "free-text";
  const starter = modeIntro[entryMode];
  const showStarterState = useMemo(
    () =>
      messages.length === 1 &&
      messages[0]?.role === "assistant" &&
      messages[0]?.type === "text",
    [messages],
  );

  const recipeCatalog = new Map<string, RecipeSuggestion>();
  for (const message of messages) {
    if (message.type !== "recipes") continue;
    for (const item of message.items) {
      recipeCatalog.set(item.name, item);
    }
  }

  let activeRecipeName: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.type === "cart" ||
      message.type === "provider-carts" ||
      message.type === "restaurants" ||
      message.type === "food-cart"
    ) {
      activeRecipeName = message.recipeName;
      break;
    }
  }

  const activeRecipe = activeRecipeName ? recipeCatalog.get(activeRecipeName) ?? null : null;

  let activeTracking: Extract<ChatMessage, { type: "tracking" }> | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "tracking") {
      activeTracking = message;
      break;
    }
  }

  const lastAssistantMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return message;
      }
    }
    return null;
  }, [messages]);

  const dockItems = useMemo(
    () => [
      ...(activeTracking
        ? [
            {
              key: "tracking" as const,
              label: "Active order",
              title: `Order ${activeTracking.orderId}`,
              meta: `${activeTracking.stage} · ETA ${activeTracking.eta}`,
              tone: "dark" as const,
            },
          ]
        : []),
      ...(activeRecipe
        ? [
            {
              key: "recipe" as const,
              label: "Cooking now",
              title: activeRecipe.name,
              meta: activeRecipe.cookTime,
              tone: "light" as const,
            },
          ]
        : []),
    ],
    [activeRecipe, activeTracking],
  );

  const hasStickyContext = dockItems.length > 0;
  const resolvedActiveDockItem = dockItems.some((item) => item.key === activeDockItem)
    ? activeDockItem
    : dockItems[0]?.key ?? "tracking";

  useEffect(() => {
    const rail = dockRailRef.current;
    if (!rail) return;
    const index = dockItems.findIndex((item) => item.key === resolvedActiveDockItem);
    if (index < 0) return;
    const pageWidth = rail.clientWidth;
    rail.scrollTo({ left: pageWidth * index, behavior: "smooth" });
  }, [dockItems, resolvedActiveDockItem]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, isResponding]);

  useEffect(() => {
    let cancelled = false;

    async function loadDebugTrace() {
      setIsDebugLoading(true);
      setDebugError(null);

      try {
        const response = await fetch(
          `/api/debug/trace?slug=${encodeURIComponent(session.slug)}&limit=120`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error("Failed to load trace");
        }

        const payload = (await response.json()) as DebugTracePayload;
        if (!cancelled) {
          setDebugTrace(payload);
        }
      } catch {
        if (!cancelled) {
          setDebugError("Could not load debug trace.");
        }
      } finally {
        if (!cancelled) {
          setIsDebugLoading(false);
        }
      }
    }

    void loadDebugTrace();
    return () => {
      cancelled = true;
    };
  }, [messages, session.slug]);

  async function submitText(text: string) {
    const next = text.trim();
    if (!next || isResponding) return;

    const optimisticUserMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      type: "text",
      text: next,
    };

    setInputValue("");
    setMessages((current) => [...current, optimisticUserMessage]);
    setIsResponding(true);

    try {
      const response = await fetch(`/api/chat/${session.slug}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: next }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const payload = (await response.json()) as ChatSession;
      setMessages(payload.messages);
      setStage(payload.stage);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: `local-error-${Date.now()}`,
          role: "assistant",
          type: "text",
          text: "Something went wrong while talking to the server. No cart or order action was confirmed. Retry the last step.",
        },
      ]);
    } finally {
      setIsResponding(false);
    }
  }

  function onChooseRecipe(recipe: RecipeSuggestion) {
    void submitText(`Let's make ${recipe.name}.`);
  }

  function onPlaceOrder() {
    void submitText("Place the order.");
  }

  function onConfirmAddress(addressId: string) {
    void submitText(`Use this address ${addressId}.`);
  }

  function onChooseProviderCart(provider: string) {
    void submitText(`Use ${provider} cart.`);
  }

  function onChooseRestaurant(restaurantId: string) {
    void submitText(`Order from restaurant ${restaurantId}.`);
  }

  function onChooseDineoutRestaurant(restaurantId: string) {
    void submitText(`Choose restaurant ${restaurantId}.`);
  }

  function onChooseDineoutSlot(slot: DineoutSlotSuggestion) {
    void submitText(`Book slot ${slot.slotId} at ${slot.timeLabel}.`);
  }

  const quickReplyChips = useMemo(() => {
    if (isResponding) {
      return [];
    }

    if (session.quickReplyChips?.length) {
      return dedupeChips(
        session.quickReplyChips.map((chip) => ({
          label: chip.label,
          text: chip.text,
          href: chip.href,
        })),
      );
    }

    if (lastAssistantMessage?.type === "providers") {
      return dedupeChips(
        lastAssistantMessage.items.map((item) => ({
          label: item.ctaLabel,
          href: item.href,
        })),
      );
    }

    if (lastAssistantMessage?.type === "addresses") {
      return dedupeChips(
        lastAssistantMessage.items.slice(0, 3).map((item) => ({
          label: item.addressTag ?? item.addressLine.split(",")[0] ?? item.ctaLabel,
          text: `Use this address ${item.id}.`,
        })),
      );
    }

    if (lastAssistantMessage?.type === "address-shortcut") {
      return dedupeChips([
        {
          label: lastAssistantMessage.primaryCtaLabel,
          text: "Use the saved address",
        },
        {
          label: lastAssistantMessage.secondaryCtaLabel,
          text: "Show other saved addresses",
        },
      ]);
    }

    if (lastAssistantMessage?.type === "dineout-restaurants") {
      const areaChips = rankLabelsByFrequency(
        lastAssistantMessage.items
          .map((item) => item.sourceAddressLabel?.trim())
          .filter((label): label is string => Boolean(label)),
      )
        .slice(0, 2)
        .map((label) => ({ label, text: label }));

      const cuisineChips = Array.from(
        new Set(
          lastAssistantMessage.items
            .flatMap((item) => item.cuisines)
            .map((cuisine) => cuisine.trim())
            .filter(Boolean),
        ),
      )
        .slice(0, 3)
        .map((cuisine) => ({ label: cuisine, text: cuisine }));

      return dedupeChips([
        ...areaChips,
        ...cuisineChips,
        { label: "Date night", text: "Date night" },
        { label: "Budget", text: "Budget friendly" },
      ]).slice(0, 6);
    }

    if (lastAssistantMessage?.type === "restaurants") {
      const cuisineChips = Array.from(
        new Set(
          lastAssistantMessage.items
            .flatMap((item) => item.cuisines)
            .map((cuisine) => cuisine.trim())
            .filter(Boolean),
        ),
      )
        .slice(0, 3)
        .map((cuisine) => ({ label: cuisine, text: cuisine }));

      return dedupeChips([
        ...cuisineChips,
        { label: "Cheaper", text: "Cheaper" },
        { label: "Faster", text: "Faster delivery" },
        { label: "More like this", text: "More like this" },
        { label: "Veg only", text: "Veg only" },
        { label: "No eggs", text: "No eggs" },
      ]).slice(0, 6);
    }

    if (lastAssistantMessage?.type === "recipes") {
      const recipeNameChips = lastAssistantMessage.items
        .slice(0, 3)
        .map((item) => ({ label: item.name, text: `Let's make ${item.name}.` }));

      return dedupeChips([
        ...recipeNameChips,
        { label: "Something else", text: "Something else" },
        { label: "30 mins", text: "Keep it to 30 mins" },
        { label: "No eggs", text: "No eggs" },
      ]).slice(0, 6);
    }

    if (lastAssistantMessage?.type === "cart" || lastAssistantMessage?.type === "food-cart") {
      return [{ label: "Place order", text: "Place the order." }];
    }

    if (lastAssistantMessage?.type === "text") {
      const inferred = inferTextPromptChips(lastAssistantMessage.text, entryMode);
      if (inferred.length) {
        return dedupeChips(inferred);
      }
    }

    if (stage === "collecting-context") {
      if (entryMode === "cook-dinner" || entryMode === "free-text") {
        return [
          { label: "Veg", text: "Veg" },
          { label: "Non veg", text: "Non veg" },
          { label: "30 mins", text: "30 mins" },
          { label: "45 mins", text: "45 mins" },
          { label: "Something new", text: "Something new" },
        ];
      }
      if (entryMode === "grocery-shopping") {
        return [
          { label: "Basic restock", text: "Milk, eggs, bread, bananas" },
          { label: "Use Instamart", text: "Use Swiggy Instamart" },
          { label: "Use Zepto", text: "Use Zepto" },
          { label: "Budget brands", text: "Keep it budget friendly" },
        ];
      }
      if (entryMode === "eat-out") {
        return [
          { label: "Order in", text: "Order in" },
          { label: "Go out", text: "Go out" },
          { label: "Date night", text: "Date night" },
          { label: "Budget", text: "Budget friendly" },
          { label: "Non veg", text: "Non veg" },
        ];
      }
      if (entryMode === "meal-plan") {
        return [
          { label: "5 dinners", text: "Plan 5 dinners" },
          { label: "For 2 people", text: "For 2 people" },
          { label: "High protein", text: "High protein" },
          { label: "Party", text: "Party for 8" },
        ];
      }
    }

    if (stage === "recipe-selection") {
      return [
        { label: "Something else", text: "Something else" },
        { label: "Veg", text: "Veg only" },
        { label: "Non veg", text: "Non veg only" },
        { label: "30 mins", text: "Keep it to 30 mins" },
        { label: "No eggs", text: "No eggs" },
      ];
    }

    if (stage === "restaurant-fallback") {
      return dedupeChips([
        { label: "Cheaper", text: "Cheaper" },
        { label: "Faster", text: "Faster delivery" },
        { label: "More like this", text: "More like this" },
        { label: "Veg only", text: "Veg only" },
        { label: "No eggs", text: "No eggs" },
        { label: "Lighter", text: "Something lighter" },
      ]);
    }

    if (stage === "dineout-results") {
      return [
        { label: "Date night", text: "Date night" },
        { label: "Birthday", text: "Birthday" },
        { label: "Budget", text: "Budget friendly" },
        { label: "Premium", text: "Premium" },
        { label: "Koramangala", text: "Koramangala" },
      ];
    }

    if (stage === "food-cart-review" || stage === "cart-review") {
      return [{ label: "Place order", text: "Place the order." }];
    }

    if (stage === "dineout-slot-review") {
      return [];
    }

    if (stage === "dineout-booking" || stage === "tracking") {
      return [{ label: "Track status", text: "Track the order" }];
    }

    return [];
  }, [entryMode, isResponding, lastAssistantMessage, stage]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f1e8_0%,#f1ebdf_100%)] text-stone-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        <header className="flex items-center justify-between px-5 pb-3 pt-5">
          <div>
            <p className="font-serif text-3xl font-semibold tracking-tight">
              Vorel
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                slug / {session.slug}
              </p>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                {starter.eyebrow}
              </span>
            </div>
          </div>
          <Link
            href="/"
            className="rounded-full border border-stone-300 bg-white/80 px-3 py-1.5 text-sm text-stone-600"
          >
            Change slug
          </Link>
        </header>

        <div className="px-5 pb-3">
          <button
            type="button"
            onClick={() => setIsDebugOpen((current) => !current)}
            className="rounded-full border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-stone-700"
          >
            {isDebugOpen ? "Hide debug" : "Show debug"}
          </button>
        </div>

        {isDebugOpen ? (
          <section className="mx-4 mb-3 overflow-hidden rounded-[22px] border border-stone-200 bg-white/95 shadow-sm backdrop-blur">
            <div className="border-b border-stone-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Debug trace
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Live view of what Vorel parsed, which branch it took, and whether any LLM fallback was used.
              </p>
            </div>

            <div className="max-h-[42vh] overflow-y-auto px-4 py-4">
              {isDebugLoading ? (
                <p className="text-sm text-stone-500">Loading debug trace…</p>
              ) : null}

              {debugError ? (
                <p className="text-sm text-rose-600">{debugError}</p>
              ) : null}

              {debugTrace?.summary?.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Decision summary
                  </p>
                  <div className="mt-3 space-y-2">
                    {debugTrace.summary.map((item) => (
                      <div
                        key={`${item.traceId}-${item.at}-${item.event}`}
                        className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                            {item.scope}
                          </p>
                          <p className="text-[11px] text-stone-400">
                            {new Date(item.at).toLocaleTimeString()}
                          </p>
                        </div>
                        <p className="mt-2 text-sm font-medium text-stone-900">
                          {item.summary}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !isDebugLoading && !debugError ? (
                <p className="text-sm text-stone-500">No trace events yet for this slug.</p>
              ) : null}

              {resolvedIntentEvents.length ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Resolved intents
                  </p>
                  <div className="mt-3 space-y-2">
                    {resolvedIntentEvents.map((item, index) => (
                      <div
                        key={`${item.at}-${item.stage}-${index}`}
                        className="rounded-2xl border border-stone-200 bg-white px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                            {item.stage || "unknown stage"}
                          </p>
                          <p className="text-[11px] text-stone-400">
                            {new Date(item.at).toLocaleTimeString()}
                          </p>
                        </div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-stone-600">
                          {JSON.stringify(item.resolved, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {debugTrace?.events?.length ? (
                <details className="mt-4 rounded-2xl border border-stone-200 bg-white">
                  <summary className="cursor-pointer list-none px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">
                    Raw events
                  </summary>
                  <div className="border-t border-stone-200 px-3 py-3">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-stone-600">
                      {JSON.stringify(debugTrace.events, null, 2)}
                    </pre>
                  </div>
                </details>
              ) : null}
            </div>
          </section>
        ) : null}

        <section ref={scrollerRef} className="flex-1 overflow-y-auto px-4 pb-28">
          {showStarterState ? (
            <section className="mb-4 overflow-hidden rounded-[28px] border border-stone-200 bg-white/92 shadow-sm backdrop-blur">
              <div className="border-b border-stone-200 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {starter.eyebrow}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-950">
                  {starter.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  {starter.detail}
                </p>
              </div>
              <div className="px-5 py-4">
                <div className="grid gap-2">
                  {starter.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="rounded-2xl bg-stone-50 px-3 py-3 text-sm leading-6 text-stone-700"
                    >
                      {bullet}
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Try one of these
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {starter.chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => void submitText(chip)}
                        className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 transition hover:border-stone-900 hover:text-stone-950"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-3">
            {messages.map((message, index) => {
              if (message.type === "text") {
                const isUser = message.role === "user";

                return (
                  <div
                    key={message.id}
                    className={[
                      "max-w-[85%] rounded-[24px] px-4 py-3 text-[15px] leading-7 shadow-sm",
                      isUser
                        ? "ml-auto rounded-br-md bg-stone-950 text-white"
                        : "rounded-bl-md border border-stone-200 bg-white text-stone-900",
                    ].join(" ")}
                  >
                    {message.text}
                  </div>
                );
              }

              if (message.type === "providers") {
                const providerIds = message.items.map((item) => item.provider);
                const isDineoutOnly =
                  providerIds.length > 0 &&
                  providerIds.every((provider) => provider === "swiggy-dineout");
                const isFoodOnly =
                  providerIds.length > 0 &&
                  providerIds.every((provider) => provider === "swiggy-food");
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {isDineoutOnly
                          ? "Dine out"
                          : isFoodOnly
                            ? "Restaurant search"
                            : "Live grocery sync"}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="overflow-x-auto px-4 py-4">
                      <div className="flex min-w-full gap-3">
                        {message.items.map((item) => (
                          <div
                            key={item.provider}
                            className="w-[240px] shrink-0 rounded-2xl border border-stone-200 bg-stone-50 p-3"
                          >
                            <p className="text-sm font-medium text-stone-900">
                              {item.label}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-stone-600">
                              {item.detail}
                            </p>
                            <a
                              href={item.href}
                              className="mt-3 inline-flex w-full justify-center rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                            >
                              {item.ctaLabel}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              }

              if (message.type === "addresses") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {message.provider === "swiggy-dineout"
                          ? "Saved location"
                          : "Delivery address"}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="overflow-x-auto px-4 py-4">
                      <div className="flex min-w-full gap-3">
                        {message.items.map((item) => (
                          <div
                            key={item.id}
                            className="w-[280px] shrink-0 rounded-2xl border border-stone-200 bg-stone-50 p-3"
                          >
                            {item.addressTag ? (
                              <p className="text-sm font-medium text-stone-900">
                                {item.addressTag}
                              </p>
                            ) : null}
                            <p className="mt-1 text-sm leading-6 text-stone-600">
                              {item.addressLine}
                            </p>
                            <button
                              onClick={() => onConfirmAddress(item.id)}
                              className="mt-3 w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                            >
                              {item.ctaLabel}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              }

              if (message.type === "address-shortcut") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {message.provider === "swiggy-dineout"
                          ? "Saved location"
                          : "Last used address"}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                        {message.addressTag ? (
                          <p className="text-sm font-medium text-stone-900">
                            {message.addressTag}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          {message.addressLine}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          onClick={() => void submitText("Use the saved address")}
                          className="rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                        >
                          {message.primaryCtaLabel}
                        </button>
                        <button
                          onClick={() => void submitText("Show other saved addresses")}
                          className="rounded-full border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700"
                        >
                          {message.secondaryCtaLabel}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              }

              if (message.type === "recipes") {
                return (
                  <div key={message.id} className="space-y-3">
                    <div className="max-w-[85%] rounded-[24px] rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-[15px] leading-7 text-stone-900 shadow-sm">
                      {message.title}
                    </div>

                    <div className="space-y-3">
                      {message.items.map((item) => (
                        <article
                          key={item.id}
                          className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                        >
                          <div className="relative aspect-[16/9] bg-stone-200">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm text-stone-500">
                                No preview available
                              </div>
                            )}
                          </div>
                          <div className="space-y-3 p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h2 className="text-lg font-semibold text-stone-900">
                                  {item.name}
                                </h2>
                                <p className="mt-1 text-sm text-stone-500">
                                  {item.cookTime}
                                </p>
                              </div>
                              <a
                                href={item.youtubeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-stone-700"
                              >
                                Video
                              </a>
                            </div>
                            <p className="text-sm leading-6 text-stone-600">
                              {item.note}
                            </p>
                            <div className="flex gap-2">
                              <button className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700">
                                Skip
                              </button>
                              <button
                                onClick={() => onChooseRecipe(item)}
                                className="rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white"
                              >
                                Choose recipe
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              }

              if (message.type === "cart") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Missing ingredients
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.recipeName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.title}
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {message.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-4 rounded-2xl bg-stone-50 px-3 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-stone-900">
                              {item.name}
                            </p>
                            <p className="mt-1 text-sm text-stone-500">
                              {item.quantity}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-stone-900">
                            {formatCurrency(item.price)}
                          </p>
                        </div>
                      ))}
                      <div className="space-y-2 rounded-2xl border border-stone-200 px-3 py-3">
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Subtotal</span>
                          <span>{formatCurrency(message.subtotal)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Fees</span>
                          <span>{formatCurrency(message.fees)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-stone-950">
                          <span>Total</span>
                          <span>{formatCurrency(message.total)}</span>
                        </div>
                      </div>
                      <button
                        onClick={onPlaceOrder}
                        className="w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                      >
                        Order now
                      </button>
                    </div>
                  </article>
                );
              }

              if (message.type === "provider-carts") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Cart comparison
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.recipeName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.title}
                      </p>
                    </div>
                    <div className="overflow-x-auto px-4 py-4">
                      <div className="flex min-w-full gap-3">
                        {message.items.map((item) => (
                          <div
                            key={item.provider}
                            className="w-[300px] shrink-0 rounded-2xl border border-stone-200 bg-stone-50 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-stone-900">
                                  {item.label}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-stone-600">
                                  {item.title}
                                </p>
                              </div>
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-stone-700">
                                {formatCurrency(item.total)}
                              </span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {item.items.slice(0, 4).map((cartItem) => (
                                <div
                                  key={cartItem.id}
                                  className="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-stone-900">
                                      {cartItem.name}
                                    </p>
                                    <p className="mt-1 text-xs text-stone-500">
                                      {cartItem.quantity}
                                    </p>
                                  </div>
                                  <p className="text-sm font-medium text-stone-900">
                                    {formatCurrency(cartItem.price)}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 space-y-1 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm text-stone-600">
                              <div className="flex items-center justify-between">
                                <span>Subtotal</span>
                                <span>{formatCurrency(item.subtotal)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Fees</span>
                                <span>{formatCurrency(item.fees)}</span>
                              </div>
                              <div className="flex items-center justify-between border-t border-stone-200 pt-2 font-semibold text-stone-950">
                                <span>Total</span>
                                <span>{formatCurrency(item.total)}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => onChooseProviderCart(item.provider)}
                              className="mt-3 w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                            >
                              Choose {item.label}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              }

              if (message.type === "tracking") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Tracking
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-stone-950">
                            Order {message.orderId}
                          </h2>
                          <p className="mt-1 text-sm text-stone-500">
                            ETA {message.eta}
                          </p>
                        </div>
                        <span className="rounded-full bg-stone-950 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-white">
                          {message.stage}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3 p-4">
                      {message.updates.map((update) => (
                        <div key={update.id} className="flex gap-3">
                          <div
                            className={[
                              "mt-1 h-2.5 w-2.5 rounded-full",
                              update.complete ? "bg-stone-950" : "bg-stone-300",
                            ].join(" ")}
                          />
                          <div>
                            <p className="text-sm font-medium text-stone-900">
                              {update.label}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-stone-600">
                              {update.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              }

              if (message.type === "restaurants") {
                const isEatOutDelivery =
                  message.detail.toLowerCase().includes("tonight") ||
                  message.detail.toLowerCase().includes("delivery options");
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {isEatOutDelivery ? "Order in tonight" : "Restaurant fallback"}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.recipeName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {message.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-stone-900">
                                {item.name}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-stone-600">
                                {item.cuisines.join(" · ") || "Restaurant"}
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-stone-700">
                              {item.rating}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.distance}
                            </span>
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.eta}
                            </span>
                            {item.costForTwo ? (
                              <span className="rounded-full bg-white px-3 py-1">
                                {item.costForTwo}
                              </span>
                            ) : null}
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.availabilityStatus}
                            </span>
                          </div>
                          {item.offer || item.matchReason ? (
                            <p className="mt-3 text-sm leading-6 text-stone-600">
                              {item.offer ?? item.matchReason}
                            </p>
                          ) : null}
                          {item.highlights?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                              {item.highlights.slice(0, 2).map((highlight) => (
                                <span
                                  key={highlight}
                                  className="rounded-full border border-stone-200 bg-white px-3 py-1"
                                >
                                  {highlight}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <button
                            onClick={() => onChooseRestaurant(item.id)}
                            className="mt-3 w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                          >
                            {item.ctaLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              }

              if (message.type === "dineout-restaurants") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Dine out tonight
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {message.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-stone-900">
                                {item.name}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-stone-600">
                                {item.cuisines.join(" · ") || "Restaurant"}
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-stone-700">
                              {item.rating}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-600">
                            {item.sourceAddressLabel ? (
                              <span className="rounded-full bg-white px-3 py-1">
                                {item.sourceAddressLabel}
                              </span>
                            ) : null}
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.distance}
                            </span>
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.costForTwo}
                            </span>
                            <span className="rounded-full bg-white px-3 py-1">
                              {item.availabilityStatus}
                            </span>
                          </div>
                          {item.offer ? (
                            <p className="mt-3 text-sm leading-6 text-stone-700">
                              {item.offer}
                            </p>
                          ) : null}
                          {item.highlights.length ? (
                            <p className="mt-2 text-sm leading-6 text-stone-500">
                              {item.highlights.join(" · ")}
                            </p>
                          ) : null}
                          <button
                            onClick={() => onChooseDineoutRestaurant(item.id)}
                            className="mt-3 w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                          >
                            {item.ctaLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              }

              if (message.type === "dineout-slots") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Available tables
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.restaurantName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.detail}
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {message.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-stone-900">
                                {item.dateLabel}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-stone-600">
                                {item.timeLabel} · {item.slotGroupName}
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-stone-700">
                              {item.guestCount} people
                            </span>
                          </div>
                          {item.dealTitle ? (
                            <p className="mt-3 text-sm leading-6 text-stone-700">
                              {item.dealTitle}
                            </p>
                          ) : null}
                          <button
                            onClick={() => onChooseDineoutSlot(item)}
                            className="mt-3 w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                          >
                            {item.ctaLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              }

              if (message.type === "food-cart") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Final food cart
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.restaurantName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {message.recipeName}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-stone-500">
                        Delivering to {message.addressLine}
                      </p>
                      {message.paymentMethods.length ? (
                        <p className="mt-2 text-sm leading-6 text-stone-500">
                          Available payment methods: {message.paymentMethods.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-3 p-4">
                      {message.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-4 rounded-2xl bg-stone-50 px-3 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-stone-900">
                              {item.name}
                            </p>
                            <p className="mt-1 text-sm text-stone-500">
                              {item.quantity}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-stone-900">
                            {formatCurrency(item.price)}
                          </p>
                        </div>
                      ))}
                      <div className="space-y-2 rounded-2xl border border-stone-200 px-3 py-3">
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Subtotal</span>
                          <span>{formatCurrency(message.subtotal)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Fees</span>
                          <span>{formatCurrency(message.fees)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-stone-950">
                          <span>Total</span>
                          <span>{formatCurrency(message.total)}</span>
                        </div>
                      </div>
                      <button
                        onClick={onPlaceOrder}
                        className="w-full rounded-full bg-stone-950 px-4 py-3 text-sm font-medium text-white"
                      >
                        Place food order
                      </button>
                    </div>
                  </article>
                );
              }

              if (message.type === "dineout-booking") {
                return (
                  <article
                    key={message.id}
                    className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-stone-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Table booked
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-stone-950">
                        {message.restaurantName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        Booking {message.bookingId}
                      </p>
                    </div>
                    <div className="space-y-3 p-4 text-sm leading-6 text-stone-700">
                      <div className="rounded-2xl bg-stone-50 px-3 py-3">
                        <p>
                          {message.dateLabel} at {message.timeLabel}
                        </p>
                        <p className="mt-1">
                          {message.guestCount} people · {message.status}
                        </p>
                        {message.dealTitle ? (
                          <p className="mt-1">{message.dealTitle}</p>
                        ) : null}
                        {message.addressLine ? (
                          <p className="mt-1 text-stone-500">{message.addressLine}</p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <article
                  key={`unsupported-${index}`}
                  className="max-w-[85%] rounded-[24px] rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-[15px] leading-7 text-stone-600 shadow-sm"
                >
                  Unsupported chat card in this session. Refresh the flow or use a
                  fresh slug.
                </article>
              );
            })}

            {isResponding ? (
              <div className="max-w-[85%] rounded-[24px] rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-[15px] tracking-[0.25em] text-stone-500 shadow-sm">
                •••
              </div>
            ) : null}
          </div>
        </section>

        <div className="sticky bottom-0 px-4 pb-5 pt-3">
          {quickReplyChips.length ? (
            <div className="mb-3 overflow-x-auto">
              <div className="flex gap-2">
                {quickReplyChips.map((chip) => (
                  chip.href ? (
                    <a
                      key={`${chip.label}-${chip.href}`}
                      href={chip.href}
                      className="shrink-0 rounded-full border border-stone-300 bg-white/92 px-3 py-2 text-sm text-stone-700 shadow-sm backdrop-blur transition hover:border-stone-900 hover:text-stone-950"
                    >
                      {chip.label}
                    </a>
                  ) : (
                    <button
                      key={`${chip.label}-${chip.text}`}
                      type="button"
                      onClick={() => chip.text && void submitText(chip.text)}
                      className="shrink-0 rounded-full border border-stone-300 bg-white/92 px-3 py-2 text-sm text-stone-700 shadow-sm backdrop-blur transition hover:border-stone-900 hover:text-stone-950"
                    >
                      {chip.label}
                    </button>
                  )
                ))}
              </div>
            </div>
          ) : null}

          {hasStickyContext ? (
            <div className="mb-3">
              <div className="overflow-hidden rounded-[18px] border border-stone-200 bg-white/95 shadow-sm backdrop-blur">
                <div
                  ref={dockRailRef}
                  className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
                >
                  {dockItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActiveDockItem(item.key);
                        setIsDockOpen(true);
                      }}
                      className={[
                        "w-full shrink-0 snap-start px-3 py-3 text-left",
                        item.tone === "dark" ? "bg-stone-950 text-white" : "bg-white text-stone-950",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p
                            className={[
                              "text-[11px] font-semibold uppercase tracking-[0.18em]",
                              item.tone === "dark" ? "text-white/60" : "text-stone-500",
                            ].join(" ")}
                          >
                            {item.label}
                          </p>
                          <p className="mt-1 line-clamp-1 text-sm font-semibold">
                            {item.title}
                          </p>
                          <p
                            className={[
                              "mt-2 line-clamp-1 text-xs",
                              item.tone === "dark" ? "text-white/75" : "text-stone-500",
                            ].join(" ")}
                          >
                            {item.meta}
                          </p>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
                            item.tone === "dark"
                              ? "bg-white/10 text-white"
                              : "bg-stone-100 text-stone-700",
                          ].join(" ")}
                        >
                          View
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {dockItems.length > 1 ? (
                  <div className="flex items-center justify-center gap-1.5 border-t border-stone-200 px-3 py-2">
                    {dockItems.map((item) => (
                      <button
                        key={`dot-${item.key}`}
                        type="button"
                        aria-label={`Show ${item.label.toLowerCase()}`}
                        onClick={() => setActiveDockItem(item.key)}
                        className={[
                          "h-1.5 rounded-full transition-all",
                          resolvedActiveDockItem === item.key
                            ? "w-5 bg-stone-950"
                            : "w-1.5 bg-stone-300",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              {isDockOpen ? (
                <div className="mt-2 overflow-hidden rounded-[22px] border border-stone-200 bg-white/96 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between border-b border-stone-200 px-3 py-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {resolvedActiveDockItem === "tracking" ? "Active order" : "Cooking now"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-stone-950">
                        {resolvedActiveDockItem === "tracking"
                          ? `Order ${activeTracking?.orderId ?? ""}`
                          : activeRecipe?.name ?? ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDockOpen(false)}
                      className="rounded-full border border-stone-300 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-700"
                    >
                      Close
                    </button>
                  </div>

                  <div className="space-y-3 px-3 py-3">
                    {resolvedActiveDockItem === "recipe" && activeRecipe ? (
                      <div className="rounded-[18px] bg-stone-50 px-3 py-3">
                        <p className="text-sm font-semibold text-stone-950">
                          {activeRecipe.name}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          {activeRecipe.cookTime}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-stone-600">
                          {activeRecipe.note}
                        </p>
                        <a
                          href={activeRecipe.youtubeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-full border border-stone-300 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-700"
                        >
                          Play video
                        </a>
                      </div>
                    ) : null}

                    {resolvedActiveDockItem === "tracking" && activeTracking ? (
                      <div className="rounded-[18px] bg-stone-950 px-3 py-3 text-white">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">{activeTracking.orderId}</p>
                          <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em]">
                            {activeTracking.stage}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white/80">ETA {activeTracking.eta}</p>
                        <div className="mt-3 space-y-2">
                          {activeTracking.updates.map((update) => (
                            <div key={update.id} className="flex gap-2">
                              <div
                                className={[
                                  "mt-1 h-2 w-2 rounded-full",
                                  update.complete ? "bg-white" : "bg-white/30",
                                ].join(" ")}
                              />
                              <div>
                                <p className="text-xs font-medium text-white">
                                  {update.label}
                                </p>
                                <p className="mt-1 text-xs text-white/70">
                                  {update.detail}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitText(inputValue);
            }}
            className="flex items-end gap-3 rounded-[28px] border border-stone-200 bg-white/95 p-2 shadow-sm backdrop-blur"
          >
            <textarea
              rows={1}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Tell Vorel what you have or what you feel like eating"
              className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-400"
            />
            <button
              type="submit"
              disabled={isResponding || !inputValue.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-950 text-lg text-white disabled:bg-stone-300"
            >
              ↑
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
