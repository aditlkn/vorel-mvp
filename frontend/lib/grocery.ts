import {
  type AddressCreateInput,
  type GroceryProviderId,
  type GroceryAddressResult,
  type GroceryAddressMutationResult,
  type GroceryCartResult,
  type GroceryDisconnectResult,
  type GroceryFoodCartResult,
  type GroceryDebugAction,
  type GroceryDebugReportInput,
  type GroceryDineoutBookingResult,
  type GroceryDineoutSearchResult,
  type GroceryDineoutSlotsResult,
  type GroceryDebugSearchResult,
  type GroceryOrderDetailsResult,
  type GroceryOrderResult,
  type GroceryReportErrorResult,
  type GroceryRestaurantSearchResult,
  type GroceryTrackingResult,
  type SavedAddress,
} from "@/lib/grocery-provider";
import {
  getActiveCartProvidersForSlug,
  setActiveCartProvidersForSlug,
} from "@/lib/provider-preferences";
import { swiggyInstamartProvider } from "@/lib/swiggy";
import { swiggyDineoutProvider } from "@/lib/swiggy-dineout";
import { swiggyFoodProvider } from "@/lib/swiggy-food";
import { zeptoProvider } from "@/lib/zepto";

export type GroceryCartProviderId = Exclude<
  GroceryProviderId,
  "swiggy-food" | "swiggy-dineout"
>;

const providers = {
  "swiggy-instamart": swiggyInstamartProvider,
  "swiggy-food": swiggyFoodProvider,
  "swiggy-dineout": swiggyDineoutProvider,
  zepto: zeptoProvider,
} as const;

export type { GroceryProviderId, SavedAddress };
export type { AddressCreateInput } from "@/lib/grocery-provider";
export type { GroceryDebugAction, GroceryDebugReportInput } from "@/lib/grocery-provider";

export const GROCERY_PROVIDER_OPTIONS = [
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

export function getGroceryProviderLabel(providerId: GroceryProviderId) {
  return (
    GROCERY_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)?.label ??
    providerId
  );
}

export async function searchProviderDineoutRestaurants(
  providerId: GroceryProviderId,
  slug: string,
  query: string,
  addressId?: string | null,
  latitude?: number | null,
  longitude?: number | null,
  entityType?: string | null,
): Promise<GroceryDineoutSearchResult> {
  return providers[providerId].searchDineoutRestaurants(
    slug,
    query,
    addressId,
    latitude,
    longitude,
    entityType,
  );
}

export async function getProviderDineoutSlots(
  providerId: GroceryProviderId,
  slug: string,
  restaurantId: string,
  restaurantName: string,
  guestCount: number,
  latitude: number,
  longitude: number,
): Promise<GroceryDineoutSlotsResult> {
  return providers[providerId].getDineoutSlots(
    slug,
    restaurantId,
    restaurantName,
    guestCount,
    latitude,
    longitude,
  );
}

export async function bookProviderDineoutTable(
  providerId: GroceryProviderId,
  slug: string,
  restaurantId: string,
  slotId: string,
  guestCount: number,
): Promise<GroceryDineoutBookingResult> {
  return providers[providerId].bookDineoutTable(
    slug,
    restaurantId,
    slotId,
    guestCount,
  );
}

export async function getProviderDineoutBookingStatus(
  providerId: GroceryProviderId,
  slug: string,
  bookingId: string,
): Promise<GroceryDineoutBookingResult> {
  return providers[providerId].getDineoutBookingStatus(slug, bookingId);
}

export function listConnectedGroceryProviders(slug: string) {
  const activeProviders = new Set(getActiveCartProvidersForSlug(slug));
  return GROCERY_PROVIDER_OPTIONS.filter((provider) =>
    provider.id !== "swiggy-food" &&
    activeProviders.has(provider.id as GroceryCartProviderId) &&
    providers[provider.id].hasTokens(slug),
  ).map((provider) => provider.id) as GroceryCartProviderId[];
}

export function getConnectedGroceryProvider(slug: string) {
  return listConnectedGroceryProviders(slug)[0] ?? null;
}

export function getConnectedGroceryProviders(slug: string) {
  return listConnectedGroceryProviders(slug);
}

export function getActiveCartProviders(slug: string) {
  return getActiveCartProvidersForSlug(slug);
}

export function setActiveCartProviders(slug: string, providers: string[]) {
  return setActiveCartProvidersForSlug(slug, providers);
}

export async function beginGroceryAuth(providerId: GroceryProviderId, slug: string) {
  return providers[providerId].beginAuth(slug);
}

export async function finishGroceryAuth(
  providerId: GroceryProviderId,
  slug: string,
  code: string,
  state: string | null,
) {
  return providers[providerId].finishAuth(slug, code, state);
}

export function hasGroceryTokens(providerId: GroceryProviderId, slug: string) {
  return providers[providerId].hasTokens(slug);
}

export async function listGroceryAddresses(
  providerId: GroceryProviderId,
  slug: string,
): Promise<GroceryAddressResult> {
  return providers[providerId].listAddresses(slug);
}

export async function buildGroceryCart(
  providerId: GroceryProviderId,
  slug: string,
  missingIngredients: string[],
  addressId?: string | null,
): Promise<GroceryCartResult> {
  return providers[providerId].buildCart(slug, missingIngredients, addressId);
}

export async function placeGroceryOrder(
  providerId: GroceryProviderId,
  slug: string,
  mockMode: boolean,
): Promise<GroceryOrderResult> {
  return providers[providerId].placeOrder(slug, mockMode);
}

export async function trackGroceryOrder(
  providerId: GroceryProviderId,
  slug: string,
  orderId: string,
): Promise<GroceryTrackingResult> {
  return providers[providerId].trackOrder(slug, orderId);
}

export async function disconnectGroceryProvider(
  providerId: GroceryProviderId,
  slug: string,
): Promise<GroceryDisconnectResult> {
  return providers[providerId].disconnect(slug);
}

export async function getGroceryOrderDetails(
  providerId: GroceryProviderId,
  slug: string,
  orderId: string,
): Promise<GroceryOrderDetailsResult> {
  return providers[providerId].getOrderDetails(slug, orderId);
}

export async function reportGroceryProviderError(
  providerId: GroceryProviderId,
  slug: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<GroceryReportErrorResult> {
  return providers[providerId].reportError(slug, message, context);
}

export async function createGroceryAddress(
  providerId: GroceryProviderId,
  slug: string,
  input: AddressCreateInput,
): Promise<GroceryAddressMutationResult> {
  return providers[providerId].createAddress(slug, input);
}

export async function deleteGroceryAddress(
  providerId: GroceryProviderId,
  slug: string,
  addressId: string,
): Promise<GroceryAddressMutationResult> {
  return providers[providerId].deleteAddress(slug, addressId);
}

export async function searchProviderRestaurants(
  providerId: GroceryProviderId,
  slug: string,
  query: string,
  addressId?: string | null,
): Promise<GroceryRestaurantSearchResult> {
  return providers[providerId].searchRestaurants(slug, query, addressId);
}

export async function buildProviderFoodCart(
  providerId: GroceryProviderId,
  slug: string,
  addressId: string,
  restaurantId: string,
  query: string,
): Promise<GroceryFoodCartResult> {
  return providers[providerId].buildFoodCart(slug, addressId, restaurantId, query);
}

export async function debugProviderSearch(
  providerId: GroceryProviderId,
  slug: string,
  query: string,
  addressId?: string | null,
  latitude?: number | null,
  longitude?: number | null,
  entityType?: string | null,
): Promise<GroceryDebugSearchResult> {
  return providers[providerId].debugSearch(
    slug,
    query,
    addressId,
    latitude,
    longitude,
    entityType,
  );
}

export async function runProviderDebugAction(
  providerId: GroceryProviderId,
  slug: string,
  action: GroceryDebugAction,
  query?: string | null,
  report?: GroceryDebugReportInput | null,
  addressId?: string | null,
  latitude?: number | null,
  longitude?: number | null,
  entityType?: string | null,
): Promise<GroceryDebugSearchResult> {
  return providers[providerId].debugAction(
    slug,
    action,
    query,
    report,
    addressId,
    latitude,
    longitude,
    entityType,
  );
}
