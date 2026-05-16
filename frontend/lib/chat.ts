export type ChatMessage =
  | {
      id: string;
      role: "assistant" | "user";
      type: "text";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "providers";
      title: string;
      detail: string;
      items: Array<{
        provider: "swiggy-instamart" | "zepto" | "swiggy-food" | "swiggy-dineout";
        label: string;
        detail: string;
        href: string;
        ctaLabel: string;
      }>;
    }
  | {
      id: string;
      role: "assistant";
      type: "addresses";
      provider: "swiggy-instamart" | "zepto" | "swiggy-food" | "swiggy-dineout";
      title: string;
      detail: string;
      items: Array<{
        id: string;
        addressLine: string;
        addressTag?: string;
        ctaLabel: string;
      }>;
    }
  | {
      id: string;
      role: "assistant";
      type: "address-shortcut";
      provider?: "swiggy-instamart" | "zepto" | "swiggy-food" | "swiggy-dineout";
      title: string;
      detail: string;
      addressLine: string;
      addressTag?: string;
      primaryCtaLabel: string;
      secondaryCtaLabel: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "recipes";
      title: string;
      items: RecipeSuggestion[];
    }
  | {
      id: string;
      role: "assistant";
      type: "cart";
      title: string;
      recipeName: string;
      items: CartItem[];
      subtotal: number;
      fees: number;
      total: number;
    }
  | {
      id: string;
      role: "assistant";
      type: "provider-carts";
      recipeName: string;
      title: string;
      items: Array<{
        provider: "swiggy-instamart" | "zepto";
        label: string;
        title: string;
        items: CartItem[];
        subtotal: number;
        fees: number;
        total: number;
      }>;
    }
  | {
      id: string;
      role: "assistant";
      type: "tracking";
      orderId: string;
      eta: string;
      stage: "confirmed" | "packing" | "on-the-way";
      updates: TrackingUpdate[];
    }
  | {
      id: string;
      role: "assistant";
      type: "restaurants";
      title: string;
      detail: string;
      recipeName: string;
      items: RestaurantSuggestion[];
    }
  | {
      id: string;
      role: "assistant";
      type: "food-cart";
      title: string;
      recipeName: string;
      restaurantName: string;
      addressLine: string;
      paymentMethods: string[];
      items: CartItem[];
      subtotal: number;
      fees: number;
      total: number;
    }
  | {
      id: string;
      role: "assistant";
      type: "dineout-restaurants";
      title: string;
      detail: string;
      query: string;
      items: DineoutRestaurantSuggestion[];
    }
  | {
      id: string;
      role: "assistant";
      type: "dineout-slots";
      title: string;
      detail: string;
      restaurantName: string;
      items: DineoutSlotSuggestion[];
    }
  | {
      id: string;
      role: "assistant";
      type: "dineout-booking";
      title: string;
      restaurantName: string;
      bookingId: string;
      status: string;
      dateLabel: string;
      timeLabel: string;
      guestCount: number;
      dealTitle?: string;
      addressLine?: string;
    };

export type RecipeSuggestion = {
  id: string;
  name: string;
  cookTime: string;
  note: string;
  imageUrl: string;
  youtubeUrl: string;
  ingredients: string[];
  tags: string[];
};

export type ChatSession = {
  slug: string;
  displayName: string;
  stage: string;
  entryMode?: "cook-dinner" | "grocery-shopping" | "eat-out" | "meal-plan" | "free-text";
  messages: ChatMessage[];
  quickReplyChips?: Array<{
    label: string;
    text?: string;
    href?: string;
  }>;
};

export type CartItem = {
  id: string;
  name: string;
  quantity: string;
  price: number;
};

export type TrackingUpdate = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
};

export type RestaurantSuggestion = {
  id: string;
  name: string;
  cuisines: string[];
  eta: string;
  etaMinutes: number | null;
  distance: string;
  distanceKm: number | null;
  rating: string;
  availabilityStatus: "OPEN" | "CLOSED" | "UNAVAILABLE";
  costForTwo: string | null;
  offer: string | null;
  highlights: string[];
  matchReason?: string | null;
  ctaLabel: string;
};

export type DineoutRestaurantSuggestion = {
  id: string;
  name: string;
  cuisines: string[];
  costForTwo: string;
  distance: string;
  rating: string;
  availabilityStatus: "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
  highlights: string[];
  offer: string | null;
  ctaLabel: string;
  sourceAddressId?: string;
  sourceAddressLabel?: string;
  sourceLat?: number;
  sourceLng?: number;
};

export type DineoutSlotSuggestion = {
  id: string;
  slotId: string;
  restaurantId: string;
  restaurantName: string;
  dateLabel: string;
  timeLabel: string;
  slotGroupName: string;
  guestCount: number;
  dealTitle?: string;
  ctaLabel: string;
};

export function formatDisplayName(slug: string) {
  return (
    slug
      .trim()
      .toLowerCase()
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Guest"
  );
}
