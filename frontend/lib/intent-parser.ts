import { z } from "zod";
import type { RecipeSuggestion } from "@/lib/chat";
import type { ResolvedAddress } from "@/lib/address-resolver";
import { traceEvent } from "@/lib/debug-trace";

export type DietPreference = "veg" | "non-veg" | null;
export type DiscoveryMode = "pantry" | "browse";

export type UserContext = {
  craving: string | null;
  pantryItems: string[];
  maxTime: number | null;
  diet: DietPreference;
  noveltyPreference: boolean;
  willingToOrderGroceries: boolean;
};

export type IntentConversationStage =
  | "collecting-context"
  | "recipe-selection"
  | "pantry-check"
  | "ready-to-cook"
  | "provider-connect"
  | "address-confirm"
  | "cart-comparison"
  | "cart-review"
  | "restaurant-fallback"
  | "food-cart-review"
  | "tracking";

export type ParsedTurn = {
  local: {
    browseIntent: boolean;
    refreshIntent: boolean;
    similarityIntent: boolean;
    wantsRestaurantFallback: boolean;
    pantryItems: string[];
    maxTime: number | null;
    diet: DietPreference;
    craving: string | null;
    noveltyPreference: boolean;
    willingToOrderGroceries: boolean;
    selectedRecipeName: string | null;
    affirmative: boolean;
    trackingIntent: boolean;
    providerId: string | null;
    addressId: string | null;
  };
  llm: LlmIntent | null;
  resolved: {
    intentSource:
      | "local_only"
      | "deepseek_fallback_used"
      | "anthropic_fallback_used"
      | "fallback_failed_then_clarified";
    primaryIntent:
      | "provide_context"
      | "browse_recipes"
      | "refine_results"
      | "select_recipe"
      | "fallback_to_restaurant"
      | "choose_provider"
      | "choose_address"
      | "place_order"
      | "track_order"
      | "unknown";
    discoveryMode: DiscoveryMode;
    nextContext: UserContext;
    hasEnoughContext: boolean;
    followUpQuestion: string;
    selectedRecipeName: string | null;
    hintedRecipeName: string | null;
    wantsRecipeRefresh: boolean;
    similarityIntent: boolean;
    wantsRestaurantFallback: boolean;
    providerId: string | null;
    addressId: string | null;
    affirmative: boolean;
    trackingIntent: boolean;
    usedLlm: boolean;
    confidence: number;
  };
};

export type ShoppingIntakePlan = {
  source:
    | "local_only"
    | "deepseek_fallback_used"
    | "anthropic_fallback_used"
    | "fallback_failed_then_local";
  interpretation:
    | "direct_items"
    | "clarify_category"
    | "mixed"
    | "unknown";
  prompt: string;
  chips: string[];
  resolvedItems: string[];
  pendingItems: string[];
  confidence: number;
  readyForProvider: boolean;
};

const INTENT_LLM_URL = process.env.VOREL_INTENT_LLM_URL?.trim() ?? "";
const INTENT_LLM_MODEL = process.env.VOREL_INTENT_LLM_MODEL?.trim() ?? "";
const INTENT_LLM_API_KEY = process.env.VOREL_INTENT_LLM_API_KEY?.trim() ?? "";
const ANTHROPIC_API_KEY =
  process.env.VOREL_INTENT_ANTHROPIC_API_KEY?.trim() ??
  process.env.ANTHROPIC_API_KEY?.trim() ??
  "";
const ANTHROPIC_INTENT_MODEL =
  process.env.VOREL_INTENT_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
const INTENT_LLM_TIMEOUT_MS = 12_000;

function resolveOpenAiCompatibleIntentUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (
    trimmed.endsWith("/chat/completions") ||
    trimmed.endsWith("/v1/chat/completions")
  ) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }

  return `${normalized}/chat/completions`;
}

const STOPWORDS = new Set([
  "i",
  "have",
  "got",
  "with",
  "and",
  "for",
  "want",
  "would",
  "like",
  "something",
  "make",
  "meal",
  "dish",
  "today",
  "tonight",
  "time",
  "minutes",
  "minute",
  "mins",
  "min",
  "under",
  "within",
  "around",
  "about",
  "my",
  "fridge",
  "kitchen",
  "full",
  "quick",
  "snack",
  "please",
  "some",
  "need",
  "enough",
  "prefer",
  "preferred",
  "veg",
  "non",
  "new",
  "trending",
  "trendy",
  "looking",
  "looking for",
]);

const BROAD_SHOPPING_CATEGORY_LABELS = new Map<string, string>([
  ["fruit", "fruit"],
  ["fruits", "fruit"],
  ["snack", "snacks"],
  ["snacks", "snacks"],
  ["vegetable", "vegetables"],
  ["vegetables", "vegetables"],
  ["veggie", "vegetables"],
  ["veggies", "vegetables"],
  ["drink", "drinks"],
  ["drinks", "drinks"],
  ["beverage", "drinks"],
  ["beverages", "drinks"],
  ["breakfast", "breakfast items"],
  ["dairy", "dairy items"],
]);

const SHOPPING_NORMALIZATION_RULES: Array<{
  pattern: RegExp;
  normalized: string;
}> = [
  { pattern: /\bcurd\b|\bdahi\b|\byogurt\b/i, normalized: "plain curd" },
  { pattern: /\bregular chips\b|\bsalted chips\b|\bclassic chips\b/i, normalized: "salted potato chips" },
  { pattern: /\bchips\b/i, normalized: "potato chips" },
  { pattern: /\bcold drinks?\b|\bsoft drinks?\b/i, normalized: "cola soft drink" },
  { pattern: /\bchocolates?\b/i, normalized: "milk chocolate" },
  { pattern: /\bregular cola\b/i, normalized: "cola soft drink" },
];

const SHOPPING_FILLER_PREFIXES = [
  /^(?:usual ones? like)\s+/i,
  /^(?:the usual ones? like)\s+/i,
  /^(?:things like)\s+/i,
  /^(?:stuff like)\s+/i,
  /^(?:something like)\s+/i,
  /^(?:anything like)\s+/i,
  /^(?:maybe)\s+/i,
  /^(?:some)\s+/i,
  /^(?:just)\s+/i,
  /^(?:the regular ones?)\s+/i,
  /^(?:regular ones?)\s+/i,
  /^(?:the usual ones?)\s+/i,
  /^(?:usual ones?)\s+/i,
];

const BROWSE_PATTERNS = [
  /\bsomething new\b/i,
  /\btrending\b/i,
  /\btrendy\b/i,
  /\bsurprise me\b/i,
  /\bsomething different\b/i,
  /\bunique\b/i,
  /\bexplore\b/i,
  /\binteresting\b/i,
  /\bexciting\b/i,
  /\bpopular\b/i,
  /\bwhat should i eat\b/i,
];

const REFRESH_PATTERNS = [
  /\bother options\b/i,
  /\bgive other options\b/i,
  /\bsomething else\b/i,
  /\bshow more\b/i,
  /\banother option\b/i,
  /\bdifferent options\b/i,
  /\bnot exciting\b/i,
  /\bnot feeling\b/i,
  /\bdon't like these\b/i,
  /\bdo not like these\b/i,
  /\bmore options\b/i,
  /\breroll\b/i,
];

const LlmIntentSchema = z.object({
  pantryItems: z.array(z.string()).default([]),
  maxTime: z.number().int().positive().nullable().default(null),
  diet: z.enum(["veg", "non-veg"]).nullable().default(null),
  craving: z.string().trim().nullable().default(null),
  browseIntent: z.boolean().default(false),
  noveltyPreference: z.boolean().default(false),
  wantsRecipeRefresh: z.boolean().default(false),
  selectedRecipeName: z.string().trim().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
});

const ShoppingPlannerSchema = z.object({
  interpretation: z
    .enum(["direct_items", "clarify_category", "mixed", "unknown"])
    .default("unknown"),
  prompt: z.string().trim().default(""),
  chips: z.array(z.string()).default([]),
  resolvedItems: z.array(z.string()).default([]),
  pendingItems: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
  readyForProvider: z.boolean().default(false),
});

type LlmIntent = z.infer<typeof LlmIntentSchema>;
type ShoppingPlannerLlmResult = z.infer<typeof ShoppingPlannerSchema>;

type LlmIntentResult = {
  intent: LlmIntent;
  source: "generic" | "anthropic";
};

export function createEmptyUserContext(): UserContext {
  return {
    craving: null,
    pantryItems: [],
    maxTime: null,
    diet: null,
    noveltyPreference: false,
    willingToOrderGroceries: false,
  };
}

export async function planShoppingIntake(args: {
  text: string;
  existingItems?: string[];
  pendingItems?: string[];
}): Promise<ShoppingIntakePlan> {
  const localPlan = buildLocalShoppingPlan(args);

  if (localPlan.readyForProvider && localPlan.resolvedItems.length > 0) {
    return {
      ...localPlan,
      source: "local_only",
    };
  }

  const llmResult = await classifyShoppingWithLLM(args);

  if (llmResult) {
    const normalizedPendingItems = llmResult.plan.pendingItems.length
      ? dedupeLowercase(llmResult.plan.pendingItems)
      : localPlan.pendingItems;
    return {
      source:
        llmResult.source === "anthropic"
          ? "anthropic_fallback_used"
          : "deepseek_fallback_used",
      interpretation: llmResult.plan.interpretation,
      prompt: llmResult.plan.prompt || localPlan.prompt,
      chips: resolveShoppingPlannerChips(
        normalizedPendingItems,
        llmResult.plan.chips,
        localPlan.chips,
      ),
      resolvedItems: llmResult.plan.resolvedItems.length
        ? dedupeLowercase(llmResult.plan.resolvedItems).map(normalizeShoppingNeed)
        : localPlan.resolvedItems,
      pendingItems: normalizedPendingItems,
      confidence: llmResult.plan.confidence,
      readyForProvider:
        llmResult.plan.readyForProvider && normalizedPendingItems.length === 0,
    };
  }

  return {
    ...localPlan,
    source:
      hasShoppingPlannerLlm()
        ? "fallback_failed_then_local"
        : "local_only",
  };
}

function hasShoppingPlannerLlm() {
  return Boolean((INTENT_LLM_URL && INTENT_LLM_MODEL) || ANTHROPIC_API_KEY);
}

function dedupeLowercase(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseShoppingItemsFromText(text: string) {
  const lower = text.toLowerCase();
  const match =
    lower.match(/(?:need|buy|shop for|get|pick up|pickup|grab|want|restock|restock on|replenish|top up)\s+(.+)/) ??
    (/[,&]/.test(lower) ? ["", lower] : null);

  if (!match) {
    return [];
  }

  return match[1]
    .split(/,| and |&|\n/)
    .map((part) =>
      part
        .replace(/[^a-z\s-]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^(?:restock|replenish|top up)\s+/i, "")
        .replace(/^(?:maybe|some|any|just|like|the|a|an)\s+/i, "")
        .trim(),
    )
    .filter(
      (item) =>
        item &&
        ![
          "groceries",
          "grocery",
          "shopping",
          "shop",
          "today",
          "tonight",
          "for dinner",
          "for the week",
          "basic groceries",
        ].includes(item),
    );
}

function normalizeShoppingCategory(item: string) {
  return BROAD_SHOPPING_CATEGORY_LABELS.get(item.toLowerCase()) ?? null;
}

function normalizeShoppingNeed(item: string) {
  let cleaned = item
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of SHOPPING_FILLER_PREFIXES) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  cleaned = cleaned
    .replace(/\bplease\b/g, " ")
    .replace(/\bthanks\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const rule of SHOPPING_NORMALIZATION_RULES) {
    if (rule.pattern.test(cleaned)) {
      return rule.normalized;
    }
  }

  return cleaned;
}

function getSeasonalFruitChips() {
  const month = new Date().getMonth() + 1;
  if (month >= 4 && month <= 6) {
    return ["Mangoes", "Grapes", "Watermelon", "Bananas"];
  }
  if (month >= 7 && month <= 9) {
    return ["Bananas", "Papaya", "Pomegranate", "Apples"];
  }
  return ["Bananas", "Apples", "Oranges", "Grapes"];
}

function getShoppingCategorySuggestionChips(category: string) {
  switch (category) {
    case "fruit":
      return getSeasonalFruitChips();
    case "snacks":
      return ["Chips", "Biscuits", "Namkeen", "Nuts"];
    case "vegetables":
      return ["Tomatoes", "Onions", "Potatoes", "Spinach"];
    case "drinks":
      return ["Coconut water", "Juice", "Soda", "Cold coffee"];
    case "dairy items":
      return ["Milk", "Curd", "Paneer", "Butter"];
    case "breakfast items":
      return ["Bread", "Eggs", "Oats", "Cereal"];
    default:
      return [];
  }
}

function resolveShoppingPlannerChips(
  pendingItems: string[],
  llmChips: string[],
  fallbackChips: string[],
) {
  const deterministicCategoryChips = Array.from(
    new Set(
      pendingItems.flatMap((item) => {
        const category = normalizeShoppingCategory(item) ?? item;
        return getShoppingCategorySuggestionChips(category);
      }),
    ),
  ).slice(0, 4);

  if (deterministicCategoryChips.length) {
    return deterministicCategoryChips;
  }

  const sanitizedLlmChips = llmChips
    .map((chip) => chip.trim())
    .filter(Boolean)
    .filter((chip) => chip.split(/\s+/).length <= 3)
    .slice(0, 4);

  return sanitizedLlmChips.length ? sanitizedLlmChips : fallbackChips;
}

function buildShoppingClarificationPrompt(categories: string[], specificItems: string[]) {
  const categoryText =
    categories.length === 1
      ? categories[0]
      : `${categories.slice(0, -1).join(", ")} and ${categories.at(-1)}`;

  if (categories.length === 1 && categories[0] === "fruit") {
    const intro = specificItems.length ? `I can add ${specificItems.join(", ")} directly. ` : "";
    return `${intro}What fruit do you want? Mangoes and grapes are popular in Bengaluru right now, but I can add any fruit you name.`;
  }

  if (categories.length === 1 && categories[0] === "snacks") {
    const intro = specificItems.length ? `I can add ${specificItems.join(", ")} directly. ` : "";
    return `${intro}What kind of snacks do you want? I can help narrow it quickly with chips, biscuits, namkeen, or nuts.`;
  }

  if (categories.length === 1 && categories[0] === "drinks") {
    const intro = specificItems.length ? `I can add ${specificItems.join(", ")} directly. ` : "";
    return `${intro}What kind of drinks do you want? You can pick cola, juice, soda, or coconut water.`;
  }

  const specificLead = specificItems.length
    ? `I can add ${specificItems.join(", ")} directly, but `
    : "";
  const verb = categories.length === 1 ? "is" : "are";
  return `${specificLead}${categoryText} ${verb} too broad for a live cart. Tell me the specific items you want there.`;
}

function buildLocalShoppingPlan(args: {
  text: string;
  existingItems?: string[];
  pendingItems?: string[];
}): Omit<ShoppingIntakePlan, "source"> {
  const existingItems = args.existingItems ?? [];
  const pendingItems = args.pendingItems ?? [];
  const parsedItems = parseShoppingItemsFromText(args.text).map(normalizeShoppingNeed);
  const nextItems = pendingItems.length
    ? existingItems.filter((item) => !pendingItems.includes(item))
    : existingItems;
  const mergedItems = dedupeLowercase([...nextItems, ...parsedItems]);
  const broadCategories = Array.from(
    new Set(
      mergedItems
        .map((item) => normalizeShoppingCategory(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
  const pendingBroadItems = mergedItems.filter((item) => Boolean(normalizeShoppingCategory(item)));
  const readyItems = mergedItems.filter((item) => !normalizeShoppingCategory(item));

  if (!mergedItems.length) {
    return {
      interpretation: "unknown",
      prompt: "Tell me the grocery list you want to buy. A simple list like milk, eggs, curd, tomatoes works.",
      chips: ["Milk", "Eggs", "Curd", "Tomatoes"],
      resolvedItems: [],
      pendingItems: [],
      confidence: 0.35,
      readyForProvider: false,
    };
  }

  if (pendingBroadItems.length) {
    const chips = Array.from(
      new Set(pendingBroadItems.flatMap((category) => getShoppingCategorySuggestionChips(category))),
    ).slice(0, 4);
    return {
      interpretation: readyItems.length ? "mixed" : "clarify_category",
      prompt: buildShoppingClarificationPrompt(pendingBroadItems, readyItems),
      chips,
      resolvedItems: readyItems,
      pendingItems: pendingBroadItems,
      confidence: 0.7,
      readyForProvider: false,
    };
  }

  return {
    interpretation: "direct_items",
    prompt: "",
    chips: [],
    resolvedItems: mergedItems,
    pendingItems: [],
    confidence: 0.8,
    readyForProvider: true,
  };
}

export async function parseTurnIntent(args: {
  text: string;
  stage: IntentConversationStage;
  context: UserContext;
  discoveryMode: DiscoveryMode;
  recipeOptions: RecipeSuggestion[];
  providerOptions?: Array<{ id: string; label: string }>;
  addressOptions?: ResolvedAddress[];
  canOfferRestaurantFallback?: boolean;
  selectedRecipe?: RecipeSuggestion | null;
}): Promise<ParsedTurn> {
  const local = parseLocalIntent(
    args.text,
    args.recipeOptions,
    args.providerOptions ?? [],
    args.addressOptions ?? [],
  );
  const inferredMode = inferDiscoveryMode(
    args.discoveryMode,
    args.context,
    local,
  );
  let nextContext = mergeContext(args.context, local, inferredMode);
  let finalMode = inferredMode;

  let llm: LlmIntent | null = null;
  let llmSource: LlmIntentResult["source"] | null = null;
  if (
    shouldUseIntentLLMFallback({
      text: args.text,
      stage: args.stage,
      recipeOptions: args.recipeOptions,
      local,
    })
  ) {
    const llmResult = await classifyIntentWithLLM({
      text: args.text,
      stage: args.stage,
      recipeOptions: args.recipeOptions,
    });
    llm = llmResult?.intent ?? null;
    llmSource = llmResult?.source ?? null;
    if (llm) {
      finalMode =
        llm.browseIntent || llm.noveltyPreference ? "browse" : finalMode;
      nextContext = mergeLlmIntentIntoContext(nextContext, llm, finalMode);
    }
  }

  const selectedRecipeName =
    llm?.selectedRecipeName ?? local.selectedRecipeName ?? null;
  const similarityIntent = local.similarityIntent;
  const wantsRecipeRefresh =
    local.refreshIntent || llm?.wantsRecipeRefresh || false;
  const wantsRestaurantFallback =
    Boolean(args.canOfferRestaurantFallback && local.wantsRestaurantFallback);
  const hasEnough = hasEnoughContext(nextContext, finalMode);
  const followUpQuestion = buildFollowUpQuestion(nextContext, finalMode);

  return {
    local,
    llm,
    resolved: {
      intentSource: llm
        ? llmSource === "anthropic"
          ? "anthropic_fallback_used"
          : "deepseek_fallback_used"
        : shouldUseIntentLLMFallback({
              text: args.text,
              stage: args.stage,
              recipeOptions: args.recipeOptions,
              local,
            })
          ? "fallback_failed_then_clarified"
          : "local_only",
      primaryIntent: resolvePrimaryIntent({
        stage: args.stage,
        browseIntent: local.browseIntent || Boolean(llm?.browseIntent),
        wantsRecipeRefresh,
        selectedRecipeName,
        similarityIntent,
        wantsRestaurantFallback,
        providerId: local.providerId,
        addressId: local.addressId,
        affirmative: local.affirmative,
        trackingIntent: local.trackingIntent,
        hasEnoughContext: hasEnough,
      }),
      discoveryMode: finalMode,
      nextContext,
      hasEnoughContext: hasEnough,
      followUpQuestion,
      selectedRecipeName,
      hintedRecipeName: selectedRecipeName,
      wantsRecipeRefresh,
      similarityIntent,
      wantsRestaurantFallback,
      providerId: local.providerId,
      addressId: local.addressId,
      affirmative: local.affirmative,
      trackingIntent: local.trackingIntent,
      usedLlm: Boolean(llm),
      confidence: llm?.confidence ?? inferLocalConfidence(local),
    },
  };
}

function parseLocalIntent(
  text: string,
  recipeOptions: RecipeSuggestion[],
  providerOptions: Array<{ id: string; label: string }>,
  addressOptions: ResolvedAddress[],
) {
  return {
    browseIntent: detectBrowseIntent(text),
    refreshIntent: detectRecipeRefreshIntent(text),
    similarityIntent: detectRecipeSimilarityIntent(text),
    wantsRestaurantFallback: detectRestaurantFallbackIntent(text),
    pantryItems: parsePantryItems(text),
    maxTime: parseMaxTime(text),
    diet: parseDiet(text),
    craving: parseCraving(text),
    noveltyPreference: detectNoveltyPreference(text),
    willingToOrderGroceries: detectWillingToOrderGroceries(text),
    selectedRecipeName: findSelectedRecipeName(text, recipeOptions),
    affirmative: isAffirmative(text),
    trackingIntent: isTrackingQuestion(text),
    providerId: findProviderId(text, providerOptions),
    addressId: findAddressId(text, addressOptions),
  };
}

function resolvePrimaryIntent(args: {
  stage: IntentConversationStage;
  browseIntent: boolean;
  wantsRecipeRefresh: boolean;
  selectedRecipeName: string | null;
  similarityIntent: boolean;
  wantsRestaurantFallback: boolean;
  providerId: string | null;
  addressId: string | null;
  affirmative: boolean;
  trackingIntent: boolean;
  hasEnoughContext: boolean;
}): ParsedTurn["resolved"]["primaryIntent"] {
  if (args.stage === "provider-connect" && args.providerId) {
    return "choose_provider";
  }
  if (args.stage === "address-confirm" && (args.addressId || args.affirmative)) {
    return "choose_address";
  }
  if (
    (args.stage === "cart-review" || args.stage === "food-cart-review") &&
    args.affirmative
  ) {
    return "place_order";
  }
  if (args.stage === "tracking" && args.trackingIntent) {
    return "track_order";
  }
  if (args.wantsRestaurantFallback) {
    return "fallback_to_restaurant";
  }
  if (args.wantsRecipeRefresh || args.similarityIntent) {
    return "refine_results";
  }
  if (args.selectedRecipeName) {
    return "select_recipe";
  }
  if (args.browseIntent) {
    return "browse_recipes";
  }
  if (args.stage === "collecting-context" && !args.hasEnoughContext) {
    return "provide_context";
  }
  return "unknown";
}

function inferLocalConfidence(local: ParsedTurn["local"]) {
  if (local.providerId || local.addressId) {
    return 0.95;
  }
  if (local.affirmative || local.trackingIntent) {
    return 0.9;
  }
  if (local.refreshIntent || local.similarityIntent || local.selectedRecipeName) {
    return 0.9;
  }
  if (local.browseIntent || local.maxTime !== null || local.diet !== null) {
    return 0.75;
  }
  if (local.pantryItems.length > 0) {
    return 0.7;
  }
  return 0.35;
}

function parsePantryItems(input: string) {
  const lower = input.toLowerCase();
  const match =
    lower.match(/(?:have|got)\s+(.+)/) ??
    lower.match(/(?:fridge|kitchen)\s*[:,-]?\s*(.+)/);
  if (!match) {
    return [];
  }
  const source = match[1];

  return source
    .split(/,| and |&|\n/)
    .map((part) =>
      part
        .replace(/[^a-z\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(
      (part) =>
        part &&
        !STOPWORDS.has(part) &&
        !/\b(veg|non veg|non-veg|vegetarian|both|either|okay|ok|roughly|minutes|minute|mins|mins?)\b/.test(
          part,
        ),
    );
}

function detectBrowseIntent(input: string) {
  return BROWSE_PATTERNS.some((pattern) => pattern.test(input));
}

function detectRecipeRefreshIntent(input: string) {
  return REFRESH_PATTERNS.some((pattern) => pattern.test(input));
}

function detectRecipeSimilarityIntent(input: string) {
  const lower = input.toLowerCase();
  return (
    lower.includes("more like that") ||
    lower.includes("more like this") ||
    lower.includes("similar to that") ||
    lower.includes("similar to this") ||
    lower.includes("something like that") ||
    lower.includes("something like this") ||
    lower.includes("in that direction")
  );
}

function detectNoveltyPreference(input: string) {
  const lower = input.toLowerCase();
  return (
    detectBrowseIntent(input) ||
    lower.includes("new") ||
    lower.includes("unique") ||
    lower.includes("different") ||
    lower.includes("trending") ||
    lower.includes("trendy") ||
    lower.includes("popular")
  );
}

function detectWillingToOrderGroceries(input: string) {
  const lower = input.toLowerCase();
  return (
    lower.includes("don t mind ordering groceries") ||
    lower.includes("don't mind ordering groceries") ||
    lower.includes("dont mind ordering groceries") ||
    lower.includes("i don't mind ordering groceries") ||
    lower.includes("i dont mind ordering groceries") ||
    lower.includes("can order groceries") ||
    lower.includes("okay ordering groceries") ||
    lower.includes("ok ordering groceries") ||
    lower.includes("happy to order groceries") ||
    lower.includes("fine ordering groceries")
  );
}

function detectRestaurantFallbackIntent(input: string) {
  const lower = input.toLowerCase();
  return (
    lower.includes("restaurant") ||
    lower.includes("order it instead") ||
    lower.includes("order from nearby") ||
    lower.includes("find nearby") ||
    (isAffirmative(input) && lower.includes("instead"))
  );
}

function findProviderId(
  text: string,
  providerOptions: Array<{ id: string; label: string }>,
) {
  const lower = text.toLowerCase();
  return (
    providerOptions.find(
      (provider) =>
        lower.includes(provider.id.toLowerCase()) ||
        lower.includes(provider.label.toLowerCase()),
    )?.id ?? null
  );
}

function mentionsPantry(input: string) {
  const lower = input.toLowerCase();
  return (
    /(?:^|\b)(i have|i got|with|in my fridge|in the fridge|in my kitchen)\b/i.test(
      lower,
    ) || parsePantryItems(input).length > 1
  );
}

function parseMaxTime(input: string) {
  const match =
    input.match(/(\d+)\s*(?:minutes|minute|mins|min)\b/i) ??
    input.match(/under\s+(\d+)/i) ??
    input.match(/within\s+(\d+)/i);

  if (match) {
    return Number(match[1]);
  }

  const lower = input.toLowerCase();
  if (
    lower.includes("short on time") ||
    lower.includes("not much time") ||
    lower.includes("quick") ||
    lower.includes("in a hurry") ||
    lower.includes("don t have much time") ||
    lower.includes("don't have much time") ||
    lower.includes("little time")
  ) {
    return 15;
  }
  if (
    lower.includes("enough time") ||
    lower.includes("have time") ||
    lower.includes("plenty of time") ||
    lower.includes("lots of time") ||
    lower.includes("not in a rush") ||
    lower.includes("no rush") ||
    lower.includes("take my time")
  ) {
    return 45;
  }
  return null;
}

function parseDiet(input: string): DietPreference {
  const lower = input.toLowerCase();
  if (
    (lower.includes("both veg") || lower.includes("both vegetarian")) &&
    (lower.includes("non veg") || lower.includes("non-veg"))
  ) {
    return null;
  }
  if (
    lower.includes("both veg and non veg") ||
    lower.includes("both veg & non veg") ||
    lower.includes("both veg and non-veg") ||
    lower.includes("both veg & non-veg") ||
    lower.includes("okay with veg and non veg") ||
    lower.includes("okay with veg and non-veg") ||
    lower.includes("okay with both veg and non veg") ||
    lower.includes("okay with both veg and non-veg")
  ) {
    return null;
  }
  if (lower.includes("non veg") || lower.includes("non-veg")) return "non-veg";
  if (
    lower.includes("chicken") ||
    lower.includes("mutton") ||
    lower.includes("fish") ||
    lower.includes("egg")
  ) {
    return "non-veg";
  }
  if (lower.includes("veg") || lower.includes("vegetarian")) return "veg";
  return null;
}

function parseCraving(input: string) {
  const lower = input.toLowerCase();
  const cleaned = lower
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
  return cleaned.length ? cleaned.join(" ") : null;
}

function inferDiscoveryMode(
  existingMode: DiscoveryMode,
  existing: UserContext,
  local: ParsedTurn["local"],
): DiscoveryMode {
  if (local.browseIntent || local.noveltyPreference) {
    return "browse";
  }
  if (local.pantryItems.length > 0 || mentionsPantry(local.craving ?? "") || existing.pantryItems.length > 0) {
    return "pantry";
  }
  return existingMode;
}

function mergeContext(
  existing: UserContext,
  local: ParsedTurn["local"],
  mode: DiscoveryMode,
): UserContext {
  const pantryItems = Array.from(
    new Set([...existing.pantryItems, ...local.pantryItems]),
  );
  return {
    craving:
      mode === "browse" && local.craving
        ? local.craving
        : existing.craving ?? local.craving,
    pantryItems,
    maxTime: existing.maxTime ?? local.maxTime,
    diet: existing.diet ?? local.diet,
    noveltyPreference:
      existing.noveltyPreference || local.noveltyPreference || local.browseIntent,
    willingToOrderGroceries:
      existing.willingToOrderGroceries || local.willingToOrderGroceries,
  };
}

function mergeLlmIntentIntoContext(
  context: UserContext,
  llmIntent: LlmIntent,
  mode: DiscoveryMode,
) {
  const pantryItems = Array.from(
    new Set([...context.pantryItems, ...llmIntent.pantryItems.map((item) => item.toLowerCase())]),
  );
  return {
    craving:
      mode === "browse"
        ? llmIntent.craving ?? context.craving
        : context.craving ?? llmIntent.craving,
    pantryItems,
    maxTime: context.maxTime ?? llmIntent.maxTime,
    diet: context.diet ?? llmIntent.diet,
    noveltyPreference: context.noveltyPreference || llmIntent.noveltyPreference,
    willingToOrderGroceries: context.willingToOrderGroceries,
  };
}

function hasEnoughContext(context: UserContext, mode: DiscoveryMode) {
  if (mode === "browse") {
    return context.maxTime !== null && context.diet !== null;
  }
  return (
    (context.pantryItems.length > 0 || context.willingToOrderGroceries) &&
    context.maxTime !== null &&
    context.diet !== null
  );
}

function buildFollowUpQuestion(context: UserContext, mode: DiscoveryMode) {
  const missing: string[] = [];
  if (context.maxTime === null) missing.push("how much time you have");
  if (context.diet === null) missing.push("whether you want veg or non-veg");
  if (
    mode === "pantry" &&
    context.pantryItems.length === 0 &&
    !context.willingToOrderGroceries
  ) {
    missing.push("what’s in your fridge");
  }

  if (!missing.length) {
    return "I have enough to look for recipes.";
  }
  if (missing.length === 1) {
    return `Tell me ${missing[0]}.`;
  }
  return `Tell me ${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}.`;
}

function shouldUseIntentLLMFallback(args: {
  text: string;
  stage: IntentConversationStage;
  recipeOptions: RecipeSuggestion[];
  local: ParsedTurn["local"];
}) {
  if ((!INTENT_LLM_URL || !INTENT_LLM_MODEL) && !ANTHROPIC_API_KEY) {
    return false;
  }

  if (args.stage === "collecting-context") {
    if (isSimpleBrowseDiscoveryPrompt(args.text, args.local)) {
      return false;
    }
    return !isSimpleStructuredContextReply(args.text, args.local);
  }

  if (args.stage === "pantry-check") {
    return !isSimpleStructuredContextReply(args.text, args.local);
  }

  const trimmed = args.text.trim();
  if (trimmed.length > 120) {
    return true;
  }
  if (args.stage === "recipe-selection") {
    return (
      !args.local.selectedRecipeName &&
      !args.local.refreshIntent &&
      !args.local.wantsRestaurantFallback &&
      trimmed.split(/\s+/).length > 3
    );
  }
  return false;
}

function isSimpleStructuredContextReply(
  text: string,
  local: ParsedTurn["local"],
) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) {
    return false;
  }

  if (
    local.browseIntent ||
    local.refreshIntent ||
    local.similarityIntent ||
    local.wantsRestaurantFallback ||
    local.selectedRecipeName ||
    local.providerId ||
    local.addressId ||
    local.trackingIntent
  ) {
    return false;
  }

  const hasStructuredContext =
    local.maxTime !== null ||
    local.diet !== null ||
    local.pantryItems.length > 0 ||
    local.willingToOrderGroceries;

  if (!hasStructuredContext) {
    return false;
  }

  const hasLowRiskCraving =
    !local.craving ||
    local.craving.length <= 16 ||
    /^(unique|new|trending|trendy|quick)$/.test(local.craving);

  return hasLowRiskCraving;
}

function isSimpleBrowseDiscoveryPrompt(
  text: string,
  local: ParsedTurn["local"],
) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 100) {
    return false;
  }

  if (
    local.maxTime !== null ||
    local.diet !== null ||
    local.pantryItems.length > 0 ||
    local.willingToOrderGroceries ||
    local.refreshIntent ||
    local.similarityIntent ||
    local.wantsRestaurantFallback ||
    local.selectedRecipeName ||
    local.providerId ||
    local.addressId ||
    local.trackingIntent
  ) {
    return false;
  }

  return local.browseIntent || local.noveltyPreference;
}

async function classifyShoppingWithLLM(args: {
  text: string;
  existingItems?: string[];
  pendingItems?: string[];
}): Promise<
  | {
      plan: ShoppingPlannerLlmResult;
      source: "generic" | "anthropic";
    }
  | null
> {
  const genericIntentUrl = resolveOpenAiCompatibleIntentUrl(INTENT_LLM_URL);
  if (!genericIntentUrl && !ANTHROPIC_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTENT_LLM_TIMEOUT_MS);
  const system = [
    "You are Vorel, a personalized grocery shopping assistant.",
    "Return JSON only.",
    "Interpret whether the user named specific buyable items or broad shopping categories.",
    "Your job is to minimize unnecessary questions and convert common consumer phrasing into executable grocery intents.",
    "Prefer normalized buyable needs over literal wording.",
    "Examples: curd -> plain curd; regular chips -> salted potato chips; cold drinks -> cola soft drink; chocolates -> milk chocolate.",
    "Only ask a follow-up if the request is still too broad to shop for directly, like fruit, snacks, vegetables, or drinks.",
    "If the request is broad, return one short follow-up prompt and 2-4 helpful suggestion chips.",
    "For fruit in Bengaluru during summer, suggestions like mangoes, grapes, watermelon, bananas are reasonable.",
    "Do not invent obscure SKUs or brittle brand variants unless the user explicitly asked for that brand.",
  ].join(" ");
  const user = JSON.stringify({
    text: args.text,
    existingItems: args.existingItems ?? [],
    pendingItems: args.pendingItems ?? [],
    outputSchema: {
      interpretation: '"direct_items" | "clarify_category" | "mixed" | "unknown"',
      prompt: "string",
      chips: ["string"],
      resolvedItems: ["string"],
      pendingItems: ["string"],
      confidence: "number 0..1",
      readyForProvider: "boolean",
    },
  });

  try {
    if (genericIntentUrl && INTENT_LLM_MODEL) {
      const response = await fetch(genericIntentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(INTENT_LLM_API_KEY
            ? { Authorization: `Bearer ${INTENT_LLM_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          temperature: 0,
          model: INTENT_LLM_MODEL,
          max_tokens: 220,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string | Array<{ type?: string; text?: string }>;
            };
          }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .map((part) => ("text" in part ? (part.text ?? "") : ""))
                  .join("")
              : "";
        const jsonText = extractJsonObject(text);
        if (jsonText) {
          return {
            plan: ShoppingPlannerSchema.parse(JSON.parse(jsonText)),
            source: "generic",
          };
        }
      }
    }

    if (!ANTHROPIC_API_KEY) {
      return null;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_INTENT_MODEL,
        max_tokens: 300,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      return null;
    }
    return {
      plan: ShoppingPlannerSchema.parse(JSON.parse(jsonText)),
      source: "anthropic",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyIntentWithLLM(args: {
  text: string;
  stage: IntentConversationStage;
  recipeOptions: RecipeSuggestion[];
}): Promise<LlmIntentResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTENT_LLM_TIMEOUT_MS);

  const optionNames = args.recipeOptions.map((recipe) => recipe.name);
  const genericIntentUrl = resolveOpenAiCompatibleIntentUrl(INTENT_LLM_URL);
  const system = [
    "You extract structured cooking-assistant intent from user text.",
    "Return JSON only.",
    "Do not invent pantry items or recipe names.",
    "selectedRecipeName must be one of the provided recipe option names when set.",
  ].join(" ");
  const user = JSON.stringify({
    stage: args.stage,
    text: args.text,
    recipeOptions: optionNames,
    outputSchema: {
      pantryItems: ["string"],
      maxTime: "number|null",
      diet: '"veg" | "non-veg" | null',
      craving: "string|null",
      browseIntent: "boolean",
      noveltyPreference: "boolean",
      wantsRecipeRefresh: "boolean",
      selectedRecipeName: "string|null",
      confidence: "number 0..1",
    },
  });

  try {
    if (genericIntentUrl && INTENT_LLM_MODEL) {
      const response = await fetch(genericIntentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(INTENT_LLM_API_KEY
            ? { Authorization: `Bearer ${INTENT_LLM_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          temperature: 0,
          model: INTENT_LLM_MODEL,
          max_tokens: 200,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        traceEvent("intent-parser", "intent_llm_generic_failed", {
          stage: args.stage,
          url: genericIntentUrl,
          model: INTENT_LLM_MODEL,
          status: response.status,
          statusText: response.statusText,
        });
        if (!ANTHROPIC_API_KEY) {
          return null;
        }
      } else {
        const payload = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string | Array<{ type?: string; text?: string }>;
            };
          }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .map((part) => ("text" in part ? (part.text ?? "") : ""))
                  .join("")
              : "";
        const jsonText = extractJsonObject(text);
        if (jsonText) {
          return {
            intent: LlmIntentSchema.parse(JSON.parse(jsonText)),
            source: "generic",
          };
        }
        traceEvent("intent-parser", "intent_llm_generic_failed", {
          stage: args.stage,
          url: genericIntentUrl,
          model: INTENT_LLM_MODEL,
          reason: "non_json_response",
          responsePreview: text.slice(0, 300),
        });
        if (!ANTHROPIC_API_KEY) {
          return null;
        }
      }
    }

    if (!ANTHROPIC_API_KEY) {
      return null;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_INTENT_MODEL,
        max_tokens: 400,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      traceEvent("intent-parser", "intent_llm_anthropic_failed", {
        stage: args.stage,
        model: ANTHROPIC_INTENT_MODEL,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      traceEvent("intent-parser", "intent_llm_anthropic_failed", {
        stage: args.stage,
        model: ANTHROPIC_INTENT_MODEL,
        reason: "non_json_response",
        responsePreview: text.slice(0, 300),
      });
      return null;
    }
    return {
      intent: LlmIntentSchema.parse(JSON.parse(jsonText)),
      source: "anthropic",
    };
  } catch (error) {
    traceEvent("intent-parser", "intent_llm_exception", {
      stage: args.stage,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function findSelectedRecipeName(text: string, options: RecipeSuggestion[]) {
  const lower = text.toLowerCase();
  const ordinalMap = [
    [1, [/\b1\b/, /\bfirst\b/, /\brecipe 1\b/, /\boption 1\b/]],
    [2, [/\b2\b/, /\bsecond\b/, /\brecipe 2\b/, /\boption 2\b/]],
    [3, [/\b3\b/, /\bthird\b/, /\brecipe 3\b/, /\boption 3\b/]],
  ] as const;

  for (const [index, patterns] of ordinalMap) {
    if (patterns.some((pattern) => pattern.test(lower))) {
      return options[index - 1]?.name ?? null;
    }
  }
  return (
    options.find((recipe) => lower.includes(recipe.name.toLowerCase()))?.name ??
    null
  );
}

function findAddressId(text: string, addresses: ResolvedAddress[]) {
  const lower = text.toLowerCase();
  const normalizedText = normalizeAddressLine(text);
  return (
    addresses.find(
      (address) =>
        lower.includes(address.id.toLowerCase()) ||
        (address.addressTag &&
          lower.includes(address.addressTag.toLowerCase())) ||
        normalizeAddressLine(address.addressLine) === normalizedText ||
        normalizedText.includes(normalizeAddressLine(address.addressLine)) ||
        normalizeAddressLine(address.addressLine).includes(normalizedText),
    )?.id ?? null
  );
}

function extractJsonObject(input: string) {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return input.slice(start, end + 1);
}

function isAffirmative(text: string) {
  const lower = text.toLowerCase();
  return ["yes", "place", "order", "go ahead", "do it", "confirm"].some((token) =>
    lower.includes(token),
  );
}

function isTrackingQuestion(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes("where") ||
    lower.includes("track") ||
    lower.includes("status") ||
    lower.includes("eta") ||
    lower.includes("order")
  );
}

function normalizeAddressLine(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
