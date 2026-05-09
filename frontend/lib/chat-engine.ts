import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  type CartItem,
  type ChatMessage,
  type ChatSession,
  type DineoutRestaurantSuggestion,
  type DineoutSlotSuggestion,
  formatDisplayName,
  type RecipeSuggestion,
  type RestaurantSuggestion,
  type TrackingUpdate,
} from "@/lib/chat";
import {
  type GroceryCartProviderId,
  type GroceryProviderId,
} from "@/lib/grocery";
import type {
  GroceryAddressResult,
  GroceryCartResult,
} from "@/lib/grocery-provider";
import {
  resolveAddressOptions,
  resolveProviderAddressId,
  type ProviderAddressGroup,
  type ResolvedAddress,
} from "@/lib/address-resolver";
import { traceEvent } from "@/lib/debug-trace";
import { resolveAreaHintsToCoordinates } from "@/lib/area-resolver";
import {
  createEmptyUserContext,
  planShoppingIntake,
  parseTurnIntent,
  type DiscoveryMode,
  type UserContext,
} from "@/lib/intent-parser";
import { detectLoop } from "@/lib/loop-guard";
import { getActiveCartProvidersForSlug } from "@/lib/provider-preferences";
type ConversationStage =
  | "collecting-context"
  | "recipe-selection"
  | "pantry-check"
  | "ready-to-cook"
  | "provider-connect"
  | "address-confirm"
  | "cart-comparison"
  | "cart-review"
  | "restaurant-fallback"
  | "dineout-results"
  | "dineout-slot-review"
  | "dineout-booking"
  | "food-cart-review"
  | "tracking";

export type EntryMode =
  | "cook-dinner"
  | "grocery-shopping"
  | "eat-out"
  | "meal-plan"
  | "free-text";

type RecipeRecord = {
  id: number;
  name: string;
  ingredients: string[];
  tags: string[];
  cookTimeMins: number | null;
  imageUrl: string | null;
  youtubeUrl: string;
  viewCount: number;
};

type SessionState = {
  slug: string;
  displayName: string;
  entryMode: EntryMode;
  stage: ConversationStage;
  messages: ChatMessage[];
  context: UserContext;
  shoppingItems: string[];
  shoppingNeedsClarification: string[];
  quickReplyChips: NonNullable<ChatSession["quickReplyChips"]>;
  discoveryMode: DiscoveryMode;
  recipeOptions: RecipeSuggestion[];
  shownRecipeIds: string[];
  selectedRecipe: RecipeSuggestion | null;
  selectedProvider: GroceryProviderId | null;
  selectedAddress: ResolvedAddress | null;
  selectedCartProvider: GroceryProviderId | null;
  comparedCartOptions: Array<{
    provider: GroceryCartProviderId;
    items: CartItem[];
    unresolvedIngredients: string[];
    subtotal: number;
    fees: number;
    total: number;
    note?: string;
  }>;
  canOfferRestaurantFallback: boolean;
  pendingRestaurantFallback: boolean;
  pendingFoodCartBuild: boolean;
  restaurantOptions: RestaurantSuggestion[];
  selectedRestaurant: RestaurantSuggestion | null;
  dineoutOptions: DineoutRestaurantSuggestion[];
  selectedDineoutRestaurant: DineoutRestaurantSuggestion | null;
  dineoutSlots: DineoutSlotSuggestion[];
  dineoutPartySize: number | null;
  dineoutOccasion: string | null;
  dineoutBudget: string | null;
  dineoutAreaHints: string[];
  dineoutBooking:
    | {
        bookingId: string;
        restaurantId: string;
        restaurantName: string;
        status: string;
        dateLabel: string;
        timeLabel: string;
        guestCount: number;
        dealTitle?: string;
        addressLine?: string;
      }
    | null;
  eatOutMode: "unspecified" | "delivery" | "dineout";
  foodCart:
    | {
        provider: "swiggy-food";
        restaurantId: string;
        restaurantName: string;
        addressId: string;
        addressLine: string;
        paymentMethods: string[];
        items: CartItem[];
        subtotal: number;
        fees: number;
        total: number;
      }
    | null;
  planningDays: number | null;
  planningPeople: number | null;
  planningOccasion: string | null;
  activeOrder:
    | {
        provider: GroceryProviderId;
        orderId: string;
        mockMode: boolean;
        lastTrackedAt: number;
      }
    | null;
};

type MutableGlobal = typeof globalThis & {
  __vorelRecipeCatalog?: RecipeRecord[];
  __vorelChatSessions?: Map<string, SessionState>;
};

const globalStore = globalThis as MutableGlobal;
const DB_PATH = path.join(process.cwd(), "..", "backend", "dishes.db");
const SWIGGY_ORDER_MODE =
  (process.env.VOREL_SWIGGY_ORDER_MODE ?? "mock").trim().toLowerCase() === "live"
    ? "live"
    : "mock";
const SWIGGY_FOOD_ORDER_MODE =
  (process.env.VOREL_SWIGGY_FOOD_ORDER_MODE ?? "mock").trim().toLowerCase() === "live"
    ? "live"
    : "mock";
const ZEPTO_ORDER_MODE =
  (process.env.VOREL_ZEPTO_ORDER_MODE ?? "mock").trim().toLowerCase() === "live"
    ? "live"
    : "mock";
const SWIGGY_TRACK_POLL_INTERVAL_MS = 10_000;

const GROCERY_PROVIDER_OPTIONS = [
  {
    id: "swiggy-instamart" as const,
    label: "Swiggy Instamart",
    ctaLabel: "Connect Swiggy",
  },
  {
    id: "swiggy-food" as const,
    label: "Swiggy Food",
    ctaLabel: "Connect Swiggy Food",
  },
  {
    id: "swiggy-dineout" as const,
    label: "Swiggy Dineout",
    ctaLabel: "Connect Swiggy Dineout",
  },
  {
    id: "zepto" as const,
    label: "Zepto",
    ctaLabel: "Connect Zepto",
  },
];

function getGroceryProviderLabel(providerId: GroceryProviderId) {
  return (
    GROCERY_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)?.label ??
    providerId
  );
}

async function loadGroceryModule() {
  return import("@/lib/grocery");
}

const TRACKING_UPDATES: TrackingUpdate[] = [
  {
    id: "track-1",
    label: "Order confirmed",
    detail: "Your missing ingredients order has been confirmed.",
    complete: true,
  },
  {
    id: "track-2",
    label: "Packing groceries",
    detail: "Store partner is packing the items for your recipe.",
    complete: true,
  },
  {
    id: "track-3",
    label: "On the way",
    detail: "Rider is on the way with your groceries.",
    complete: false,
  },
];

function normalizeRecipeIngredient(raw: string) {
  return raw
    .toLowerCase()
    .split(/\s+-\s+|\s+–\s+|\s+—\s+|:\s+/)[0]
    .replace(/\((?:[^)]*\d[^)]*|[^)]*\b(?:cloves?|tbsp|tsp|teaspoons?|tablespoons?|cups?|g|gm|grams?|kg|ml|l|litres?|liters?|pcs?|pieces?)\b[^)]*)\)/g, "")
    .replace(/\b\d+\s*-\s*\d+\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(cloves?|tbsp|tsp|teaspoons?|tablespoons?|cups?|g|gm|grams?|kg|ml|l|litres?|liters?|pcs?|pieces?)\b/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadRecipeCatalog() {
  if (globalStore.__vorelRecipeCatalog) {
    return globalStore.__vorelRecipeCatalog;
  }

  const raw = execFileSync(
    "sqlite3",
    [
      "-json",
      DB_PATH,
      `
        SELECT id, clean_title, ingredients, tags, cook_time_mins, thumbnail_url, video_url, view_count
        FROM dishes;
      `,
    ],
    {
      encoding: "utf8",
    },
  );

  const rows = JSON.parse(raw) as Array<{
    id: number;
    clean_title: string;
    ingredients: string;
    tags: string;
    cook_time_mins: number | null;
    thumbnail_url: string | null;
    video_url: string;
    view_count: number | null;
  }>;

  globalStore.__vorelRecipeCatalog = rows.map((row) => ({
    id: row.id,
    name: row.clean_title,
    ingredients: row.ingredients
      .split(",")
      .map((item) => normalizeRecipeIngredient(item))
      .filter(Boolean),
    tags: row.tags
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
    cookTimeMins: row.cook_time_mins,
    imageUrl: row.thumbnail_url,
    youtubeUrl: row.video_url,
    viewCount: row.view_count ?? 0,
  }));

  return globalStore.__vorelRecipeCatalog;
}

function getSessions() {
  if (!globalStore.__vorelChatSessions) {
    globalStore.__vorelChatSessions = new Map<string, SessionState>();
  }
  return globalStore.__vorelChatSessions;
}

function createMessage(
  role: "assistant" | "user",
  text: string,
  id: string,
): ChatMessage {
  return {
    id,
    role,
    type: "text",
    text,
  };
}

function getInitialPrompt(entryMode: EntryMode) {
  switch (entryMode) {
    case "grocery-shopping":
      return "Tell me your grocery list and I’ll turn it into a live cart. You can also mention budget, brands to prefer or avoid, and whether you want Swiggy Instamart or Zepto.";
    case "eat-out":
      return "Do you want to order in or go out tonight? Tell me the cuisine, dish, or vibe you want, and I’ll either find delivery options or bookable restaurants.";
    case "meal-plan":
      return "Are you planning for the week or for something like a party? Tell me how many people, how many meals you need, and any diet, prep, or budget constraints. I’ll build a plan from there.";
    case "free-text":
      return "Tell me what you need help with and I’ll route the flow. You can ask me to cook dinner, shop groceries, find somewhere to eat, or plan meals.";
    case "cook-dinner":
    default:
      return "Tell me what you feel like eating, what you already have at home, how much time you have, and whether you want veg or non-veg. I’ll suggest dishes and help you get the missing ingredients if needed.";
  }
}

function createInitialState(slug: string, entryMode: EntryMode = "free-text"): SessionState {
  return {
    slug,
    displayName: formatDisplayName(slug),
    entryMode,
    stage: "collecting-context",
    context: createEmptyUserContext(),
    shoppingItems: [],
    shoppingNeedsClarification: [],
    quickReplyChips: [],
    discoveryMode: entryMode === "cook-dinner" ? "pantry" : "browse",
    recipeOptions: [],
    shownRecipeIds: [],
    selectedRecipe: null,
    selectedProvider: null,
    selectedAddress: null,
    selectedCartProvider: null,
    comparedCartOptions: [],
    canOfferRestaurantFallback: false,
    pendingRestaurantFallback: false,
    pendingFoodCartBuild: false,
    restaurantOptions: [],
    selectedRestaurant: null,
    dineoutOptions: [],
    selectedDineoutRestaurant: null,
    dineoutSlots: [],
    dineoutPartySize: null,
    dineoutOccasion: null,
    dineoutBudget: null,
    dineoutAreaHints: [],
    dineoutBooking: null,
    eatOutMode: "unspecified",
    foodCart: null,
    planningDays: null,
    planningPeople: null,
    planningOccasion: null,
    activeOrder: null,
    messages: [
      createMessage(
        "assistant",
        getInitialPrompt(entryMode),
        "m-1",
      ),
    ],
  };
}

const DEFAULT_RECIPE_IMAGE =
  "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80";

function buildSyntheticRecipe(args: {
  id: string;
  name: string;
  ingredients: string[];
  tags: string[];
  note: string;
}): RecipeSuggestion {
  return {
    id: args.id,
    name: args.name,
    cookTime: "Flexible",
    note: args.note,
    imageUrl: DEFAULT_RECIPE_IMAGE,
    youtubeUrl: "#",
    ingredients: args.ingredients,
    tags: args.tags,
  };
}

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

function normalizeShoppingCategory(item: string) {
  return BROAD_SHOPPING_CATEGORY_LABELS.get(item.toLowerCase()) ?? null;
}

function parsePlanDays(text: string) {
  const lower = text.toLowerCase();
  const explicitMatch = lower.match(/(\d+)\s*(?:days?|meals?)/);
  if (explicitMatch) {
    return Number(explicitMatch[1]);
  }
  if (lower.includes("week")) {
    return 5;
  }
  if (lower.includes("party")) {
    return 6;
  }
  return null;
}

function parsePlanPeople(text: string) {
  const match = text.toLowerCase().match(/(\d+)\s*(?:people|persons|guests|adults|kids)/);
  return match ? Number(match[1]) : null;
}

function parsePlanOccasion(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("party")) return "party";
  if (lower.includes("week")) return "week";
  if (lower.includes("meal prep")) return "meal prep";
  return null;
}

function parseGuestCount(text: string) {
  const match = text
    .toLowerCase()
    .match(/(\d+)\s*(?:people|persons|guests|adults|covers|seats?)/);
  return match ? Number(match[1]) : null;
}

function parseDineoutOccasion(text: string) {
  const lower = text.toLowerCase();
  if (
    lower.includes("no special occasion") ||
    lower.includes("nothing special") ||
    lower.includes("just dinner") ||
    lower.includes("casual dinner") ||
    lower.includes("no occasion")
  ) {
    return "no special occasion";
  }
  if (lower.includes("date night") || lower.includes("date")) {
    return "date night";
  }
  if (lower.includes("birthday") || lower.includes("anniversary")) {
    return "birthday";
  }
  if (lower.includes("pub hopping") || lower.includes("bar hopping")) {
    return "pub hopping";
  }
  if (lower.includes("family")) {
    return "family dinner";
  }
  if (
    lower.includes("friends") ||
    lower.includes("catch up") ||
    lower.includes("catch-up")
  ) {
    return "catch-up with friends";
  }
  if (lower.includes("team") || lower.includes("office") || lower.includes("work dinner")) {
    return "team dinner";
  }
  return null;
}

function buildDineoutOccasionQuestion() {
  return "What kind of night is this? You can say no special occasion, date night, birthday, family dinner, catch-up with friends, pub hopping, or team dinner.";
}

function parseDineoutBudget(text: string) {
  const lower = text.toLowerCase();
  const explicit = lower.match(/₹?\s?(\d{3,5})/);
  if (explicit) {
    const value = Number(explicit[1]);
    if (value <= 1000) return "budget";
    if (value <= 2000) return "mid-range";
    return "premium";
  }
  if (
    lower.includes("budget") ||
    lower.includes("cheap") ||
    lower.includes("affordable") ||
    lower.includes("under 1000")
  ) {
    return "budget";
  }
  if (
    lower.includes("mid range") ||
    lower.includes("mid-range") ||
    lower.includes("moderate") ||
    lower.includes("around 1500")
  ) {
    return "mid-range";
  }
  if (
    lower.includes("premium") ||
    lower.includes("expensive") ||
    lower.includes("splurge") ||
    lower.includes("luxury") ||
    lower.includes("fine dining")
  ) {
    return "premium";
  }
  return null;
}

function parseDineoutAreaHints(text: string) {
  const lower = text.toLowerCase();
  const patterns = [
    /\b(?:in|around|near)\s+([a-z\s]+(?:\s+(?:or|and)\s+[a-z\s]+)*)/i,
  ];
  const collected: string[] = [];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = match[1]
      .replace(/\b(?:for|with|under|budget|people|guests|date night|birthday|family dinner|team dinner|pub hopping)\b.*$/i, "")
      .trim();
    for (const part of cleaned.split(/\s+(?:or|and)\s+|,|\//)) {
      const normalized = part.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
      if (normalized && normalized.length > 2) {
        collected.push(normalized);
      }
    }
  }
  return [...new Set(collected)];
}

function buildDineoutPreferenceQuestion(args: {
  missingPartySize: boolean;
  missingBudget: boolean;
  missingAreas: boolean;
}) {
  const parts: string[] = [];
  if (args.missingPartySize) parts.push("how many people");
  if (args.missingAreas) parts.push("which area");
  if (args.missingBudget) parts.push("what budget");
  return `Tell me ${parts.join(", ")}${parts.length > 1 ? "," : ""} and I’ll tighten the dine-out options. You can also give multiple areas like Koramangala or Indiranagar.`;
}

function detectEatOutMode(text: string): "delivery" | "dineout" | null {
  const lower = text.toLowerCase();
  if (
    lower.includes("delivery") ||
    lower.includes("deliver") ||
    lower.includes("order in") ||
    lower.includes("eat at home") ||
    lower.includes("swiggy food")
  ) {
    return "delivery";
  }

  if (
    lower.includes("go out") ||
    lower.includes("eat out") ||
    lower.includes("dine out") ||
    lower.includes("dineout") ||
    lower.includes("book a table") ||
    lower.includes("table booking") ||
    lower.includes("restaurant table")
  ) {
    return "dineout";
  }

  return null;
}

function searchRecipesForPlan(
  context: UserContext,
  count: number,
) {
  const pantry = context.pantryItems.map((item) => item.toLowerCase());
  const cravingTerms = (context.craving ?? "")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return loadRecipeCatalog()
    .map((recipe) => {
      const matchedPantry = pantry.filter((item) =>
        recipe.ingredients.some((ingredient) => ingredientMatchesPantry(ingredient, item)),
      );
      const missingPantry = recipe.ingredients.filter(
        (ingredient) =>
          !pantry.some((item) => ingredientMatchesPantry(ingredient, item)),
      );
      const cravingScore = cravingTerms.filter(
        (term) =>
          recipe.name.toLowerCase().includes(term) ||
          recipe.tags.some((tag) => tag.includes(term)),
      ).length;
      const dietMatch =
        context.diet === "veg"
          ? recipe.tags.includes("veg")
          : context.diet === "non-veg"
            ? !recipe.tags.includes("veg") || recipe.tags.includes("non-veg")
            : true;
      const timeMatch =
        context.maxTime === null ||
        recipe.cookTimeMins === null ||
        recipe.cookTimeMins <= context.maxTime;

      return {
        recipe,
        matchedCount: matchedPantry.length,
        missingCount: missingPantry.length,
        cravingScore,
        dietMatch,
        timeMatch,
      };
    })
    .filter((result) => result.dietMatch && result.timeMatch)
    .sort((a, b) => {
      return (
        b.cravingScore - a.cravingScore ||
        a.missingCount - b.missingCount ||
        b.matchedCount - a.matchedCount ||
        b.recipe.viewCount - a.recipe.viewCount
      );
    })
    .slice(0, count)
    .map(({ recipe, matchedCount, missingCount }) => ({
      id: String(recipe.id),
      name: recipe.name,
      cookTime:
        recipe.cookTimeMins !== null ? `${recipe.cookTimeMins} min` : "Time not tagged",
      note: buildRecipeNote(matchedCount, missingCount, recipe.cookTimeMins, "browse"),
      imageUrl: recipe.imageUrl ?? DEFAULT_RECIPE_IMAGE,
      youtubeUrl: recipe.youtubeUrl,
      ingredients: recipe.ingredients,
      tags: recipe.tags,
    }));
}

function buildMealPlanSummary(args: {
  count: number;
  days: number | null;
  people: number | null;
  occasion: string | null;
  recipes: RecipeSuggestion[];
}) {
  const heading =
    args.occasion === "party"
      ? `Here’s a ${args.count}-dish party plan`
      : args.days
        ? `Here’s a ${args.days}-meal plan`
        : `Here’s a ${args.count}-meal plan`;
  const audience = args.people ? ` for ${args.people} people` : "";
  const lines = args.recipes.map((recipe, index) => `${index + 1}. ${recipe.name}`);
  return `${heading}${audience}.\n\n${lines.join("\n")}\n\nPick any recipe below if you want to cook one now, or ask me to revise the plan.`;
}

function cloneSession(session: SessionState): ChatSession {
  return {
    slug: session.slug,
    displayName: session.displayName,
    stage: session.stage,
    entryMode: session.entryMode,
    messages: session.messages,
    quickReplyChips: session.quickReplyChips,
  };
}

function canReinitializeSessionForMode(session: SessionState) {
  return (
    session.stage === "collecting-context" &&
    session.messages.length === 1 &&
    session.messages[0]?.role === "assistant"
  );
}

function nextMessageId(session: SessionState) {
  return `m-${session.messages.length + 1}`;
}

function buildRecipeNote(
  matchedCount: number,
  missingCount: number,
  cookTimeMins: number | null,
  mode: DiscoveryMode,
) {
  if (mode === "browse") {
    if (cookTimeMins !== null) {
      return `Matches your current time preference at around ${cookTimeMins} minutes.`;
    }
    return "Popular pick from the current recipe catalog.";
  }
  if (matchedCount > 0 && missingCount === 0) {
    return "You already have everything needed for this one.";
  }
  if (matchedCount > 0) {
    return `Uses ${matchedCount} pantry items and needs ${missingCount} more.`;
  }
  if (cookTimeMins !== null) {
    return `Fits your time window at around ${cookTimeMins} minutes.`;
  }
  return "Strong pantry match from the current recipe catalog.";
}

function singularizeToken(token: string) {
  if (token.endsWith("oes")) return `${token.slice(0, -2)}`;
  if (token.endsWith("ies") && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("es") && token.length > 3) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeIngredientValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .map((part) => singularizeToken(part.trim()))
    .filter(Boolean);
}

function ingredientMatchesPantry(ingredient: string, pantryItem: string) {
  const ingredientTokens = normalizeIngredientValue(ingredient);
  const pantryTokens = normalizeIngredientValue(pantryItem);

  if (!ingredientTokens.length || !pantryTokens.length) {
    return false;
  }

  const ingredientText = ingredientTokens.join(" ");
  const pantryText = pantryTokens.join(" ");

  if (ingredientText === pantryText) {
    return true;
  }

  const pantryCovered = pantryTokens.every((token) =>
    ingredientTokens.includes(token),
  );
  const ingredientCovered = ingredientTokens.every((token) =>
    pantryTokens.includes(token),
  );

  return pantryCovered || ingredientCovered;
}

function searchRecipes(
  context: UserContext,
  options?: {
    mode?: DiscoveryMode;
    excludeIds?: Set<string>;
    preferNovelty?: boolean;
  },
): RecipeSuggestion[] {
  const mode = options?.mode ?? "pantry";
  const pantry = context.pantryItems.map((item) => item.toLowerCase());
  const cravingTerms = (context.craving ?? "")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const results = loadRecipeCatalog()
    .map((recipe) => {
      const matchedPantry = pantry.filter((item) =>
        recipe.ingredients.some(
          (ingredient) => ingredientMatchesPantry(ingredient, item),
        ),
      );
      const missingPantry = recipe.ingredients.filter(
        (ingredient) =>
          !pantry.some((item) => ingredientMatchesPantry(ingredient, item)),
      );
      const cravingScore = cravingTerms.filter(
        (term) =>
          recipe.name.toLowerCase().includes(term) ||
          recipe.tags.some((tag) => tag.includes(term)),
      ).length;
      const dietMatch =
        context.diet === "veg"
          ? recipe.tags.includes("veg")
          : context.diet === "non-veg"
            ? !recipe.tags.includes("veg") || recipe.tags.includes("non-veg")
            : true;
      const timeMatch =
        context.maxTime === null ||
        recipe.cookTimeMins === null ||
        recipe.cookTimeMins <= context.maxTime;
      const excluded = options?.excludeIds?.has(String(recipe.id)) ?? false;
      const noveltyBoost =
        options?.preferNovelty || context.noveltyPreference
          ? recipe.viewCount
          : 0;

      return {
        recipe,
        matchedCount: matchedPantry.length,
        missingCount: missingPantry.length,
        cravingScore,
        dietMatch,
        timeMatch,
        excluded,
        noveltyBoost,
      };
    })
    .filter((result) => result.dietMatch && result.timeMatch && !result.excluded)
    .sort((a, b) => {
      if (mode === "browse") {
        return (
          b.cravingScore - a.cravingScore ||
          b.noveltyBoost - a.noveltyBoost ||
          a.missingCount - b.missingCount ||
          b.recipe.viewCount - a.recipe.viewCount
        );
      }
      return (
        b.matchedCount - a.matchedCount ||
        b.cravingScore - a.cravingScore ||
        a.missingCount - b.missingCount ||
        b.recipe.viewCount - a.recipe.viewCount
      );
    })
    .slice(0, 3);

  return results.map(({ recipe, matchedCount, missingCount }) => ({
    id: String(recipe.id),
    name: recipe.name,
    cookTime:
      recipe.cookTimeMins !== null ? `${recipe.cookTimeMins} min` : "Time not tagged",
    note: buildRecipeNote(matchedCount, missingCount, recipe.cookTimeMins, mode),
    imageUrl:
      recipe.imageUrl ??
      "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
    youtubeUrl: recipe.youtubeUrl,
    ingredients: recipe.ingredients,
    tags: recipe.tags,
  }));
}

function buildRecipeListTitle(mode: DiscoveryMode, isRefresh: boolean) {
  if (isRefresh) {
    return mode === "browse"
      ? "Here are a few different recipe directions."
      : "Here are a few other recipe options from the current catalog.";
  }

  return mode === "browse"
    ? "Here are some recipe ideas that fit what you asked for."
    : "Here are the top recipe matches from the current recipe catalog.";
}

function getMissingIngredients(
  recipe: RecipeSuggestion,
  pantryItems: string[],
) {
  const normalizedPantry = pantryItems.map((item) => item.toLowerCase());
  return recipe.ingredients.filter(
    (ingredient) =>
      !normalizedPantry.some((item) => ingredientMatchesPantry(ingredient, item)),
  );
}

function needsPantryCheckBeforeCart(session: SessionState) {
  return (
    session.discoveryMode === "browse" &&
    session.context.pantryItems.length === 0 &&
    !session.context.willingToOrderGroceries
  );
}

function buildSimilarRecipeContext(
  context: UserContext,
  recipe: RecipeSuggestion | null,
) {
  if (!recipe) {
    return context;
  }

  const similarityTerms = [
    recipe.name,
    recipe.tags.slice(0, 3).join(" "),
  ]
    .join(" ")
    .trim();

  return {
    ...context,
    craving: similarityTerms || context.craving,
    noveltyPreference: true,
  };
}

function buildProviderSelectionMessage(
  slug: string,
  recipe: RecipeSuggestion,
): Extract<ChatMessage, { type: "providers" }> {
  const activeProviders = new Set(getActiveCartProvidersForSlug(slug));
  const groceryProviders = GROCERY_PROVIDER_OPTIONS.filter(
    (provider) =>
      provider.id !== "swiggy-food" &&
      activeProviders.has(provider.id as GroceryCartProviderId),
  );
  const activeProviderLabels = groceryProviders.map((provider) => provider.label).join(", ");
  return {
    id: `providers-${recipe.id}-${Date.now()}`,
    role: "assistant",
    type: "providers",
    title: recipe.tags.includes("shopping-list")
      ? "Choose a grocery provider to build your live shopping cart."
      : "Choose a grocery provider to fetch live grocery matches.",
    detail:
      recipe.tags.includes("shopping-list")
        ? `I translated your shopping list into live grocery search terms. Active providers for this slug: ${activeProviderLabels || "none"}. Connect one provider and I’ll build the cart in this chat.`
        : `I’ve picked the missing ingredients. Active providers for this slug: ${activeProviderLabels || "none"}. Connect one provider and I’ll pull live grocery items into this chat.`,
    items: groceryProviders.map((provider) => ({
      provider: provider.id,
      label: provider.label,
      detail: `Use ${provider.label} for live grocery lookup.`,
      href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(provider.id)}`,
      ctaLabel: provider.ctaLabel,
    })),
  };
}

function buildAddressMessage(
  addresses: ResolvedAddress[],
  provider: GroceryProviderId = "swiggy-instamart",
): Extract<ChatMessage, { type: "addresses" }> {
  const isFood = provider === "swiggy-food";
  const isDineout = provider === "swiggy-dineout";
  return {
    id: `addresses-${Date.now()}`,
    role: "assistant",
    type: "addresses",
    provider,
    title: isFood
      ? "Choose the delivery address for this restaurant search."
      : isDineout
        ? "Choose the location for this dine-out search."
      : "Choose the delivery address for this grocery cart.",
    detail:
      isFood
        ? "I found your saved Swiggy Food delivery addresses. Pick one and I’ll look for nearby restaurants there."
        : isDineout
          ? "I found your saved Swiggy Dineout locations. Pick one and I’ll search for nearby bookable restaurants there."
        : "I found the saved delivery addresses across your connected grocery providers. Pick one and I’ll use the closest match for each cart.",
    items: addresses.map((address) => ({
      id: address.id,
      addressLine: address.addressLine,
      addressTag: address.addressTag,
      ctaLabel: "Use this address",
    })),
  };
}

function buildRestaurantConnectMessage(
  slug: string,
  recipe: RecipeSuggestion,
): Extract<ChatMessage, { type: "providers" }> {
  const isEatOut = recipe.tags.includes("eat-out-query");
  return {
    id: `food-provider-${recipe.id}-${Date.now()}`,
    role: "assistant",
    type: "providers",
    title: isEatOut
      ? "Connect Swiggy Food to look up places to eat tonight."
      : "I can try nearby restaurants for this dish instead.",
    detail:
      isEatOut
        ? `Connect Swiggy Food and I’ll search nearby restaurants for ${recipe.name}.`
        : `I couldn’t complete the grocery cart for ${recipe.name}. If you want, connect Swiggy Food and I’ll look for nearby restaurants serving it.`,
    items: [
      {
        provider: "swiggy-food",
        label: "Swiggy Food",
        detail: `Search nearby restaurants delivering ${recipe.name}.`,
        href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=swiggy-food`,
        ctaLabel: "Connect Swiggy Food",
      },
    ],
  };
}

function buildRestaurantResultsMessage(
  recipe: RecipeSuggestion,
  restaurants: RestaurantSuggestion[],
  refinementNote?: string | null,
): Extract<ChatMessage, { type: "restaurants" }> {
  const isEatOut = recipe.tags.includes("eat-out-query");
  const defaultDetail = isEatOut
    ? "These are live restaurant delivery options for what you asked to eat tonight. You can ask me to make this list cheaper, faster, veg only, lighter, spicier, or more like one of these."
    : "I could not complete the grocery cart, so these are live restaurant delivery options instead.";
  return {
    id: `restaurants-${recipe.id}-${Date.now()}`,
    role: "assistant",
    type: "restaurants",
    title: `Here are nearby restaurant options for ${recipe.name}.`,
    detail:
      refinementNote ?? defaultDetail,
    recipeName: recipe.name,
    items: restaurants,
  };
}

type DeliveryRefinement =
  | { kind: "default" }
  | { kind: "cheaper" }
  | { kind: "faster" }
  | { kind: "similar"; anchor: RestaurantSuggestion | null }
  | { kind: "veg" }
  | { kind: "no-eggs" }
  | { kind: "lighter" }
  | { kind: "spicier" }
  | { kind: "premium" };

function parseRestaurantCostForTwo(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const numeric = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function tokenizeDeliveryQuery(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreRestaurantQueryMatch(
  restaurant: RestaurantSuggestion,
  query: string,
  diet: string | null,
) {
  const haystack = [
    restaurant.name,
    restaurant.cuisines.join(" "),
    restaurant.offer ?? "",
    ...(restaurant.highlights ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const tokens = tokenizeDeliveryQuery(query);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 3;
    }
  }
  if (diet === "veg" && /\b(non veg|non-veg|chicken|mutton|fish|seafood)\b/.test(haystack)) {
    score -= 4;
  }
  if (diet === "non-veg" && /\b(chicken|mutton|fish|seafood|kebab|biryani|burger)\b/.test(haystack)) {
    score += 2;
  }
  return score;
}

function scoreRestaurantSimilarity(
  restaurant: RestaurantSuggestion,
  anchor: RestaurantSuggestion | null,
) {
  if (!anchor) {
    return 0;
  }
  const cuisineOverlap = restaurant.cuisines.filter((cuisine) =>
    anchor.cuisines.some((anchorCuisine) => anchorCuisine.toLowerCase() === cuisine.toLowerCase()),
  ).length;
  const sameCostBand =
    parseRestaurantCostForTwo(restaurant.costForTwo) !== null &&
    parseRestaurantCostForTwo(anchor.costForTwo) !== null &&
    Math.abs(
      (parseRestaurantCostForTwo(restaurant.costForTwo) ?? 0) -
        (parseRestaurantCostForTwo(anchor.costForTwo) ?? 0),
    ) <= 300;
  return cuisineOverlap * 4 + (sameCostBand ? 2 : 0);
}

function deliveryRefinementNote(refinement: DeliveryRefinement) {
  switch (refinement.kind) {
    case "cheaper":
      return "I reordered these to lean cheaper while keeping the strongest dish matches near the top.";
    case "faster":
      return "I reordered these to prioritize faster delivery first, then dish quality.";
    case "similar":
      return refinement.anchor
        ? `I reordered these to keep the list closer to ${refinement.anchor.name}'s cuisine and price point.`
        : "I reordered these to keep the closest cuisine matches grouped together.";
    case "veg":
      return "I reordered these to lean vegetarian first while keeping your dish match strong.";
    case "no-eggs":
      return "I reordered these to avoid egg-heavy places where possible.";
    case "lighter":
      return "I reordered these toward lighter, less heavy-feeling options.";
    case "spicier":
      return "I reordered these toward bolder, spicier cuisines and dishes.";
    case "premium":
      return "I reordered these toward slightly more premium delivery options.";
    default:
      return null;
  }
}

function scoreDeliveryRefinementFit(
  restaurant: RestaurantSuggestion,
  refinement: DeliveryRefinement,
) {
  const haystack = [
    restaurant.name,
    restaurant.cuisines.join(" "),
    restaurant.offer ?? "",
    restaurant.costForTwo ?? "",
    restaurant.highlights.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  switch (refinement.kind) {
    case "veg":
      if (/\b(non veg|non-veg|chicken|mutton|fish|seafood|egg)\b/.test(haystack)) {
        return -6;
      }
      if (/\b(veg|vegetarian|south indian|north indian|thali|dosa)\b/.test(haystack)) {
        return 4;
      }
      return 0;
    case "no-eggs":
      if (/\begg|omelette|omelet|benedict|anda\b/.test(haystack)) {
        return -8;
      }
      return 1;
    case "lighter":
      if (/\b(salad|grill|grilled|bowl|thai|sushi|healthy|roll|wrap)\b/.test(haystack)) {
        return 4;
      }
      if (/\b(fried|biryani|burger|pizza|mutton|dessert)\b/.test(haystack)) {
        return -3;
      }
      return 0;
    case "spicier":
      if (/\b(andhra|chettinad|schezwan|kebab|biryani|spicy|tandoori)\b/.test(haystack)) {
        return 4;
      }
      return 0;
    case "premium": {
      const cost = parseRestaurantCostForTwo(restaurant.costForTwo) ?? 0;
      if (cost >= 1000) {
        return 4;
      }
      if (/\b(signature|gourmet|chef|fine)\b/.test(haystack)) {
        return 3;
      }
      return 0;
    }
    default:
      return 0;
  }
}

function rerankDeliveryRestaurants(
  restaurants: RestaurantSuggestion[],
  query: string,
  diet: string | null,
  refinement: DeliveryRefinement,
) {
  return [...restaurants]
    .sort((left, right) => {
      const queryDelta =
        scoreRestaurantQueryMatch(right, query, diet) -
        scoreRestaurantQueryMatch(left, query, diet);
      if (queryDelta !== 0 && refinement.kind === "default") {
        return queryDelta;
      }

      if (refinement.kind === "cheaper") {
        const rightCost = parseRestaurantCostForTwo(right.costForTwo) ?? Number.MAX_SAFE_INTEGER;
        const leftCost = parseRestaurantCostForTwo(left.costForTwo) ?? Number.MAX_SAFE_INTEGER;
        if (rightCost !== leftCost) {
          return leftCost - rightCost;
        }
      }

      if (refinement.kind === "faster") {
        const rightEta = right.etaMinutes ?? Number.MAX_SAFE_INTEGER;
        const leftEta = left.etaMinutes ?? Number.MAX_SAFE_INTEGER;
        if (rightEta !== leftEta) {
          return leftEta - rightEta;
        }
        const rightDistance = right.distanceKm ?? Number.MAX_SAFE_INTEGER;
        const leftDistance = left.distanceKm ?? Number.MAX_SAFE_INTEGER;
        if (rightDistance !== leftDistance) {
          return leftDistance - rightDistance;
        }
      }

      if (refinement.kind === "similar") {
        const similarityDelta =
          scoreRestaurantSimilarity(right, refinement.anchor) -
          scoreRestaurantSimilarity(left, refinement.anchor);
        if (similarityDelta !== 0) {
          return similarityDelta;
        }
      }

      const refinementDelta =
        scoreDeliveryRefinementFit(right, refinement) -
        scoreDeliveryRefinementFit(left, refinement);
      if (refinementDelta !== 0) {
        return refinementDelta;
      }

      if (queryDelta !== 0) {
        return queryDelta;
      }

      const rightRating = Number(right.rating) || 0;
      const leftRating = Number(left.rating) || 0;
      if (rightRating !== leftRating) {
        return rightRating - leftRating;
      }

      const rightOffer = right.offer ? 1 : 0;
      const leftOffer = left.offer ? 1 : 0;
      if (rightOffer !== leftOffer) {
        return rightOffer - leftOffer;
      }

      return left.name.localeCompare(right.name);
    })
    .map((restaurant) => ({
      ...restaurant,
      matchReason:
        refinement.kind === "faster"
          ? `${restaurant.eta} delivery`
          : refinement.kind === "cheaper"
            ? restaurant.costForTwo
              ? `${restaurant.costForTwo} for two`
              : restaurant.offer ?? null
            : refinement.kind === "premium"
              ? restaurant.costForTwo ?? restaurant.offer ?? null
            : refinement.kind === "veg"
              ? restaurant.cuisines[0] ?? "Vegetarian-friendly"
            : refinement.kind === "no-eggs"
              ? "Less egg-heavy"
            : refinement.kind === "lighter"
              ? restaurant.cuisines[0] ?? "Lighter pick"
            : refinement.kind === "spicier"
              ? restaurant.cuisines[0] ?? "Spicier pick"
            : refinement.kind === "similar"
              ? restaurant.cuisines[0] ?? restaurant.offer ?? null
              : restaurant.offer ??
                restaurant.costForTwo ??
                (restaurant.eta ? `${restaurant.eta} delivery` : null) ??
                restaurant.cuisines[0] ??
                null,
    }))
    .slice(0, 5);
}

function parseDeliveryRefinement(
  text: string,
  options: RestaurantSuggestion[],
) {
  const lower = text.toLowerCase();
  if (
    /\b(cheaper|cheapest|budget|less expensive|lower price|more affordable)\b/.test(lower)
  ) {
    return { kind: "cheaper" } satisfies DeliveryRefinement;
  }
  if (
    /\b(faster|fastest|quickest|quicker|earlier|soonest|fast delivery)\b/.test(lower)
  ) {
    return { kind: "faster" } satisfies DeliveryRefinement;
  }
  if (/\b(veg only|vegetarian only|only veg|pure veg)\b/.test(lower)) {
    return { kind: "veg" } satisfies DeliveryRefinement;
  }
  if (/\b(no eggs|without eggs|eggless)\b/.test(lower)) {
    return { kind: "no-eggs" } satisfies DeliveryRefinement;
  }
  if (/\b(lighter|light|not too heavy|less heavy|healthy)\b/.test(lower)) {
    return { kind: "lighter" } satisfies DeliveryRefinement;
  }
  if (/\b(spicier|spicy|more spicy|bold flavors?)\b/.test(lower)) {
    return { kind: "spicier" } satisfies DeliveryRefinement;
  }
  if (/\b(premium|nicer|better place|higher end|upmarket)\b/.test(lower)) {
    return { kind: "premium" } satisfies DeliveryRefinement;
  }
  if (
    lower.includes("more like this") ||
    lower.includes("more like that") ||
    lower.includes("similar to this") ||
    lower.includes("similar to that") ||
    lower.includes("same vibe")
  ) {
    const anchor =
      options.find(
        (restaurant) =>
          lower.includes(restaurant.id.toLowerCase()) ||
          lower.includes(restaurant.name.toLowerCase()),
      ) ?? options[0] ?? null;
    return { kind: "similar", anchor } satisfies DeliveryRefinement;
  }
  return null;
}

function buildDineoutConnectMessage(
  slug: string,
  query: string,
): Extract<ChatMessage, { type: "providers" }> {
  return {
    id: `dineout-provider-${Date.now()}`,
    role: "assistant",
    type: "providers",
    title: "Connect Swiggy Dineout to look for bookable restaurants.",
    detail: `Connect Swiggy Dineout and I’ll search live table-booking options for ${query}.`,
    items: [
      {
        provider: "swiggy-dineout",
        label: "Swiggy Dineout",
        detail: `Search table-booking options for ${query}.`,
        href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=swiggy-dineout`,
        ctaLabel: "Connect Swiggy Dineout",
      },
    ],
  };
}

function scoreDineoutOccasionFit(
  restaurant: DineoutRestaurantSuggestion,
  occasion: string | null,
) {
  if (!occasion || occasion === "no special occasion") {
    return 0;
  }

  const haystack = [
    restaurant.name,
    restaurant.cuisines.join(" "),
    restaurant.costForTwo,
    restaurant.offer ?? "",
    restaurant.highlights.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const boosts: Record<string, string[]> = {
    birthday: [
      "celebration",
      "group",
      "buffet",
      "rooftop",
      "dessert",
      "cocktail",
      "fine dining",
      "party",
    ],
    "date night": [
      "romantic",
      "cozy",
      "intimate",
      "rooftop",
      "wine",
      "cocktail",
      "fine dining",
      "ambience",
    ],
    "pub hopping": [
      "pub",
      "bar",
      "brewery",
      "cocktail",
      "late night",
      "taproom",
      "drinks",
    ],
    "family dinner": [
      "family",
      "spacious",
      "comfort",
      "veg",
      "north indian",
      "south indian",
      "casual",
    ],
    "catch-up with friends": [
      "casual",
      "sharing",
      "cocktail",
      "brewery",
      "group",
      "rooftop",
      "lively",
    ],
    "team dinner": [
      "group",
      "buffet",
      "spacious",
      "casual dining",
      "private",
      "large table",
      "fine dining",
    ],
  };

  const penalties: Record<string, string[]> = {
    birthday: ["express", "quick bites", "snack"],
    "date night": ["quick bites", "food court", "family"],
    "pub hopping": ["pure veg", "family"],
    "family dinner": ["pub", "bar", "late night"],
    "catch-up with friends": ["food court"],
    "team dinner": ["intimate", "tiny"],
  };

  let score = 0;
  for (const keyword of boosts[occasion] ?? []) {
    if (haystack.includes(keyword)) {
      score += 3;
    }
  }
  for (const keyword of penalties[occasion] ?? []) {
    if (haystack.includes(keyword)) {
      score -= 3;
    }
  }

  if (occasion === "date night" || occasion === "birthday") {
    if (haystack.includes("₹₹₹") || haystack.includes("₹1500") || haystack.includes("₹2000")) {
      score += 2;
    }
  }

  if (occasion === "pub hopping" && haystack.includes("km")) {
    score += 0;
  }

  return score;
}

function scoreDineoutBudgetFit(
  restaurant: DineoutRestaurantSuggestion,
  budget: string | null,
) {
  if (!budget) {
    return 0;
  }
  const haystack = restaurant.costForTwo.toLowerCase();
  const numeric = Number(haystack.replace(/[^\d]/g, ""));
  if (budget === "budget") {
    if (numeric && numeric <= 1000) return 4;
    if (haystack.includes("₹₹₹")) return -3;
    return 0;
  }
  if (budget === "mid-range") {
    if (numeric && numeric >= 1000 && numeric <= 2200) return 4;
    if (numeric && numeric < 900) return -1;
    if (numeric && numeric > 2800) return -2;
    return 0;
  }
  if (budget === "premium") {
    if (numeric && numeric >= 1800) return 4;
    if (haystack.includes("₹₹₹")) return 3;
    if (numeric && numeric < 1000) return -2;
    return 0;
  }
  return 0;
}

function addressMatchesAreaHint(address: ResolvedAddress, hint: string) {
  const haystack = `${address.addressTag ?? ""} ${address.addressLine}`.toLowerCase();
  const normalizedHint = hint.toLowerCase();
  return (
    haystack.includes(normalizedHint) ||
    normalizedHint.split(/\s+/).every((token) => token.length < 2 || haystack.includes(token))
  );
}

function filterAddressesByAreaHints(
  addresses: ResolvedAddress[],
  hints: string[],
) {
  if (!hints.length) {
    return addresses;
  }
  const matched = addresses.filter((address) =>
    hints.some((hint) => addressMatchesAreaHint(address, hint)),
  );
  return matched.length ? matched : addresses;
}

function addressHasCoordinates(address: ResolvedAddress) {
  return typeof address.lat === "number" && typeof address.lng === "number";
}

function rerankDineoutRestaurantsForOccasion(
  restaurants: DineoutRestaurantSuggestion[],
  occasion: string | null,
  budget: string | null,
) {
  return [...restaurants].sort((left, right) => {
    const occasionDelta =
      scoreDineoutOccasionFit(right, occasion) - scoreDineoutOccasionFit(left, occasion);
    if (occasionDelta !== 0) {
      return occasionDelta;
    }
    const budgetDelta =
      scoreDineoutBudgetFit(right, budget) - scoreDineoutBudgetFit(left, budget);
    if (budgetDelta !== 0) {
      return budgetDelta;
    }
    const rightRating = Number(right.rating) || 0;
    const leftRating = Number(left.rating) || 0;
    if (rightRating !== leftRating) {
      return rightRating - leftRating;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildDineoutResultsMessage(
  query: string,
  restaurants: DineoutRestaurantSuggestion[],
  occasion: string | null,
  budget: string | null,
  searchedAreas: string[],
): Extract<ChatMessage, { type: "dineout-restaurants" }> {
  const contextBits = [
    occasion && occasion !== "no special occasion"
      ? `I prioritized places that fit a ${occasion} vibe`
      : null,
    budget ? `leaned toward a ${budget} budget` : null,
    searchedAreas.length ? `searched across ${searchedAreas.join(", ")}` : null,
  ].filter(Boolean);
  return {
    id: `dineout-results-${Date.now()}`,
    role: "assistant",
    type: "dineout-restaurants",
    title: `Here are bookable places for ${query}.`,
    detail:
      contextBits.length
        ? `These are live Swiggy Dineout restaurant options for going out tonight. I ${contextBits.join(", and ")}.`
        : "These are live Swiggy Dineout restaurant options for going out tonight.",
    query,
    items: restaurants,
  };
}

function buildDineoutSlotsMessage(args: {
  restaurantName: string;
  guestCount: number;
  slots: DineoutSlotSuggestion[];
}): Extract<ChatMessage, { type: "dineout-slots" }> {
  return {
    id: `dineout-slots-${args.restaurantName}-${Date.now()}`,
    role: "assistant",
    type: "dineout-slots",
    title: `Here are the free table slots I found for ${args.guestCount} people.`,
    detail: "Pick a slot and I’ll confirm the booking on Swiggy Dineout.",
    restaurantName: args.restaurantName,
    items: args.slots,
  };
}

function buildDineoutBookingMessage(args: {
  bookingId: string;
  restaurantName: string;
  status: string;
  dateLabel: string;
  timeLabel: string;
  guestCount: number;
  dealTitle?: string;
  addressLine?: string;
}): Extract<ChatMessage, { type: "dineout-booking" }> {
  return {
    id: `dineout-booking-${args.bookingId}-${Date.now()}`,
    role: "assistant",
    type: "dineout-booking",
    title: "Your table is booked.",
    restaurantName: args.restaurantName,
    bookingId: args.bookingId,
    status: args.status,
    dateLabel: args.dateLabel,
    timeLabel: args.timeLabel,
    guestCount: args.guestCount,
    dealTitle: args.dealTitle,
    addressLine: args.addressLine,
  };
}

function findSelectedRestaurant(
  text: string,
  options: RestaurantSuggestion[],
) {
  const lower = text.toLowerCase();
  return (
    options.find(
      (restaurant) =>
        lower.includes(restaurant.id.toLowerCase()) ||
        lower.includes(restaurant.name.toLowerCase()),
    ) ?? null
  );
}

function findSelectedDineoutRestaurant(
  text: string,
  options: DineoutRestaurantSuggestion[],
) {
  const lower = text.toLowerCase();
  return (
    options.find(
      (restaurant) =>
        lower.includes(restaurant.id.toLowerCase()) ||
        lower.includes(restaurant.name.toLowerCase()),
    ) ?? null
  );
}

function findSelectedDineoutSlot(
  text: string,
  options: DineoutSlotSuggestion[],
) {
  const lower = text.toLowerCase();
  return (
    options.find(
      (slot) =>
        lower.includes(slot.slotId.toLowerCase()) ||
        lower.includes(`${slot.dateLabel} ${slot.timeLabel}`.toLowerCase()) ||
        lower.includes(slot.timeLabel.toLowerCase()),
    ) ?? null
  );
}

function buildFoodCartMessage(args: {
  recipe: RecipeSuggestion;
  restaurantName: string;
  addressLine: string;
  paymentMethods: string[];
  items: CartItem[];
  subtotal: number;
  fees: number;
  total: number;
}): Extract<ChatMessage, { type: "food-cart" }> {
  return {
    id: `food-cart-${args.recipe.id}-${Date.now()}`,
    role: "assistant",
    type: "food-cart",
    title: "Here is the final food order cart.",
    recipeName: args.recipe.name,
    restaurantName: args.restaurantName,
    addressLine: args.addressLine,
    paymentMethods: args.paymentMethods,
    items: args.items,
    subtotal: args.subtotal,
    fees: args.fees,
    total: args.total,
  };
}

function buildSelectedCartMessage(
  recipe: RecipeSuggestion,
  provider: GroceryCartProviderId,
  items: CartItem[],
  unresolvedIngredients: string[],
  totals?: {
    subtotal: number;
    fees: number;
    total: number;
  },
  providerNote?: string,
) {
  const subtotal =
    totals?.subtotal ?? items.reduce((sum, item) => sum + item.price, 0);
  const fees = totals?.fees ?? (items.length ? 27 : 0);
  const resolvedTotal = totals?.total ?? subtotal + fees;

  return {
    id: `cart-${provider}-${recipe.id}-${Date.now()}`,
    role: "assistant",
    type: "cart",
    title:
      recipe.tags.includes("shopping-list")
        ? `Here are the grocery items I found on ${getGroceryProviderLabel(provider)}.`
        : providerNote
        ? providerNote
        : unresolvedIngredients.length > 0
        ? `I found some items on ${getGroceryProviderLabel(provider)}, but I could not confirm the full cart for this recipe.`
        : `Here are the missing ingredients I found on ${getGroceryProviderLabel(provider)}.`,
    recipeName: recipe.name,
    items,
    subtotal,
    fees,
    total: resolvedTotal,
  } satisfies Extract<ChatMessage, { type: "cart" }>;
}

function buildIncompleteCartMessage(
  recipe: RecipeSuggestion,
  entries: Array<{
    provider: GroceryProviderId;
    unresolvedIngredients: string[];
  }>,
) {
  const details = entries
    .map((entry) => {
      const missing = entry.unresolvedIngredients.join(", ");
      return `${getGroceryProviderLabel(entry.provider)} could not confirm: ${missing}.`;
    })
    .join(" ");

  return createMessage(
    "assistant",
    recipe.tags.includes("shopping-list")
      ? `I’m sorry, but I could not build a complete live grocery cart for your shopping list. ${details}`
      : `I’m sorry, but I could not build a complete live grocery cart for ${recipe.name}. ${details} I’m stopping here instead of inventing substitutes. If you want, I can try nearby restaurants serving the same dish instead.`,
    `incomplete-cart-${recipe.id}-${Date.now()}`,
  );
}

function buildSwiggyErrorMessage(
  slug: string,
  code: string,
): Extract<ChatMessage, { type: "providers" }> {
  const activeProviders = new Set(getActiveCartProvidersForSlug(slug));
  const detailByCode: Record<string, { title: string; detail: string }> = {
    ADDRESS_NOT_SERVICEABLE: {
      title: "Swiggy Instamart does not service this address.",
      detail:
        "Pick another saved address, add a new address, or continue with another grocery provider.",
    },
    MIN_ORDER_NOT_MET: {
      title: "Swiggy Instamart needs a larger cart.",
      detail:
        "The live Swiggy cart is below the minimum order amount. Add more items, pick another recipe, or continue with another provider.",
    },
    ITEM_OUT_OF_STOCK: {
      title: "One or more Swiggy items are out of stock.",
      detail:
        "Swiggy could not fulfill all selected grocery items at this address. Try another address, another recipe, or another provider.",
    },
    CART_EXPIRED: {
      title: "The Swiggy cart expired.",
      detail:
        "Swiggy abandoned the cart state. Rebuild the cart from this recipe or reconnect if needed.",
    },
  };

  const resolved = detailByCode[code] ?? {
    title: "Swiggy Instamart hit a cart issue.",
    detail:
      "Try rebuilding the cart, switching address, or using another provider.",
  };

  return {
    id: `swiggy-error-${code}-${Date.now()}`,
    role: "assistant",
    type: "providers",
    title: resolved.title,
    detail: resolved.detail,
    items: GROCERY_PROVIDER_OPTIONS.filter(
      (provider) =>
        provider.id !== "swiggy-food" &&
        activeProviders.has(provider.id as GroceryCartProviderId),
    ).map((provider) => ({
      provider: provider.id,
      label:
        provider.id === "swiggy-instamart" ? "Reconnect Swiggy" : "Use Zepto",
      detail:
        provider.id === "swiggy-instamart"
          ? "Reconnect or resume Swiggy if you want to retry the Instamart branch."
          : "Continue with another grocery provider instead of Swiggy.",
      href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(provider.id)}`,
      ctaLabel: provider.id === "swiggy-instamart" ? "Retry Swiggy" : "Try Zepto",
    })),
  };
}

async function buildComparisonMessage(
  slug: string,
  recipe: RecipeSuggestion,
  missingIngredients: string[],
  selectedAddress: ResolvedAddress | null,
) {
  const grocery = await loadGroceryModule();
  const connectedProviders = grocery.getConnectedGroceryProviders(slug);

  if (!connectedProviders.length) {
    return {
      kind: "provider" as const,
      message: buildProviderSelectionMessage(slug, recipe),
    };
  }

  const addressEntries = await Promise.all(
    connectedProviders.map(async (provider) => ({
      provider,
      result: await grocery.listGroceryAddresses(provider, slug),
    })),
  );

  const readyAddressGroups: ProviderAddressGroup[] = [];
  let authRequiredAddressEntry:
    | {
        provider: GroceryCartProviderId;
        result: Extract<GroceryAddressResult, { status: "auth_required" }>;
      }
    | undefined;

  for (const entry of addressEntries) {
    if (entry.result.status === "ready") {
      readyAddressGroups.push({
        provider: entry.provider,
        addresses: entry.result.addresses,
      });
      continue;
    }

    if (entry.result.status === "auth_required" && !authRequiredAddressEntry) {
      authRequiredAddressEntry = {
        provider: entry.provider,
        result: entry.result,
      };
    }
  }

  if (authRequiredAddressEntry) {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        authRequiredAddressEntry.provider,
        authRequiredAddressEntry.result.authReason,
        `${getGroceryProviderLabel(authRequiredAddressEntry.provider)} needs attention before address lookup.`,
      ),
    };
  }

  const resolvedAddresses = resolveAddressOptions(readyAddressGroups);
  const sharedAddresses = resolvedAddresses.filter(
    (address) => address.matchedProviders.length === connectedProviders.length,
  );

  if (!selectedAddress) {
    if (sharedAddresses.length === 1) {
      selectedAddress = sharedAddresses[0];
    }
  }

  if (!selectedAddress) {
    if (sharedAddresses.length) {
      return {
        kind: "address" as const,
        message: buildAddressMessage(sharedAddresses),
      };
    }

    if (readyAddressGroups.length > 1) {
      return {
        kind: "provider" as const,
        message: {
          id: `providers-mismatch-${recipe.id}-${Date.now()}`,
          role: "assistant",
          type: "providers",
          title: "Your providers do not share a matching saved address yet.",
          detail:
            "I can only compare carts when Swiggy and Zepto can both use the same saved delivery address. Right now their saved addresses do not line up cleanly.",
          items: GROCERY_PROVIDER_OPTIONS.filter(
            (provider) =>
              provider.id !== "swiggy-food" &&
              getActiveCartProvidersForSlug(slug).includes(provider.id as GroceryCartProviderId),
          ).map((provider) => ({
            provider: provider.id,
            label: provider.label,
            detail: `Reconnect ${provider.label} if you want to review or align saved addresses there.`,
            href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(provider.id)}`,
            ctaLabel: provider.ctaLabel,
          })),
        } satisfies Extract<ChatMessage, { type: "providers" }>,
      };
    }
  }

  const cartEntries = await Promise.all(
    connectedProviders.map(async (provider) => {
      const addressResult = addressEntries.find((entry) => entry.provider === provider)?.result;
      const addressId =
        addressResult?.status === "ready"
          ? resolveProviderAddressId(selectedAddress, provider, addressResult.addresses)
          : null;
      const cartResult = await grocery.buildGroceryCart(
        provider,
        slug,
        missingIngredients,
        addressId,
      );
      return { provider, cartResult };
    }),
  );

  const readyEntries: Array<{
    provider: GroceryCartProviderId;
    cartResult: Extract<GroceryCartResult, { status: "ready" }>;
  }> = [];
  const unavailableEntries: Array<{
    provider: GroceryCartProviderId;
    cartResult: Extract<GroceryCartResult, { status: "unavailable" }>;
  }> = [];
  let swiggyUnavailableEntry:
    | {
        provider: GroceryCartProviderId;
        cartResult: Extract<GroceryCartResult, { status: "unavailable" }>;
      }
    | undefined;
  let authRequiredCartEntry:
    | {
        provider: GroceryCartProviderId;
        cartResult: Extract<GroceryCartResult, { status: "auth_required" }>;
      }
    | undefined;

  for (const entry of cartEntries) {
    if (entry.cartResult.status === "ready") {
      readyEntries.push({
        provider: entry.provider,
        cartResult: entry.cartResult,
      });
      continue;
    }

    if (entry.cartResult.status === "unavailable") {
      unavailableEntries.push({
        provider: entry.provider,
        cartResult: entry.cartResult,
      });
    }

    if (
      entry.provider === "swiggy-instamart" &&
      entry.cartResult.status === "unavailable" &&
      entry.cartResult.errorCode &&
      !swiggyUnavailableEntry
    ) {
      swiggyUnavailableEntry = {
        provider: entry.provider,
        cartResult: entry.cartResult,
      };
      continue;
    }

    if (entry.cartResult.status === "auth_required" && !authRequiredCartEntry) {
      authRequiredCartEntry = {
        provider: entry.provider,
        cartResult: entry.cartResult,
      };
    }
  }

  const completeReadyEntries = readyEntries.filter(
    (entry) => entry.cartResult.unresolvedIngredients.length === 0,
  );
  const partialReadyEntries = readyEntries.filter(
    (entry) => entry.cartResult.unresolvedIngredients.length > 0,
  );

  if (!completeReadyEntries.length && swiggyUnavailableEntry?.cartResult.errorCode) {
    return {
      kind: "provider" as const,
      message: buildSwiggyErrorMessage(
        slug,
        swiggyUnavailableEntry.cartResult.errorCode,
      ),
    };
  }

  if (!completeReadyEntries.length && authRequiredCartEntry) {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        authRequiredCartEntry.provider,
        authRequiredCartEntry.cartResult.authReason,
        `${getGroceryProviderLabel(authRequiredCartEntry.provider)} needs to be reconnected before cart build.`,
      ),
    };
  }

  if (!completeReadyEntries.length && partialReadyEntries.length) {
    return {
      kind: "blocked" as const,
      message: buildIncompleteCartMessage(
        recipe,
        partialReadyEntries.map((entry) => ({
          provider: entry.provider,
          unresolvedIngredients: entry.cartResult.unresolvedIngredients,
        })),
      ),
    };
  }

  if (!completeReadyEntries.length && unavailableEntries.length) {
    const detail = unavailableEntries
      .map(
        ({ provider, cartResult }) =>
          `${getGroceryProviderLabel(provider)}: ${cartResult.reason}`,
      )
      .join(" ");
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        `I’m sorry, but I could not build a complete live grocery cart for ${recipe.name}. Here is what went wrong: ${detail}`,
        `cart-unavailable-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  if (!completeReadyEntries.length) {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        `I’m sorry, but I could not build a complete live grocery cart for ${recipe.name} from the connected providers. Try another address, another provider, or a different recipe.`,
        `no-live-cart-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  if (completeReadyEntries.length === 1) {
    const [{ provider, cartResult }] = completeReadyEntries;
    return {
      kind: "cart" as const,
      message: buildSelectedCartMessage(
        recipe,
        provider,
        cartResult.items,
        cartResult.unresolvedIngredients,
        {
          subtotal: cartResult.subtotal,
          fees: cartResult.fees,
          total: cartResult.total,
        },
        cartResult.note,
      ),
      option: {
        provider,
        items: cartResult.items,
        unresolvedIngredients: cartResult.unresolvedIngredients,
        subtotal: cartResult.subtotal,
        fees: cartResult.fees,
        total: cartResult.total,
        note: cartResult.note,
      },
    };
  }

  return {
    kind: "comparison" as const,
    message: {
      id: `provider-carts-${recipe.id}-${Date.now()}`,
      role: "assistant",
      type: "provider-carts",
      recipeName: recipe.name,
      title:
        partialReadyEntries.length > 0
          ? "Here are the complete live grocery carts I could confirm across your connected providers."
          : "Here are the live grocery cart options across your connected providers.",
      items: completeReadyEntries.map(({ provider, cartResult }) => {
        const selected = buildSelectedCartMessage(
          recipe,
          provider,
          cartResult.items,
          cartResult.unresolvedIngredients,
          {
            subtotal: cartResult.subtotal,
            fees: cartResult.fees,
            total: cartResult.total,
          },
          cartResult.note,
        );
        return {
          provider,
          label: getGroceryProviderLabel(provider),
          title: selected.title,
          items: selected.items,
          subtotal: selected.subtotal,
          fees: selected.fees,
          total: selected.total,
        };
      }),
    } satisfies Extract<ChatMessage, { type: "provider-carts" }>,
    options: completeReadyEntries.map(({ provider, cartResult }) => ({
      provider,
      items: cartResult.items,
      unresolvedIngredients: cartResult.unresolvedIngredients,
      subtotal: cartResult.subtotal,
      fees: cartResult.fees,
      total: cartResult.total,
      note: cartResult.note,
    })),
  };
}

function buildReadyToCookMessage(recipe: RecipeSuggestion) {
  return createMessage(
    "assistant",
    `You already have everything needed for ${recipe.name}. No grocery order needed. You can start cooking right away, or open the recipe video from the card above.`,
    `ready-${recipe.id}-${Date.now()}`,
  );
}

async function buildCartMessage(
  slug: string,
  recipe: RecipeSuggestion,
  pantryItems: string[],
  address: ResolvedAddress | null,
) {
  if (recipe.tags.includes("shopping-list")) {
    return buildComparisonMessage(slug, recipe, recipe.ingredients, address);
  }

  const missingIngredients = getMissingIngredients(recipe, pantryItems);

  if (!missingIngredients.length) {
    return {
      kind: "ready" as const,
      message: buildReadyToCookMessage(recipe),
    };
  }

  return buildComparisonMessage(slug, recipe, missingIngredients, address);
}

async function buildRestaurantFallbackState(
  slug: string,
  recipe: RecipeSuggestion,
  selectedAddress: ResolvedAddress | null,
  context?: UserContext | null,
  refinement: DeliveryRefinement = { kind: "default" },
) {
  const grocery = await loadGroceryModule();
  if (!grocery.hasGroceryTokens("swiggy-food", slug)) {
    return {
      kind: "provider" as const,
      message: buildRestaurantConnectMessage(slug, recipe),
    };
  }

  const addressResult = await grocery.listGroceryAddresses("swiggy-food", slug);
  if (addressResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-food",
        addressResult.authReason,
        "Swiggy Food needs to be reconnected before restaurant search.",
      ),
    };
  }

  if (addressResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        addressResult.reason,
        `food-address-error-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  let resolvedAddress = selectedAddress;
  const foodAddresses = resolveAddressOptions([
    {
      provider: "swiggy-food",
      addresses: addressResult.addresses,
    },
  ]);

  if (!resolvedAddress) {
    if (foodAddresses.length === 1) {
      resolvedAddress = foodAddresses[0];
    } else if (foodAddresses.length > 1) {
      return {
        kind: "address" as const,
        message: buildAddressMessage(foodAddresses, "swiggy-food"),
      };
    }
  }

  const addressId = resolveProviderAddressId(
    resolvedAddress,
    "swiggy-food",
    addressResult.addresses,
  );

  const restaurantResult = await grocery.searchProviderRestaurants(
    "swiggy-food",
    slug,
    recipe.name,
    addressId,
  );

  if (restaurantResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-food",
        restaurantResult.authReason,
        "Swiggy Food needs to be reconnected before restaurant search.",
      ),
    };
  }

  if (restaurantResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        `${restaurantResult.reason} I couldn’t find a reliable restaurant fallback for ${recipe.name} yet.`,
        `food-search-error-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  const rankedRestaurants = rerankDeliveryRestaurants(
    restaurantResult.restaurants,
    recipe.name,
    context?.diet ?? null,
    refinement,
  );

  return {
    kind: "restaurants" as const,
    message: buildRestaurantResultsMessage(
      recipe,
      rankedRestaurants,
      deliveryRefinementNote(refinement),
    ),
    resolvedAddress,
  };
}

async function buildFoodCartState(
  slug: string,
  recipe: RecipeSuggestion,
  restaurant: RestaurantSuggestion,
  selectedAddress: ResolvedAddress | null,
) {
  const grocery = await loadGroceryModule();
  const addressResult = await grocery.listGroceryAddresses("swiggy-food", slug);
  if (addressResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-food",
        addressResult.authReason,
        "Swiggy Food needs to be reconnected before building the food cart.",
      ),
    };
  }

  if (addressResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        addressResult.reason,
        `food-cart-address-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  let resolvedAddress = selectedAddress;
  const foodAddresses = resolveAddressOptions([
    { provider: "swiggy-food", addresses: addressResult.addresses },
  ]);
  if (!resolvedAddress) {
    if (foodAddresses.length === 1) {
      resolvedAddress = foodAddresses[0];
    } else if (foodAddresses.length > 1) {
      return {
        kind: "address" as const,
        message: buildAddressMessage(foodAddresses, "swiggy-food"),
      };
    }
  }

  const addressId = resolveProviderAddressId(
    resolvedAddress,
    "swiggy-food",
    addressResult.addresses,
  );

  if (!addressId) {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        "I could not resolve a Swiggy Food delivery address for this restaurant order.",
        `food-cart-no-address-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  const foodCartResult = await grocery.buildProviderFoodCart(
    "swiggy-food",
    slug,
    addressId,
    restaurant.id,
    recipe.name,
  );

  if (foodCartResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-food",
        foodCartResult.authReason,
        "Swiggy Food needs to be reconnected before building the food cart.",
      ),
    };
  }

  if (foodCartResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        `${foodCartResult.reason} I could not build the final food cart for ${restaurant.name}.`,
        `food-cart-error-${recipe.id}-${Date.now()}`,
      ),
    };
  }

  return {
    kind: "food-cart" as const,
    message: buildFoodCartMessage({
      recipe,
      restaurantName: foodCartResult.restaurantName,
      addressLine: foodCartResult.addressLine,
      paymentMethods: foodCartResult.paymentMethods,
      items: foodCartResult.items,
      subtotal: foodCartResult.subtotal,
      fees: foodCartResult.fees,
      total: foodCartResult.total,
    }),
    resolvedAddress,
    cart: {
      provider: "swiggy-food" as const,
      restaurantId: foodCartResult.restaurantId,
      restaurantName: foodCartResult.restaurantName,
      addressId: foodCartResult.addressId,
      addressLine: foodCartResult.addressLine,
      paymentMethods: foodCartResult.paymentMethods,
      items: foodCartResult.items,
      subtotal: foodCartResult.subtotal,
      fees: foodCartResult.fees,
      total: foodCartResult.total,
    },
  };
}

async function buildDineoutResultsState(
  slug: string,
  query: string,
  selectedAddress: ResolvedAddress | null,
  occasion: string | null,
  budget: string | null,
  areaHints: string[],
) {
  const grocery = await loadGroceryModule();
  if (!grocery.hasGroceryTokens("swiggy-dineout", slug)) {
    return {
      kind: "provider" as const,
      message: buildDineoutConnectMessage(slug, query),
    };
  }

  const addressResult = await grocery.listGroceryAddresses("swiggy-dineout", slug);
  if (addressResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-dineout",
        addressResult.authReason,
        "Swiggy Dineout needs to be reconnected before restaurant search.",
      ),
    };
  }

  if (addressResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        addressResult.reason,
        `dineout-address-error-${Date.now()}`,
      ),
    };
  }

  let resolvedAddress = selectedAddress;
  const dineoutAddresses = resolveAddressOptions([
    {
      provider: "swiggy-dineout",
      addresses: addressResult.addresses,
    },
  ]);
  const areaMatchedAddresses = filterAddressesByAreaHints(dineoutAddresses, areaHints);
  const resolvedAreas = resolveAreaHintsToCoordinates(areaHints);

  if (!resolvedAddress) {
    if (areaMatchedAddresses.length === 1) {
      resolvedAddress = areaMatchedAddresses[0];
    } else if (areaMatchedAddresses.length > 1 && areaHints.length === 0) {
      return {
        kind: "address" as const,
        message: buildAddressMessage(areaMatchedAddresses, "swiggy-dineout"),
      };
    }
  }

  const addressTargets = resolvedAddress
    ? [resolvedAddress]
    : areaMatchedAddresses.length
      ? areaMatchedAddresses
      : areaHints.length === 0
        ? dineoutAddresses
        : [];

  const searchTargets: Array<
    | {
        kind: "address";
        label: string;
        address: ResolvedAddress;
      }
    | {
        kind: "area";
        label: string;
        latitude: number;
        longitude: number;
      }
  > = [
    ...addressTargets.map((address) => ({
      kind: "address" as const,
      label: address.addressTag || address.addressLine,
      address,
    })),
    ...resolvedAreas
      .filter(
        (area) =>
          !addressTargets.some((address) =>
            addressMatchesAreaHint(address, area.label) && addressHasCoordinates(address),
          ),
      )
      .map((area) => ({
        kind: "area" as const,
        label: area.label,
        latitude: area.latitude,
        longitude: area.longitude,
      })),
  ];

  if (!searchTargets.length && dineoutAddresses.length > 1) {
    return {
      kind: "address" as const,
      message: buildAddressMessage(dineoutAddresses, "swiggy-dineout"),
    };
  }

  const searchResults = await Promise.all(
    searchTargets.map(async (target) => {
      const addressId =
        target.kind === "address"
          ? resolveProviderAddressId(
              target.address,
              "swiggy-dineout",
              addressResult.addresses,
            )
          : null;
      const result = await grocery.searchProviderDineoutRestaurants(
        "swiggy-dineout",
        slug,
        query,
        addressId,
        target.kind === "area" ? target.latitude : null,
        target.kind === "area" ? target.longitude : null,
      );
      return { target, result };
    }),
  );

  const authRequired = searchResults.find((entry) => entry.result.status === "auth_required");
  if (authRequired && authRequired.result.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-dineout",
        authRequired.result.authReason,
        "Swiggy Dineout needs to be reconnected before restaurant search.",
      ),
    };
  }

  const readyResults = searchResults.filter(
    (entry): entry is {
      target:
        | {
            kind: "address";
            label: string;
            address: ResolvedAddress;
          }
        | {
            kind: "area";
            label: string;
            latitude: number;
            longitude: number;
          };
      result: Extract<
        Awaited<ReturnType<typeof grocery.searchProviderDineoutRestaurants>>,
        { status: "ready" }
      >;
    } => entry.result.status === "ready",
  );

  if (!readyResults.length) {
    const firstUnavailable = searchResults.find((entry) => entry.result.status === "unavailable");
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        firstUnavailable?.result.status === "unavailable"
          ? `${firstUnavailable.result.reason} I couldn’t find reliable Dineout options for ${query} yet.`
          : `I couldn’t find reliable Dineout options for ${query} yet.`,
        `dineout-search-error-${Date.now()}`,
      ),
    };
  }

  const mergedRestaurants = new Map<string, DineoutRestaurantSuggestion>();
  for (const entry of readyResults) {
    const sourceAddressId =
      entry.target.kind === "address"
        ? resolveProviderAddressId(
            entry.target.address,
            "swiggy-dineout",
            addressResult.addresses,
          )
        : null;
    for (const restaurant of entry.result.restaurants) {
      const withSource: DineoutRestaurantSuggestion = {
        ...restaurant,
        sourceAddressId: sourceAddressId ?? undefined,
        sourceAddressLabel: entry.target.label,
        sourceLat:
          entry.target.kind === "address"
            ? entry.target.address.lat
            : entry.target.latitude,
        sourceLng:
          entry.target.kind === "address"
            ? entry.target.address.lng
            : entry.target.longitude,
      };
      const existing = mergedRestaurants.get(restaurant.id);
      const withSourceHasCoords =
        typeof withSource.sourceLat === "number" &&
        typeof withSource.sourceLng === "number";
      const existingHasCoords =
        typeof existing?.sourceLat === "number" &&
        typeof existing?.sourceLng === "number";
      if (
        !existing ||
        (withSourceHasCoords && !existingHasCoords) ||
        Number(withSource.rating) > Number(existing.rating)
      ) {
        mergedRestaurants.set(restaurant.id, withSource);
      }
    }
  }

  const rerankedRestaurants = rerankDineoutRestaurantsForOccasion(
    [...mergedRestaurants.values()],
    occasion,
    budget,
  );
  const searchedAreas = searchTargets.map((target) => target.label);

  return {
    kind: "dineout-restaurants" as const,
    message: buildDineoutResultsMessage(
      query,
      rerankedRestaurants,
      occasion,
      budget,
      searchedAreas,
    ),
    resolvedAddress:
      resolvedAddress ??
      (searchTargets[0]?.kind === "address" ? searchTargets[0].address : null),
  };
}

async function buildDineoutSlotsState(
  slug: string,
  restaurant: DineoutRestaurantSuggestion,
  selectedAddress: ResolvedAddress | null,
  guestCount: number,
) {
  let latitude =
    typeof restaurant.sourceLat === "number"
      ? restaurant.sourceLat
      : selectedAddress?.lat;
  let longitude =
    typeof restaurant.sourceLng === "number"
      ? restaurant.sourceLng
      : selectedAddress?.lng;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    const grocery = await loadGroceryModule();
    const addressResult = await grocery.listGroceryAddresses("swiggy-dineout", slug);
    if (addressResult.status === "ready") {
      const matchedSavedAddress =
        addressResult.addresses.find(
          (address) =>
            restaurant.sourceAddressId === address.id ||
            (restaurant.sourceAddressLabel &&
              (address.addressTag?.toLowerCase() ===
                restaurant.sourceAddressLabel.toLowerCase() ||
                address.addressLine
                  .toLowerCase()
                  .includes(restaurant.sourceAddressLabel.toLowerCase()))),
        ) ?? null;
      if (matchedSavedAddress) {
        latitude = matchedSavedAddress.lat ?? latitude;
        longitude = matchedSavedAddress.lng ?? longitude;
      }
    }
  }

  if (
    (typeof latitude !== "number" || typeof longitude !== "number") &&
    restaurant.sourceAddressLabel
  ) {
    const resolvedArea = resolveAreaHintsToCoordinates([restaurant.sourceAddressLabel])[0];
    if (resolvedArea) {
      latitude = resolvedArea.latitude;
      longitude = resolvedArea.longitude;
    }
  }

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number"
  ) {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        "I need a saved Dineout location with coordinates before I can check table slots.",
        `dineout-location-missing-${Date.now()}`,
      ),
    };
  }

  const grocery = await loadGroceryModule();
  const slotsResult = await grocery.getProviderDineoutSlots(
    "swiggy-dineout",
    slug,
    restaurant.id,
    restaurant.name,
    guestCount,
    latitude,
    longitude,
  );

  if (slotsResult.status === "auth_required") {
    return {
      kind: "provider" as const,
      message: buildAuthRecoveryMessage(
        slug,
        "swiggy-dineout",
        slotsResult.authReason,
        "Swiggy Dineout needs to be reconnected before slot lookup.",
      ),
    };
  }

  if (slotsResult.status === "unavailable") {
    return {
      kind: "blocked" as const,
      message: createMessage(
        "assistant",
        `${slotsResult.reason} I couldn’t confirm any free table slots for ${restaurant.name}.`,
        `dineout-slots-error-${Date.now()}`,
      ),
    };
  }

  return {
    kind: "dineout-slots" as const,
    message: buildDineoutSlotsMessage({
      restaurantName: restaurant.name,
      guestCount,
      slots: slotsResult.slots,
    }),
    slots: slotsResult.slots,
  };
}

function buildTrackingMessage(
  orderId = `VO-${String(Date.now()).slice(-5)}`,
): Extract<ChatMessage, { type: "tracking" }> {
  return {
    id: `tracking-${orderId}-${Date.now()}`,
    role: "assistant",
    type: "tracking",
    orderId,
    eta: "11 min",
    stage: "on-the-way",
    updates: TRACKING_UPDATES,
  };
}

function buildTrackingMessageFromOrder(order: {
  orderId: string;
  eta: string;
  stage: "confirmed" | "packing" | "on-the-way";
  updates: TrackingUpdate[];
}): Extract<ChatMessage, { type: "tracking" }> {
  return {
    id: `tracking-${order.orderId}-${Date.now()}`,
    role: "assistant",
    type: "tracking",
    orderId: order.orderId,
    eta: order.eta,
    stage: order.stage,
    updates: order.updates,
  };
}

function buildMockCheckoutMessage(provider: GroceryProviderId) {
  const label = getGroceryProviderLabel(provider);
  if (provider === "swiggy-food") {
    return `${label} checkout is in mock mode right now, so I simulated the order without placing a real food order.`;
  }
  if (provider === "swiggy-instamart") {
    return `${label} checkout is in mock mode right now, so I simulated the grocery order without placing a real checkout.`;
  }
  if (provider === "zepto") {
    return `${label} checkout is in mock mode right now, so I simulated the grocery order without placing a real checkout.`;
  }
  return `${label} checkout is not live in this MVP yet, so I simulated the order instead of placing a real one.`;
}

function buildCheckoutFailureMessage(reason: string) {
  return `${reason} No order was placed. You can retry, reconnect the provider, or switch to a different option.`;
}

function buildAuthRecoveryMessage(
  slug: string,
  provider: GroceryProviderId,
  reason: "expired" | "revoked" | "missing",
  title?: string,
): Extract<ChatMessage, { type: "providers" }> {
  const label = getGroceryProviderLabel(provider);
  const detail =
    reason === "revoked"
      ? `${label} says this user session was revoked. Reconnect it again and I’ll resume from the same step. Swiggy may ask for phone + OTP.`
      : reason === "expired"
        ? `${label} session expired for this user. Reconnect it and I’ll continue from the same step.`
        : `${label} needs to be connected for this user before I can continue from this step.`;

  return {
    id: `auth-recovery-${provider}-${Date.now()}`,
    role: "assistant",
    type: "providers",
    title: title ?? `${label} needs to be reconnected.`,
    detail,
    items: [
      {
        provider,
        label,
        detail,
        href: `/api/grocery/connect?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(provider)}`,
        ctaLabel: reason === "revoked" ? `Reconnect ${label}` : `Resume ${label}`,
      },
    ],
  };
}

async function listResolvedAddressesForSession(slug: string) {
  const grocery = await loadGroceryModule();
  const connectedProviders = grocery.getConnectedGroceryProviders(slug);
  const addressEntries = await Promise.all(
    connectedProviders.map(async (provider) => ({
      provider,
      result: await grocery.listGroceryAddresses(provider, slug),
    })),
  );

  const readyGroups: ProviderAddressGroup[] = [];
  for (const entry of addressEntries) {
    if (entry.result.status === "ready") {
      readyGroups.push({
        provider: entry.provider,
        addresses: entry.result.addresses,
      });
    }
  }

  return resolveAddressOptions(readyGroups);
}

export function getOrCreateChatSession(slug: string): ChatSession {
  return getOrCreateChatSessionWithMode(slug, "free-text");
}

export function getOrCreateChatSessionWithMode(
  slug: string,
  entryMode: EntryMode = "free-text",
): ChatSession {
  const normalizedSlug = slug.trim().toLowerCase();
  const sessions = getSessions();
  const existingSession = sessions.get(normalizedSlug);

  if (!existingSession) {
    sessions.set(normalizedSlug, createInitialState(normalizedSlug, entryMode));
  } else if (
    existingSession.entryMode !== entryMode &&
    canReinitializeSessionForMode(existingSession)
  ) {
    sessions.set(normalizedSlug, createInitialState(normalizedSlug, entryMode));
  }
  return cloneSession(sessions.get(normalizedSlug)!);
}

function getSessionState(slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();
  const sessions = getSessions();
  const session =
    sessions.get(normalizedSlug) ?? createInitialState(normalizedSlug, "free-text");

  sessions.set(normalizedSlug, session);
  return session;
}

function messageLoopSignature(message: ChatMessage) {
  switch (message.type) {
    case "text":
      return `text:${message.text.toLowerCase().replace(/\s+/g, " ").trim()}`;
    case "providers":
      return `providers:${message.title}:${message.items
        .map((item) => item.provider)
        .join(",")}`;
    case "addresses":
      return `addresses:${message.items.map((item) => item.id).join(",")}`;
    case "recipes":
      return `recipes:${message.items.map((item) => item.id).join(",")}`;
    case "cart":
      return `cart:${message.recipeName}:${message.items
        .map((item) => item.id)
        .join(",")}:${message.total}`;
    case "provider-carts":
      return `provider-carts:${message.items
        .map((item) => `${item.provider}:${item.total}`)
        .join("|")}`;
    case "restaurants":
      return `restaurants:${message.recipeName}:${message.items
        .map((item) => item.id)
        .join(",")}`;
    case "dineout-restaurants":
      return `dineout-restaurants:${message.query}:${message.items
        .map((item) => item.id)
        .join(",")}`;
    case "dineout-slots":
      return `dineout-slots:${message.restaurantName}:${message.items
        .map((item) => item.slotId)
        .join(",")}`;
    case "dineout-booking":
      return `dineout-booking:${message.bookingId}:${message.status}`;
    case "food-cart":
      return `food-cart:${message.recipeName}:${message.restaurantName}:${message.total}`;
    case "tracking":
      return `tracking:${message.orderId}:${message.stage}`;
    default:
      return "unknown";
  }
}

function buildLoopEscapeMessage(session: SessionState) {
  return createMessage(
    "assistant",
    "I’m not making progress in this step, so I’m stopping here instead of looping. You can try a different recipe, reconnect the grocery provider, pick another saved address, or start a fresh chat on this slug.",
    nextMessageId(session),
  );
}

function summarizeMessage(message: ChatMessage) {
  switch (message.type) {
    case "text":
      return {
        type: message.type,
        text: message.text,
      };
    case "recipes":
    case "addresses":
    case "providers":
    case "restaurants":
    case "dineout-restaurants":
    case "dineout-slots":
      return {
        type: message.type,
        title: message.title,
        itemCount: message.items.length,
      };
    case "provider-carts":
      return {
        type: message.type,
        title: message.title,
        providers: message.items.map((item) => item.provider),
      };
    case "cart":
      return {
        type: message.type,
        recipeName: message.recipeName,
        itemCount: message.items.length,
        total: message.total,
      };
    case "food-cart":
      return {
        type: message.type,
        recipeName: message.recipeName,
        restaurantName: message.restaurantName,
        itemCount: message.items.length,
        total: message.total,
      };
    case "tracking":
      return {
        type: message.type,
        orderId: message.orderId,
        stage: message.stage,
      };
    case "dineout-booking":
      return {
        type: message.type,
        bookingId: message.bookingId,
        restaurantName: message.restaurantName,
        status: message.status,
      };
    default:
      return { type: "unknown" };
  }
}

function finalizeSession(session: SessionState) {
  const lastMessage = session.messages.at(-1);
  if (
    lastMessage?.role === "assistant" &&
    lastMessage.type === "text" &&
    lastMessage.text.includes("I’m not making progress in this step")
  ) {
    return cloneSession(session);
  }

  const assistantMessages = session.messages.filter(
    (message) => message.role === "assistant",
  );
  const detection = detectLoop(assistantMessages, {
    getSignature: messageLoopSignature,
  });

  if (detection.looped) {
    traceEvent("chat-engine", "loop_detected", {
      slug: session.slug,
      stage: session.stage,
      messageCount: assistantMessages.length,
    });
    session.messages.push(buildLoopEscapeMessage(session));
    session.stage = "recipe-selection";
    session.selectedProvider = null;
    session.comparedCartOptions = [];
  }

  const finalizedMessage = session.messages.at(-1);
  if (finalizedMessage?.role === "assistant") {
    traceEvent("chat-engine", "session_finalized", {
      slug: session.slug,
      stage: session.stage,
      lastAssistant: summarizeMessage(finalizedMessage),
      messageCount: session.messages.length,
    });
  }

  return cloneSession(session);
}

export async function processChatMessage(
  slug: string,
  text: string,
): Promise<ChatSession> {
  const session = getSessionState(slug);
  traceEvent("chat-engine", "process_start", {
    slug,
    stage: session.stage,
    text,
    selectedRecipe: session.selectedRecipe?.name ?? "",
    selectedProvider: session.selectedProvider ?? "",
  });

  session.messages.push(
    createMessage("user", text.trim(), nextMessageId(session)),
  );
  session.quickReplyChips = [];

  if (session.stage === "collecting-context") {
    if (session.entryMode === "grocery-shopping") {
      const shoppingPlan = await planShoppingIntake({
        text,
        existingItems: session.shoppingItems,
        pendingItems: session.shoppingNeedsClarification,
      });
      session.shoppingItems = shoppingPlan.resolvedItems;
      session.shoppingNeedsClarification = shoppingPlan.pendingItems;
      traceEvent("chat-engine", "shopping_context_merged", {
        slug,
        shoppingItems: session.shoppingItems,
        pendingItems: shoppingPlan.pendingItems,
        shoppingPlan: {
          source: shoppingPlan.source,
          interpretation: shoppingPlan.interpretation,
          chips: shoppingPlan.chips,
          confidence: shoppingPlan.confidence,
          readyForProvider: shoppingPlan.readyForProvider,
        },
      });

      if (!session.shoppingItems.length) {
        session.messages.push(
          createMessage(
            "assistant",
            "Tell me the grocery list you want to buy. A simple list like milk, eggs, curd, tomatoes works.",
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      if (!shoppingPlan.readyForProvider) {
        session.quickReplyChips = shoppingPlan.chips.map((chip) => ({
          label: chip,
          text: chip,
        }));
        traceEvent("chat-engine", "shopping_clarification_requested", {
          slug,
          pendingItems: shoppingPlan.pendingItems,
          specificItems: shoppingPlan.resolvedItems,
          source: shoppingPlan.source,
          chips: shoppingPlan.chips,
        });
        session.messages.push(
          createMessage(
            "assistant",
            shoppingPlan.prompt,
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      session.selectedRecipe = buildSyntheticRecipe({
        id: `shopping-${Date.now()}`,
        name: "Your grocery list",
        ingredients: session.shoppingItems,
        tags: ["shopping-list"],
        note: "Live grocery cart for your shopping list.",
      });

      const cartState = await buildCartMessage(
        session.slug,
        session.selectedRecipe,
        [],
        session.selectedAddress,
      );
      session.messages.push(cartState.message);
      session.comparedCartOptions =
        cartState.kind === "comparison"
          ? cartState.options
          : cartState.kind === "cart"
            ? [cartState.option]
            : [];
      session.pendingRestaurantFallback = false;
      session.pendingFoodCartBuild = false;
      session.stage =
        cartState.kind === "provider"
          ? "provider-connect"
          : cartState.kind === "address"
            ? "address-confirm"
          : cartState.kind === "comparison"
            ? "cart-comparison"
          : cartState.kind === "cart"
            ? "cart-review"
          : "cart-review";
      return finalizeSession(session);
    }

    if (session.entryMode === "eat-out") {
      const eatOutMode = detectEatOutMode(text);
      if (eatOutMode) {
        session.eatOutMode = eatOutMode;
      }
      session.dineoutPartySize = session.dineoutPartySize ?? parseGuestCount(text);
      session.dineoutOccasion = session.dineoutOccasion ?? parseDineoutOccasion(text);
      session.dineoutBudget = session.dineoutBudget ?? parseDineoutBudget(text);
      const newAreaHints = parseDineoutAreaHints(text);
      if (newAreaHints.length) {
        session.dineoutAreaHints = [...new Set([...session.dineoutAreaHints, ...newAreaHints])];
      }

      const parsedTurn = await parseTurnIntent({
        text,
        stage: session.stage,
        context: session.context,
        discoveryMode: "browse",
        recipeOptions: session.recipeOptions,
      });
      session.context = parsedTurn.resolved.nextContext;

      const eatOutQuery =
        session.context.craving ??
        parsedTurn.local.craving ??
        text.trim();

      traceEvent("chat-engine", "eat_out_context_merged", {
        slug,
        mode: session.eatOutMode,
        query: eatOutQuery,
        diet: session.context.diet,
        occasion: session.dineoutOccasion ?? "",
      });

      if (session.eatOutMode === "unspecified") {
        session.messages.push(
          createMessage(
            "assistant",
            "Do you want delivery or do you want to go out tonight? You can also tell me the cuisine or dish you’re in the mood for.",
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      if (!eatOutQuery || eatOutQuery.length < 3) {
        session.messages.push(
          createMessage(
            "assistant",
            session.eatOutMode === "delivery"
              ? "Tell me what you feel like ordering in tonight. Cuisine or dish works best, like biryani, ramen, burgers, or Thai."
              : "Tell me what kind of place you want to go to tonight. Cuisine or dish works best, like sushi, pizza, cocktails, or grills.",
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      if (session.eatOutMode === "dineout") {
        session.dineoutOptions = [];
        session.selectedDineoutRestaurant = null;
        session.dineoutSlots = [];
        session.dineoutBooking = null;
        session.selectedRecipe = buildSyntheticRecipe({
          id: `dineout-${Date.now()}`,
          name: eatOutQuery,
          ingredients: [],
          tags: ["eat-out-query", "dineout"],
          note: "Dine-out planning for tonight.",
        });
        if (!session.dineoutOccasion) {
          session.messages.push(
            createMessage(
              "assistant",
              buildDineoutOccasionQuestion(),
              nextMessageId(session),
            ),
          );
          return finalizeSession(session);
        }
        if (
          session.dineoutPartySize === null ||
          session.dineoutBudget === null ||
          session.dineoutAreaHints.length === 0
        ) {
          session.messages.push(
            createMessage(
              "assistant",
              buildDineoutPreferenceQuestion({
                missingPartySize: session.dineoutPartySize === null,
                missingBudget: session.dineoutBudget === null,
                missingAreas: session.dineoutAreaHints.length === 0,
              }),
              nextMessageId(session),
            ),
          );
          return finalizeSession(session);
        }
        const dineoutState = await buildDineoutResultsState(
          session.slug,
          eatOutQuery,
          session.selectedAddress,
          session.dineoutOccasion,
          session.dineoutBudget,
          session.dineoutAreaHints,
        );
        if ("resolvedAddress" in dineoutState && dineoutState.resolvedAddress) {
          session.selectedAddress = dineoutState.resolvedAddress;
        }
        session.messages.push(dineoutState.message);
        session.dineoutOptions =
          dineoutState.kind === "dineout-restaurants" ? dineoutState.message.items : [];
        session.stage =
          dineoutState.kind === "provider"
            ? "provider-connect"
            : dineoutState.kind === "address"
              ? "address-confirm"
              : dineoutState.kind === "dineout-restaurants"
                ? "dineout-results"
                : "collecting-context";
        return finalizeSession(session);
      }

      const queryLabel =
        session.context.diet && !eatOutQuery.includes(session.context.diet)
          ? `${eatOutQuery} (${session.context.diet})`
          : eatOutQuery;
      session.selectedRecipe = buildSyntheticRecipe({
        id: `eat-out-${Date.now()}`,
        name: queryLabel,
        ingredients: [],
        tags: ["eat-out-query"],
        note: "Live restaurant search for tonight.",
      });
      session.pendingRestaurantFallback = true;
      const restaurantState = await buildRestaurantFallbackState(
        session.slug,
        session.selectedRecipe,
        session.selectedAddress,
        session.context,
      );
      if ("resolvedAddress" in restaurantState && restaurantState.resolvedAddress) {
        session.selectedAddress = restaurantState.resolvedAddress;
      }
      session.messages.push(restaurantState.message);
      session.restaurantOptions =
        restaurantState.kind === "restaurants" ? restaurantState.message.items : [];
      session.pendingRestaurantFallback =
        restaurantState.kind === "provider" || restaurantState.kind === "address";
      session.pendingFoodCartBuild = false;
      session.stage =
        restaurantState.kind === "provider"
          ? "provider-connect"
          : restaurantState.kind === "address"
            ? "address-confirm"
          : restaurantState.kind === "restaurants"
            ? "restaurant-fallback"
            : "collecting-context";
      return finalizeSession(session);
    }

    if (session.entryMode === "meal-plan") {
      const parsedTurn = await parseTurnIntent({
        text,
        stage: session.stage,
        context: session.context,
        discoveryMode: "browse",
        recipeOptions: session.recipeOptions,
      });
      session.context = parsedTurn.resolved.nextContext;
      session.planningDays = session.planningDays ?? parsePlanDays(text);
      session.planningPeople = session.planningPeople ?? parsePlanPeople(text);
      session.planningOccasion = session.planningOccasion ?? parsePlanOccasion(text);

      traceEvent("chat-engine", "meal_plan_context_merged", {
        slug,
        days: session.planningDays ?? 0,
        people: session.planningPeople ?? 0,
        occasion: session.planningOccasion ?? "",
        diet: session.context.diet,
        maxTime: session.context.maxTime,
      });

      if (!session.context.diet || (!session.planningDays && !session.planningOccasion)) {
        session.messages.push(
          createMessage(
            "assistant",
            "Tell me whether this is for the week or a party, roughly how many meals or people it covers, and whether you want veg or non-veg.",
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      const planCount = Math.min(
        Math.max(session.planningDays ?? (session.planningOccasion === "party" ? 6 : 5), 3),
        7,
      );
      session.recipeOptions = searchRecipesForPlan(session.context, planCount);
      session.shownRecipeIds = session.recipeOptions.map((recipe) => recipe.id);

      session.messages.push(
        createMessage(
          "assistant",
          buildMealPlanSummary({
            count: planCount,
            days: session.planningDays,
            people: session.planningPeople,
            occasion: session.planningOccasion,
            recipes: session.recipeOptions,
          }),
          nextMessageId(session),
        ),
      );
      session.messages.push({
        id: nextMessageId(session),
        role: "assistant",
        type: "recipes",
        title: "Here are the recipes in this plan.",
        items: session.recipeOptions,
      });
      session.stage = "recipe-selection";
      return finalizeSession(session);
    }

    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      canOfferRestaurantFallback: session.canOfferRestaurantFallback,
      selectedRecipe: session.selectedRecipe,
    });
    session.discoveryMode = parsedTurn.resolved.discoveryMode;
    session.context = parsedTurn.resolved.nextContext;
    traceEvent("chat-engine", "local_intent_parsed", {
      slug,
      stage: session.stage,
      resolved: parsedTurn.resolved,
      intentSource: parsedTurn.resolved.intentSource,
      discoveryMode: session.discoveryMode,
      pantryCount: parsedTurn.local.pantryItems.length,
      pantryItems: parsedTurn.local.pantryItems,
      maxTime: parsedTurn.local.maxTime,
      diet: parsedTurn.local.diet,
      craving: parsedTurn.local.craving ?? "",
      noveltyPreference: parsedTurn.local.noveltyPreference,
      willingToOrderGroceries: parsedTurn.local.willingToOrderGroceries,
      browseIntent: parsedTurn.local.browseIntent,
      refreshIntent: parsedTurn.local.refreshIntent,
      similarityIntent: parsedTurn.local.similarityIntent,
      primaryIntent: parsedTurn.resolved.primaryIntent,
      confidence: parsedTurn.resolved.confidence,
    });

    if (parsedTurn.llm || parsedTurn.resolved.usedLlm) {
      traceEvent("chat-engine", "intent_llm_requested", {
        slug,
        stage: session.stage,
        reason: "collecting_context_llm_first",
      });
      if (parsedTurn.llm) {
        traceEvent("chat-engine", "intent_llm_used", {
          slug,
          stage: session.stage,
          intentSource: parsedTurn.resolved.intentSource,
          confidence: parsedTurn.llm.confidence,
          browseIntent: parsedTurn.llm.browseIntent,
          llmIntent: parsedTurn.llm,
        });
      } else {
        traceEvent("chat-engine", "intent_llm_skipped", {
          slug,
          stage: session.stage,
          reason: "no_usable_response",
        });
      }
    }

    traceEvent("chat-engine", "context_merged", {
      slug,
      pantryItems: session.context.pantryItems,
      maxTime: session.context.maxTime,
      diet: session.context.diet,
      craving: session.context.craving ?? "",
      discoveryMode: session.discoveryMode,
      noveltyPreference: session.context.noveltyPreference,
      willingToOrderGroceries: session.context.willingToOrderGroceries,
    });

    if (!parsedTurn.resolved.hasEnoughContext) {
      traceEvent("chat-engine", "follow_up_requested", {
        slug,
        stage: session.stage,
        missing: parsedTurn.resolved.followUpQuestion,
      });
      session.messages.push(
        createMessage(
          "assistant",
          parsedTurn.resolved.followUpQuestion,
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.recipeOptions = searchRecipes(session.context, {
      mode: session.discoveryMode,
      preferNovelty: session.context.noveltyPreference,
    });
    session.shownRecipeIds = session.recipeOptions.map((recipe) => recipe.id);
    traceEvent("chat-engine", "recipes_ranked", {
      slug,
      count: session.recipeOptions.length,
      recipes: session.recipeOptions.map((recipe) => recipe.name),
    });
    if (!session.recipeOptions.length) {
      session.messages.push(
        createMessage(
          "assistant",
          "I couldn’t find strong matches in the recipe catalog with that combination. Try adding a couple more pantry ingredients or loosen the time limit.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.messages.push({
      id: nextMessageId(session),
      role: "assistant",
      type: "recipes",
      title: buildRecipeListTitle(session.discoveryMode, false),
      items: session.recipeOptions,
    });
    session.stage = "recipe-selection";
    return finalizeSession(session);
  }

  if (session.stage === "recipe-selection") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      canOfferRestaurantFallback: session.canOfferRestaurantFallback,
      selectedRecipe: session.selectedRecipe,
    });
    traceEvent("chat-engine", "local_intent_parsed", {
      slug,
      stage: session.stage,
      resolved: parsedTurn.resolved,
      intentSource: parsedTurn.resolved.intentSource,
      primaryIntent: parsedTurn.resolved.primaryIntent,
      selectedRecipeName: parsedTurn.resolved.selectedRecipeName ?? "",
      providerId: parsedTurn.resolved.providerId ?? "",
      addressId: parsedTurn.resolved.addressId ?? "",
      affirmative: parsedTurn.resolved.affirmative,
      trackingIntent: parsedTurn.resolved.trackingIntent,
      confidence: parsedTurn.resolved.confidence,
    });

    if (
      session.canOfferRestaurantFallback &&
      session.selectedRecipe &&
      parsedTurn.resolved.wantsRestaurantFallback
    ) {
      session.pendingRestaurantFallback = true;
      session.pendingFoodCartBuild = false;
      const restaurantState = await buildRestaurantFallbackState(
        session.slug,
        session.selectedRecipe,
        session.selectedAddress,
        session.context,
      );
      if ("resolvedAddress" in restaurantState && restaurantState.resolvedAddress) {
        session.selectedAddress = restaurantState.resolvedAddress;
      }
      session.messages.push(restaurantState.message);
      session.restaurantOptions =
        restaurantState.kind === "restaurants"
          ? restaurantState.message.items
          : [];
      session.selectedRestaurant = null;
      session.foodCart = null;
      session.stage =
        restaurantState.kind === "provider"
          ? "provider-connect"
          : restaurantState.kind === "address"
            ? "address-confirm"
            : restaurantState.kind === "restaurants"
              ? "restaurant-fallback"
              : "recipe-selection";
      return finalizeSession(session);
    }

    if (parsedTurn.resolved.wantsRecipeRefresh) {
      const hintedRecipe = parsedTurn.resolved.hintedRecipeName
        ? session.recipeOptions.find(
            (recipe) =>
              recipe.name.toLowerCase() ===
              parsedTurn.resolved.hintedRecipeName?.toLowerCase(),
          ) ?? null
        : null;
      traceEvent("chat-engine", "recipe_refresh_requested", {
        slug,
        stage: session.stage,
        source: parsedTurn.resolved.usedLlm ? "llm" : "local",
        hintedRecipe: hintedRecipe?.name ?? "",
        similarityIntent: parsedTurn.resolved.similarityIntent,
      });
      if (parsedTurn.llm) {
        traceEvent("chat-engine", "intent_llm_requested", {
          slug,
          stage: session.stage,
          reason: "low_confidence_recipe_selection",
        });
        traceEvent("chat-engine", "intent_llm_used", {
          slug,
          stage: session.stage,
          intentSource: parsedTurn.resolved.intentSource,
          confidence: parsedTurn.llm.confidence,
          action: "reroll",
          llmIntent: parsedTurn.llm,
        });
      }
      const rerollContext = parsedTurn.resolved.similarityIntent
        ? buildSimilarRecipeContext(session.context, hintedRecipe)
        : session.context;
      const rerolledOptions = searchRecipes(rerollContext, {
        mode: session.discoveryMode,
        excludeIds: new Set(session.shownRecipeIds),
        preferNovelty: true,
      });

      if (!rerolledOptions.length) {
        session.messages.push(
          createMessage(
            "assistant",
            "I don’t have a better second batch from the current catalog for that direction yet. Tell me what to change, like spicier, lighter, quicker, or more indulgent.",
            nextMessageId(session),
          ),
        );
        return finalizeSession(session);
      }

      session.recipeOptions = rerolledOptions;
      session.shownRecipeIds.push(...rerolledOptions.map((recipe) => recipe.id));
      session.selectedRecipe = null;
      session.messages.push({
        id: nextMessageId(session),
        role: "assistant",
        type: "recipes",
        title: buildRecipeListTitle(session.discoveryMode, true),
        items: rerolledOptions,
      });
      return finalizeSession(session);
    }

    if (parsedTurn.llm) {
      traceEvent("chat-engine", "intent_llm_requested", {
        slug,
        stage: session.stage,
        reason: "low_confidence_recipe_selection",
      });
      traceEvent("chat-engine", "intent_llm_used", {
        slug,
        stage: session.stage,
        intentSource: parsedTurn.resolved.intentSource,
        confidence: parsedTurn.llm.confidence,
        action: parsedTurn.llm.selectedRecipeName ? "selection_hint" : "parse_only",
        llmIntent: parsedTurn.llm,
      });
    }

    const recipe = parsedTurn.resolved.selectedRecipeName
      ? session.recipeOptions.find(
          (option) =>
            option.name.toLowerCase() ===
            parsedTurn.resolved.selectedRecipeName?.toLowerCase(),
        ) ?? null
      : null;
    if (!recipe) {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the recipe cards, tell me the recipe name you want, or ask for other options.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.selectedRecipe = recipe;
    traceEvent("chat-engine", "recipe_selected", {
      slug,
      recipe: recipe.name,
      pantryItems: session.context.pantryItems,
    });

    if (needsPantryCheckBeforeCart(session)) {
      traceEvent("chat-engine", "pantry_check_requested", {
        slug,
        recipe: recipe.name,
      });
      session.messages.push(
        createMessage(
          "assistant",
          `Before I build the cart for ${recipe.name}, tell me what you already have at home. If you want me to assume nothing and order the missing groceries, just say that.`,
          nextMessageId(session),
        ),
      );
      session.stage = "pantry-check";
      return finalizeSession(session);
    }

    const cartState = await buildCartMessage(
      session.slug,
      recipe,
      session.context.pantryItems,
      session.selectedAddress,
    );
    session.messages.push(cartState.message);
    session.comparedCartOptions =
      cartState.kind === "comparison"
        ? cartState.options
        : cartState.kind === "cart"
          ? [cartState.option]
          : [];
    traceEvent("chat-engine", "cart_state_built", {
      slug,
      recipe: recipe.name,
      kind: cartState.kind,
      optionCount: cartState.kind === "comparison" ? cartState.options.length : 0,
      selectedAddress: session.selectedAddress?.addressLine ?? "",
    });
    session.canOfferRestaurantFallback = cartState.kind === "blocked";
    session.pendingRestaurantFallback = false;
    session.pendingFoodCartBuild = false;
    session.restaurantOptions = [];
    session.selectedRestaurant = null;
    session.foodCart = null;
    session.activeOrder = null;
    session.stage =
      cartState.kind === "provider"
        ? "provider-connect"
        : cartState.kind === "address"
          ? "address-confirm"
        : cartState.kind === "comparison"
          ? "cart-comparison"
        : cartState.kind === "cart"
          ? "cart-review"
        : cartState.kind === "blocked"
          ? "recipe-selection"
        : cartState.kind === "ready"
          ? "ready-to-cook"
          : "cart-review";
    return finalizeSession(session);
  }

  if (session.stage === "pantry-check") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      canOfferRestaurantFallback: session.canOfferRestaurantFallback,
      selectedRecipe: session.selectedRecipe,
    });

    session.context = parsedTurn.resolved.nextContext;
    traceEvent("chat-engine", "local_intent_parsed", {
      slug,
      stage: session.stage,
      resolved: parsedTurn.resolved,
      intentSource: parsedTurn.resolved.intentSource,
      pantryCount: parsedTurn.local.pantryItems.length,
      pantryItems: parsedTurn.local.pantryItems,
      willingToOrderGroceries: parsedTurn.local.willingToOrderGroceries,
      confidence: parsedTurn.resolved.confidence,
    });

    if (parsedTurn.resolved.wantsRecipeRefresh) {
      session.stage = "recipe-selection";
      session.messages.push(
        createMessage(
          "assistant",
          "Tell me the other recipe direction you want, and I’ll switch before building the cart.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    if (!session.selectedRecipe) {
      session.messages.push(
        createMessage(
          "assistant",
          "I lost the selected recipe. Pick the recipe again and I’ll continue from there.",
          nextMessageId(session),
        ),
      );
      session.stage = "recipe-selection";
      return finalizeSession(session);
    }

    if (
      session.context.pantryItems.length === 0 &&
      !session.context.willingToOrderGroceries
    ) {
      session.messages.push(
        createMessage(
          "assistant",
          `Tell me what you already have at home for ${session.selectedRecipe.name}, or say you’re okay ordering the missing groceries.`,
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    traceEvent("chat-engine", "pantry_check_completed", {
      slug,
      recipe: session.selectedRecipe.name,
      pantryItems: session.context.pantryItems,
      willingToOrderGroceries: session.context.willingToOrderGroceries,
    });

    const cartState = await buildCartMessage(
      session.slug,
      session.selectedRecipe,
      session.context.pantryItems,
      session.selectedAddress,
    );
    session.messages.push(cartState.message);
    session.comparedCartOptions =
      cartState.kind === "comparison"
        ? cartState.options
        : cartState.kind === "cart"
          ? [cartState.option]
          : [];
    traceEvent("chat-engine", "cart_state_built", {
      slug,
      recipe: session.selectedRecipe.name,
      kind: cartState.kind,
      optionCount: cartState.kind === "comparison" ? cartState.options.length : 0,
      selectedAddress: session.selectedAddress?.addressLine ?? "",
    });
    session.canOfferRestaurantFallback = cartState.kind === "blocked";
    session.pendingRestaurantFallback = false;
    session.pendingFoodCartBuild = false;
    session.restaurantOptions = [];
    session.selectedRestaurant = null;
    session.foodCart = null;
    session.activeOrder = null;
    session.stage =
      cartState.kind === "provider"
        ? "provider-connect"
        : cartState.kind === "address"
          ? "address-confirm"
          : cartState.kind === "comparison"
            ? "cart-comparison"
          : cartState.kind === "cart"
            ? "cart-review"
          : cartState.kind === "blocked"
            ? "recipe-selection"
          : cartState.kind === "ready"
            ? "ready-to-cook"
            : "cart-review";
    return finalizeSession(session);
  }

  if (session.stage === "ready-to-cook") {
    session.messages.push(
      createMessage(
        "assistant",
        "You already have what you need for this recipe. If you want another option, pick a different recipe or tell me what to cook next.",
        nextMessageId(session),
      ),
    );
    return finalizeSession(session);
  }

  if (session.stage === "provider-connect") {
    const providerOptions =
      session.eatOutMode === "dineout" && session.selectedRecipe?.tags.includes("dineout")
        ? GROCERY_PROVIDER_OPTIONS.filter((provider) => provider.id === "swiggy-dineout")
        : GROCERY_PROVIDER_OPTIONS.filter((provider) =>
            session.pendingRestaurantFallback || session.pendingFoodCartBuild
              ? provider.id === "swiggy-food"
              : provider.id !== "swiggy-food" && provider.id !== "swiggy-dineout",
          );
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      providerOptions: providerOptions.map((provider) => ({
        id: provider.id,
        label: provider.label,
      })),
    });

    if (parsedTurn.resolved.primaryIntent === "choose_provider") {
      session.messages.push(
        createMessage(
          "assistant",
          session.eatOutMode === "dineout" && session.selectedRecipe?.tags.includes("dineout")
            ? "Use the Swiggy Dineout button below to finish auth. Once that reconnect is done, I’ll resume the booking search automatically in the same chat."
            : session.pendingRestaurantFallback || session.pendingFoodCartBuild
            ? "Use the Swiggy Food button below to finish auth. Once that reconnect is done, I’ll resume this step automatically in the same chat."
            : "Use the matching provider button below to finish auth. Once that reconnect is done, I’ll resume this step automatically in the same chat.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.messages.push(
      createMessage(
        "assistant",
        session.eatOutMode === "dineout" && session.selectedRecipe?.tags.includes("dineout")
          ? "Use the Swiggy Dineout button to finish auth, then I’ll resume the booking search in this chat."
          : session.pendingRestaurantFallback || session.pendingFoodCartBuild
          ? "Use the Swiggy Food button to finish auth, then I’ll resume the restaurant order step in this chat."
          : "Use one of the grocery provider buttons to finish auth, then I’ll resume the grocery step in this chat.",
        nextMessageId(session),
      ),
    );
    return finalizeSession(session);
  }

  if (session.stage === "address-confirm") {
    const availableAddresses =
      session.eatOutMode === "dineout" && session.selectedRecipe?.tags.includes("dineout")
      ? await (async () => {
          const grocery = await loadGroceryModule();
          const addressResult = await grocery.listGroceryAddresses("swiggy-dineout", session.slug);
          if (addressResult.status !== "ready") {
            return [] as ResolvedAddress[];
          }
          return resolveAddressOptions([
            {
              provider: "swiggy-dineout",
              addresses: addressResult.addresses,
            },
          ]);
        })()
      : session.pendingRestaurantFallback || session.pendingFoodCartBuild
      ? await (async () => {
          const grocery = await loadGroceryModule();
          const addressResult = await grocery.listGroceryAddresses("swiggy-food", session.slug);
          if (addressResult.status !== "ready") {
            return [] as ResolvedAddress[];
          }
          return resolveAddressOptions([
            {
              provider: "swiggy-food",
              addresses: addressResult.addresses,
            },
          ]);
        })()
      : await listResolvedAddressesForSession(session.slug);
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      addressOptions: availableAddresses,
    });
    const chosenAddress = parsedTurn.resolved.addressId
      ? availableAddresses.find((address) => address.id === parsedTurn.resolved.addressId) ??
        null
      : null;

    if (chosenAddress) {
      session.selectedAddress = chosenAddress;
      traceEvent("chat-engine", "address_selected", {
        slug,
        address: chosenAddress.addressLine,
        providers: Object.keys(chosenAddress.providerIds),
      });
    }

    if (parsedTurn.resolved.primaryIntent !== "choose_address") {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the saved addresses to continue, or tell me this is the wrong delivery address.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    if (!session.selectedRecipe || !session.selectedAddress) {
      session.messages.push(
        createMessage(
          "assistant",
          "I lost the recipe or address context for this cart. Pick the recipe again and I’ll rebuild it.",
          nextMessageId(session),
        ),
      );
      session.stage = "recipe-selection";
      return finalizeSession(session);
    }

    if (session.eatOutMode === "dineout" && session.selectedRecipe.tags.includes("dineout")) {
      const dineoutState = await buildDineoutResultsState(
        session.slug,
        session.selectedRecipe.name,
        session.selectedAddress,
        session.dineoutOccasion,
        session.dineoutBudget,
        session.dineoutAreaHints,
      );
      if ("resolvedAddress" in dineoutState && dineoutState.resolvedAddress) {
        session.selectedAddress = dineoutState.resolvedAddress;
      }
      session.messages.push(dineoutState.message);
      session.dineoutOptions =
        dineoutState.kind === "dineout-restaurants" ? dineoutState.message.items : [];
      session.stage =
        dineoutState.kind === "provider"
          ? "provider-connect"
          : dineoutState.kind === "address"
            ? "address-confirm"
            : dineoutState.kind === "dineout-restaurants"
              ? "dineout-results"
              : "collecting-context";
      return finalizeSession(session);
    }

    const cartState = session.pendingFoodCartBuild && session.selectedRecipe && session.selectedRestaurant
      ? await buildFoodCartState(
          session.slug,
          session.selectedRecipe,
          session.selectedRestaurant,
          session.selectedAddress,
        )
      : session.pendingRestaurantFallback
        ? await buildRestaurantFallbackState(
            session.slug,
            session.selectedRecipe,
            session.selectedAddress,
            session.context,
          )
      : await buildCartMessage(
          session.slug,
          session.selectedRecipe,
          session.context.pantryItems,
          session.selectedAddress,
        );

    session.messages.push(cartState.message);
    session.comparedCartOptions =
      cartState.kind === "comparison"
        ? cartState.options
        : cartState.kind === "cart"
          ? [cartState.option]
          : [];
    session.canOfferRestaurantFallback = cartState.kind === "blocked";
    session.restaurantOptions =
      cartState.kind === "restaurants" ? cartState.message.items : [];
    session.foodCart = "cart" in cartState ? cartState.cart : null;
    if (!(cartState.kind === "provider" || cartState.kind === "address")) {
      session.pendingRestaurantFallback = false;
      session.pendingFoodCartBuild = false;
    }
    session.stage =
      cartState.kind === "ready"
        ? "ready-to-cook"
      : cartState.kind === "provider"
          ? "provider-connect"
          : cartState.kind === "address"
            ? "address-confirm"
            : cartState.kind === "comparison"
              ? "cart-comparison"
            : cartState.kind === "cart"
              ? "cart-review"
            : cartState.kind === "restaurants"
              ? "restaurant-fallback"
            : cartState.kind === "food-cart"
              ? "food-cart-review"
            : cartState.kind === "blocked"
              ? "recipe-selection"
            : "cart-review";
    return finalizeSession(session);
  }

  if (session.stage === "cart-comparison") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
      providerOptions: session.comparedCartOptions.map((option) => ({
        id: option.provider,
        label: getGroceryProviderLabel(option.provider),
      })),
    });
    const provider = parsedTurn.resolved.providerId as GroceryCartProviderId | null;
    if (!provider || !session.selectedRecipe) {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the provider carts to continue with the order flow.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const selectedOption = session.comparedCartOptions.find(
      (option) => option.provider === provider,
    );

    if (!selectedOption) {
      session.messages.push(
        createMessage(
          "assistant",
          `I could not lock ${getGroceryProviderLabel(provider)} from the comparison result. Pick another provider or retry.`,
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.selectedProvider = provider;
    session.selectedCartProvider = provider;
    traceEvent("chat-engine", "comparison_choice", {
      slug,
      provider,
      recipe: session.selectedRecipe.name,
    });
    session.messages.push(
      buildSelectedCartMessage(
        session.selectedRecipe,
        provider,
        selectedOption.items,
        selectedOption.unresolvedIngredients,
        {
          subtotal: selectedOption.subtotal,
          fees: selectedOption.fees,
          total: selectedOption.total,
        },
        selectedOption.note,
      ),
    );
    session.comparedCartOptions = [];
    session.activeOrder = null;
    session.stage = "cart-review";
    return finalizeSession(session);
  }

  if (session.stage === "cart-review") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
    });
    if (parsedTurn.resolved.primaryIntent !== "place_order") {
      session.messages.push(
        createMessage(
          "assistant",
          "If you want to continue, say “place the order”. Otherwise we can pick a different recipe.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    if (
      session.selectedCartProvider === "swiggy-instamart" ||
      session.selectedCartProvider === "zepto"
    ) {
      const provider = session.selectedCartProvider;
      const mockMode =
        provider === "swiggy-instamart"
          ? SWIGGY_ORDER_MODE !== "live"
          : ZEPTO_ORDER_MODE !== "live";
      const grocery = await loadGroceryModule();
      const orderResult = await grocery.placeGroceryOrder(
        provider,
        session.slug,
        mockMode,
      );
      traceEvent("chat-engine", "grocery_order_result", {
        slug,
        provider,
        status: orderResult.status,
        mockMode,
      });

      if (orderResult.status === "ready") {
        session.activeOrder = {
          provider,
          orderId: orderResult.orderId,
          mockMode: orderResult.mockMode,
          lastTrackedAt: Date.now(),
        };

        if (orderResult.mockMode) {
          session.messages.push(
            createMessage(
              "assistant",
              buildMockCheckoutMessage(provider),
              nextMessageId(session),
            ),
          );
        }

        session.messages.push(buildTrackingMessageFromOrder(orderResult.tracking));
        session.stage = "tracking";
        return finalizeSession(session);
      }

      if (orderResult.status === "auth_required") {
        session.messages.push(
          buildAuthRecoveryMessage(
            session.slug,
            provider,
            orderResult.authReason,
            `${getGroceryProviderLabel(provider)} needs to be reconnected before checkout.`,
          ),
        );
        session.stage = "provider-connect";
        return finalizeSession(session);
      }

      session.messages.push(
        createMessage(
          "assistant",
          buildCheckoutFailureMessage(orderResult.reason),
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const mockOrderId = `VO-${String(Date.now()).slice(-5)}`;
    session.messages.push(
      createMessage(
        "assistant",
        buildMockCheckoutMessage(session.selectedCartProvider ?? "zepto"),
        nextMessageId(session),
      ),
    );
    session.messages.push(buildTrackingMessage(mockOrderId));
    session.activeOrder = {
      provider: session.selectedCartProvider ?? "zepto",
      orderId: mockOrderId,
      mockMode: true,
      lastTrackedAt: Date.now(),
    };
    session.stage = "tracking";
    return finalizeSession(session);
  }

  if (session.stage === "restaurant-fallback") {
    const refinement = parseDeliveryRefinement(text, session.restaurantOptions);
    if (refinement && session.selectedRecipe) {
      session.restaurantOptions = rerankDeliveryRestaurants(
        session.restaurantOptions,
        session.selectedRecipe.name,
        session.context.diet,
        refinement,
      );
      session.messages.push(
        buildRestaurantResultsMessage(
          session.selectedRecipe,
          session.restaurantOptions,
          deliveryRefinementNote(refinement),
        ),
      );
      return finalizeSession(session);
    }

    const restaurant = findSelectedRestaurant(text, session.restaurantOptions);
    if (!restaurant || !session.selectedRecipe) {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the restaurant cards to build the final food order cart, or tell me to make this cheaper, faster, veg only, lighter, no eggs, or more like one of these.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.selectedRestaurant = restaurant;
    session.pendingRestaurantFallback = false;
    const foodCartState = await buildFoodCartState(
      session.slug,
      session.selectedRecipe,
      restaurant,
      session.selectedAddress,
    );

    if ("resolvedAddress" in foodCartState && foodCartState.resolvedAddress) {
      session.selectedAddress = foodCartState.resolvedAddress;
    }

    session.messages.push(foodCartState.message);
    session.foodCart =
      foodCartState.kind === "food-cart" ? foodCartState.cart : null;
    session.pendingFoodCartBuild =
      foodCartState.kind === "provider" || foodCartState.kind === "address";
    session.stage =
      foodCartState.kind === "provider"
        ? "provider-connect"
        : foodCartState.kind === "address"
          ? "address-confirm"
          : foodCartState.kind === "food-cart"
            ? "food-cart-review"
            : "recipe-selection";
    return finalizeSession(session);
  }

  if (session.stage === "dineout-results") {
    const restaurant = findSelectedDineoutRestaurant(text, session.dineoutOptions);
    if (!restaurant) {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the dine-out restaurant cards and I’ll check the free table slots.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.selectedDineoutRestaurant = restaurant;
    const guestCount = session.dineoutPartySize ?? 2;
    const slotsState = await buildDineoutSlotsState(
      session.slug,
      restaurant,
      session.selectedAddress,
      guestCount,
    );

    session.messages.push(slotsState.message);
    session.dineoutSlots =
      slotsState.kind === "dineout-slots" ? slotsState.slots : [];
    session.stage =
      slotsState.kind === "provider"
        ? "provider-connect"
        : slotsState.kind === "dineout-slots"
          ? "dineout-slot-review"
          : "dineout-results";
    return finalizeSession(session);
  }

  if (session.stage === "dineout-slot-review") {
    const slot = findSelectedDineoutSlot(text, session.dineoutSlots);
    if (!slot || !session.selectedDineoutRestaurant) {
      session.messages.push(
        createMessage(
          "assistant",
          "Pick one of the available table slots and I’ll confirm the booking.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const grocery = await loadGroceryModule();
    const bookingResult = await grocery.bookProviderDineoutTable(
      "swiggy-dineout",
      session.slug,
      session.selectedDineoutRestaurant.id,
      slot.slotId,
      slot.guestCount,
    );

    if (bookingResult.status === "auth_required") {
      session.messages.push(
        buildAuthRecoveryMessage(
          session.slug,
          "swiggy-dineout",
          bookingResult.authReason,
          "Swiggy Dineout needs to be reconnected before booking the table.",
        ),
      );
      session.stage = "provider-connect";
      return finalizeSession(session);
    }

    if (bookingResult.status === "unavailable") {
      session.messages.push(
        createMessage(
          "assistant",
          bookingResult.reason,
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.dineoutBooking = {
      bookingId: bookingResult.bookingId,
      restaurantId: session.selectedDineoutRestaurant.id,
      restaurantName: bookingResult.restaurantName,
      status: bookingResult.bookingStatus,
      dateLabel: bookingResult.dateLabel,
      timeLabel: bookingResult.timeLabel,
      guestCount: bookingResult.guestCount,
      dealTitle: bookingResult.dealTitle,
      addressLine: bookingResult.addressLine,
    };
    session.messages.push(
      buildDineoutBookingMessage({
        bookingId: bookingResult.bookingId,
        restaurantName: bookingResult.restaurantName,
        status: bookingResult.bookingStatus,
        dateLabel: bookingResult.dateLabel,
        timeLabel: bookingResult.timeLabel,
        guestCount: bookingResult.guestCount,
        dealTitle: bookingResult.dealTitle,
        addressLine: bookingResult.addressLine,
      }),
    );
    session.stage = "dineout-booking";
    return finalizeSession(session);
  }

  if (session.stage === "food-cart-review") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
    });
    if (parsedTurn.resolved.primaryIntent !== "place_order") {
      session.messages.push(
        createMessage(
          "assistant",
          "If you want to continue, say “place the order”. Otherwise we can pick another restaurant or another recipe.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const grocery = await loadGroceryModule();
    const orderResult = await grocery.placeGroceryOrder(
      "swiggy-food",
      session.slug,
      SWIGGY_FOOD_ORDER_MODE !== "live",
    );
    traceEvent("chat-engine", "food_order_result", {
      slug,
      provider: "swiggy-food",
      status: orderResult.status,
      mockMode: SWIGGY_FOOD_ORDER_MODE !== "live",
    });

    if (orderResult.status === "ready") {
      session.activeOrder = {
        provider: "swiggy-food",
        orderId: orderResult.orderId,
        mockMode: orderResult.mockMode,
        lastTrackedAt: Date.now(),
      };

      if (orderResult.mockMode) {
        session.messages.push(
          createMessage(
            "assistant",
            buildMockCheckoutMessage("swiggy-food"),
            nextMessageId(session),
          ),
        );
      }

      session.messages.push(buildTrackingMessageFromOrder(orderResult.tracking));
      session.stage = "tracking";
      return finalizeSession(session);
    }

    if (orderResult.status === "auth_required") {
      session.messages.push(
        buildAuthRecoveryMessage(
          session.slug,
          "swiggy-food",
          orderResult.authReason,
          "Swiggy Food needs to be reconnected before checkout.",
        ),
      );
      session.stage = "provider-connect";
      return finalizeSession(session);
    }

    session.messages.push(
      createMessage(
        "assistant",
        buildCheckoutFailureMessage(orderResult.reason),
        nextMessageId(session),
      ),
    );
    return finalizeSession(session);
  }

  if (session.stage === "dineout-booking") {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: "tracking",
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
    });

    if (parsedTurn.resolved.primaryIntent !== "track_order" || !session.dineoutBooking) {
      session.messages.push(
        createMessage(
          "assistant",
          "Ask about the booking status if you want me to refresh the table confirmation, or start another search for tonight.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const grocery = await loadGroceryModule();
    const bookingResult = await grocery.getProviderDineoutBookingStatus(
      "swiggy-dineout",
      session.slug,
      session.dineoutBooking.bookingId,
    );

    if (bookingResult.status === "auth_required") {
      session.messages.push(
        buildAuthRecoveryMessage(
          session.slug,
          "swiggy-dineout",
          bookingResult.authReason,
          "Swiggy Dineout needs to be reconnected before I can refresh the booking status.",
        ),
      );
      session.stage = "provider-connect";
      return finalizeSession(session);
    }

    if (bookingResult.status === "unavailable") {
      session.messages.push(
        createMessage(
          "assistant",
          bookingResult.reason,
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    session.dineoutBooking = {
      ...session.dineoutBooking,
      status: bookingResult.bookingStatus,
      dateLabel: bookingResult.dateLabel,
      timeLabel: bookingResult.timeLabel,
      guestCount: bookingResult.guestCount,
      dealTitle: bookingResult.dealTitle,
      addressLine: bookingResult.addressLine,
    };
    session.messages.push(
      buildDineoutBookingMessage({
        bookingId: bookingResult.bookingId,
        restaurantName: bookingResult.restaurantName,
        status: bookingResult.bookingStatus,
        dateLabel: bookingResult.dateLabel,
        timeLabel: bookingResult.timeLabel,
        guestCount: bookingResult.guestCount,
        dealTitle: bookingResult.dealTitle,
        addressLine: bookingResult.addressLine,
      }),
    );
    return finalizeSession(session);
  }

  if (
    session.stage === "tracking" &&
    (session.activeOrder?.provider === "swiggy-instamart" ||
      session.activeOrder?.provider === "swiggy-food") &&
    !session.activeOrder.mockMode
  ) {
    const parsedTurn = await parseTurnIntent({
      text,
      stage: session.stage,
      context: session.context,
      discoveryMode: session.discoveryMode,
      recipeOptions: session.recipeOptions,
    });
    if (parsedTurn.resolved.primaryIntent !== "track_order") {
      session.messages.push(
        createMessage(
          "assistant",
          "Ask about the order status, ETA, or where the rider is if you want a live tracking refresh.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const now = Date.now();
    if (now - session.activeOrder.lastTrackedAt < SWIGGY_TRACK_POLL_INTERVAL_MS) {
      session.messages.push(
        createMessage(
          "assistant",
          "I just refreshed that order. Ask again in a few seconds if you want another live status check.",
          nextMessageId(session),
        ),
      );
      return finalizeSession(session);
    }

    const grocery = await loadGroceryModule();
    const trackingResult = await grocery.trackGroceryOrder(
      session.activeOrder.provider,
      session.slug,
      session.activeOrder.orderId,
    );
    traceEvent("chat-engine", "tracking_refresh_result", {
      slug,
      provider: session.activeOrder.provider,
      status: trackingResult.status,
      orderId: session.activeOrder.orderId,
    });

    if (trackingResult.status === "ready") {
      session.activeOrder.lastTrackedAt = Date.now();
      session.messages.push(buildTrackingMessageFromOrder(trackingResult));
      return finalizeSession(session);
    }

    session.messages.push(
      trackingResult.status === "auth_required"
        ? buildAuthRecoveryMessage(
            session.slug,
            session.activeOrder.provider,
            trackingResult.authReason,
            `${getGroceryProviderLabel(session.activeOrder.provider)} needs to be reconnected before I can refresh tracking.`,
          )
        : createMessage(
            "assistant",
            trackingResult.reason,
            nextMessageId(session),
          ),
    );
    return finalizeSession(session);
  }

  if (session.stage === "tracking" && session.activeOrder?.mockMode) {
    session.messages.push(
      createMessage(
        "assistant",
        `This is a simulated ${getGroceryProviderLabel(session.activeOrder.provider)} order for demo purposes, so there isn’t a live rider status to refresh.`,
        nextMessageId(session),
      ),
    );
    return finalizeSession(session);
  }

  session.messages.push(
    createMessage(
      "assistant",
      "The order is already in motion. We can keep this chat open for the next meal too.",
      nextMessageId(session),
    ),
  );
  return finalizeSession(session);
}

export async function completeGroceryConnectForSession(
  provider: GroceryProviderId,
  slug: string,
  code: string,
  state: string | null,
) {
  traceEvent("chat-engine", "provider_connect_complete_start", {
    slug,
    provider,
    hasCode: Boolean(code),
    hasState: Boolean(state),
  });
  const grocery = await loadGroceryModule();
  await grocery.finishGroceryAuth(provider, slug, code, state);

  const session = getSessionState(slug);
  session.selectedProvider = provider;
  traceEvent("chat-engine", "provider_connected", {
    slug,
    provider,
    stage: session.stage,
  });
  if (!session.selectedRecipe) {
    return finalizeSession(session);
  }

  if (provider === "swiggy-dineout" && session.selectedRecipe.tags.includes("dineout")) {
    const dineoutState = await buildDineoutResultsState(
      session.slug,
      session.selectedRecipe.name,
      session.selectedAddress,
      session.dineoutOccasion,
      session.dineoutBudget,
      session.dineoutAreaHints,
    );

    if ("resolvedAddress" in dineoutState && dineoutState.resolvedAddress) {
      session.selectedAddress = dineoutState.resolvedAddress;
    }

    session.messages.push(
      createMessage(
        "assistant",
        `${getGroceryProviderLabel(provider)} is connected. I looked for live table-booking options for this plan.`,
        nextMessageId(session),
      ),
    );
    session.messages.push(dineoutState.message);
    session.dineoutOptions =
      dineoutState.kind === "dineout-restaurants" ? dineoutState.message.items : [];
    session.stage =
      dineoutState.kind === "provider"
        ? "provider-connect"
        : dineoutState.kind === "address"
          ? "address-confirm"
          : dineoutState.kind === "dineout-restaurants"
            ? "dineout-results"
            : "collecting-context";
    return finalizeSession(session);
  }

  if (provider === "swiggy-food" || session.pendingRestaurantFallback || session.pendingFoodCartBuild) {
    const restaurantState =
      session.pendingFoodCartBuild && session.selectedRestaurant
        ? await buildFoodCartState(
            session.slug,
            session.selectedRecipe,
            session.selectedRestaurant,
            session.selectedAddress,
          )
        : await buildRestaurantFallbackState(
            session.slug,
            session.selectedRecipe,
            session.selectedAddress,
            session.context,
          );

    if ("resolvedAddress" in restaurantState && restaurantState.resolvedAddress) {
      session.selectedAddress = restaurantState.resolvedAddress;
    }

    session.messages.push(
      createMessage(
        "assistant",
        session.pendingFoodCartBuild
          ? `${getGroceryProviderLabel(provider)} is connected. I built the final food cart for this dish.`
          : `${getGroceryProviderLabel(provider)} is connected. I looked for nearby restaurant options for this dish.`,
        nextMessageId(session),
      ),
    );
    session.messages.push(restaurantState.message);
    session.restaurantOptions =
      restaurantState.kind === "restaurants" ? restaurantState.message.items : [];
    session.foodCart = "cart" in restaurantState ? restaurantState.cart : null;
    session.stage =
      restaurantState.kind === "provider"
        ? "provider-connect"
        : restaurantState.kind === "address"
          ? "address-confirm"
          : restaurantState.kind === "restaurants"
            ? "restaurant-fallback"
            : restaurantState.kind === "food-cart"
              ? "food-cart-review"
            : "recipe-selection";
    session.canOfferRestaurantFallback = restaurantState.kind === "blocked";
    session.pendingRestaurantFallback =
      !session.pendingFoodCartBuild &&
      (restaurantState.kind === "provider" || restaurantState.kind === "address");
    session.pendingFoodCartBuild =
      session.pendingFoodCartBuild &&
      (restaurantState.kind === "provider" || restaurantState.kind === "address");
    return finalizeSession(session);
  }

  const cartState = await buildCartMessage(
    session.slug,
    session.selectedRecipe,
    session.selectedRecipe.tags.includes("shopping-list")
      ? []
      : session.context.pantryItems,
    session.selectedAddress,
  );

  session.messages.push(
    createMessage(
      "assistant",
      `${getGroceryProviderLabel(provider)} is connected. I pulled the missing grocery matches into the chat.`,
      nextMessageId(session),
    ),
  );
  session.messages.push(cartState.message);
  session.comparedCartOptions =
    cartState.kind === "comparison"
      ? cartState.options
      : cartState.kind === "cart"
        ? [cartState.option]
        : [];
  session.canOfferRestaurantFallback = cartState.kind === "blocked";
  session.pendingRestaurantFallback = false;
  session.pendingFoodCartBuild = false;
  session.activeOrder = null;
  session.stage =
    cartState.kind === "provider"
      ? "provider-connect"
      : cartState.kind === "address"
        ? "address-confirm"
      : cartState.kind === "comparison"
        ? "cart-comparison"
      : cartState.kind === "cart"
        ? "cart-review"
      : cartState.kind === "blocked"
        ? "recipe-selection"
      : cartState.kind === "ready"
        ? "ready-to-cook"
        : "cart-review";
  return finalizeSession(session);
}
