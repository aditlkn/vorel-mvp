import { createRemoteGroceryProvider } from "@/lib/grocery-provider";

export const swiggyInstamartProvider = createRemoteGroceryProvider({
  id: "swiggy-instamart",
  label: "Swiggy Instamart",
  serverUrl: "https://mcp.swiggy.com/im",
  searchToolCandidates: [
    "search_products",
    "search product",
    "searchProducts",
    "search",
  ],
  addressesToolCandidates: ["get_addresses", "addresses", "list_addresses"],
});

export const beginInstamartAuth = swiggyInstamartProvider.beginAuth;
export const finishInstamartAuth = swiggyInstamartProvider.finishAuth;
export const hasInstamartTokens = swiggyInstamartProvider.hasTokens;
export const listInstamartAddresses = swiggyInstamartProvider.listAddresses;
export const buildInstamartCart = swiggyInstamartProvider.buildCart;
