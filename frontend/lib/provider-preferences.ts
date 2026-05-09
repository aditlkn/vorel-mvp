import fs from "node:fs";
import path from "node:path";

type GroceryCartProviderId = "swiggy-instamart" | "zepto";

type ProviderPreferenceRecord = {
  activeCartProviders?: GroceryCartProviderId[];
};

type PreferenceStore = Record<string, ProviderPreferenceRecord>;

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "provider-preferences.json");
const DEFAULT_ACTIVE_CART_PROVIDERS: GroceryCartProviderId[] = [
  "swiggy-instamart",
  "zepto",
];

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({}, null, 2), "utf8");
  }
}

function readStore(): PreferenceStore {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as PreferenceStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: PreferenceStore) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase();
}

function normalizeCartProviders(
  providers: string[] | undefined,
): GroceryCartProviderId[] {
  const allowed = new Set<GroceryCartProviderId>(["swiggy-instamart", "zepto"]);
  const unique = new Set<GroceryCartProviderId>();

  for (const provider of providers ?? []) {
    if (allowed.has(provider as GroceryCartProviderId)) {
      unique.add(provider as GroceryCartProviderId);
    }
  }

  return [...unique];
}

export function getActiveCartProvidersForSlug(slug: string) {
  const store = readStore();
  const record = store[normalizeSlug(slug)];
  const configured = normalizeCartProviders(record?.activeCartProviders);
  return configured.length ? configured : DEFAULT_ACTIVE_CART_PROVIDERS;
}

export function setActiveCartProvidersForSlug(
  slug: string,
  providers: string[],
) {
  const normalizedSlug = normalizeSlug(slug);
  const store = readStore();
  store[normalizedSlug] = {
    ...(store[normalizedSlug] ?? {}),
    activeCartProviders: normalizeCartProviders(providers),
  };
  writeStore(store);
  return getActiveCartProvidersForSlug(normalizedSlug);
}
