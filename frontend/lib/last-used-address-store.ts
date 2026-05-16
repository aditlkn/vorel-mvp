import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { GroceryProviderId } from "@/lib/grocery-provider";
import type { ResolvedAddress } from "@/lib/address-resolver";

export type PersistedLastUsedAddress = {
  address: ResolvedAddress;
  updatedAt: number;
};

type LegacyStore = Record<string, PersistedLastUsedAddress>;

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "vorel-shared.db");
const LEGACY_JSON_PATH = path.join(DATA_DIR, "last-used-addresses.json");

let db: Database | null = null;
let legacyMigrationDone = false;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase();
}

function normalizeScopeKey(scopeKey: string | null | undefined) {
  return scopeKey?.trim().toLowerCase() || null;
}

function isProviderId(value: unknown): value is GroceryProviderId {
  return (
    value === "swiggy-instamart" ||
    value === "zepto" ||
    value === "swiggy-food" ||
    value === "swiggy-dineout"
  );
}

function sanitizeResolvedAddress(value: unknown): ResolvedAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.addressLine !== "string") {
    return null;
  }

  const providerIdsInput =
    record.providerIds && typeof record.providerIds === "object" && !Array.isArray(record.providerIds)
      ? (record.providerIds as Record<string, unknown>)
      : {};
  const providerIds: Partial<Record<GroceryProviderId, string>> = {};
  for (const [key, providerValue] of Object.entries(providerIdsInput)) {
    if (isProviderId(key) && typeof providerValue === "string" && providerValue) {
      providerIds[key] = providerValue;
    }
  }

  const matchedProvidersInput = Array.isArray(record.matchedProviders)
    ? record.matchedProviders
    : [];
  const matchedProviders = matchedProvidersInput.filter(isProviderId);

  return {
    id: record.id,
    addressLine: record.addressLine,
    addressTag: typeof record.addressTag === "string" ? record.addressTag : undefined,
    lat: typeof record.lat === "number" ? record.lat : undefined,
    lng: typeof record.lng === "number" ? record.lng : undefined,
    providerIds,
    matchedProviders,
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
  };
}

function getDb() {
  if (db) {
    return db;
  }

  ensureDataDir();
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS last_used_addresses (
      scope_key TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      address_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_last_used_addresses_slug
    ON last_used_addresses(slug);
    CREATE INDEX IF NOT EXISTS idx_last_used_addresses_updated_at
    ON last_used_addresses(updated_at DESC);
  `);

  return db;
}

function readLegacyStore(): LegacyStore {
  try {
    const raw = fs.readFileSync(LEGACY_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const store: LegacyStore = {};
    for (const [slug, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const address = sanitizeResolvedAddress(record.address);
      const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : Date.now();
      if (!address) {
        continue;
      }
      store[normalizeSlug(slug)] = { address, updatedAt };
    }
    return store;
  } catch {
    return {};
  }
}

function migrateLegacyJsonIfNeeded() {
  if (legacyMigrationDone) {
    return;
  }

  legacyMigrationDone = true;
  if (!fs.existsSync(LEGACY_JSON_PATH)) {
    return;
  }

  const legacyStore = readLegacyStore();
  const database = getDb();
  const insert = database.prepare(`
    INSERT INTO last_used_addresses (scope_key, slug, address_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_key) DO NOTHING
  `);

  for (const [slug, entry] of Object.entries(legacyStore)) {
    insert.run(
      slug,
      slug,
      JSON.stringify({
        ...entry.address,
        providerIds: { ...entry.address.providerIds },
        matchedProviders: [...entry.address.matchedProviders],
      }),
      entry.updatedAt,
    );
  }
}

function readByScopeKey(scopeKey: string) {
  migrateLegacyJsonIfNeeded();
  const database = getDb();
  const row = database
    .prepare(
      "SELECT address_json, updated_at FROM last_used_addresses WHERE scope_key = ? LIMIT 1",
    )
    .get(scopeKey) as { address_json?: unknown; updated_at?: unknown } | undefined;

  if (!row || typeof row.address_json !== "string") {
    return null;
  }

  const address = sanitizeResolvedAddress(JSON.parse(row.address_json) as unknown);
  if (!address) {
    return null;
  }

  return {
    address,
    updatedAt: typeof row.updated_at === "number" ? row.updated_at : 0,
  } satisfies PersistedLastUsedAddress;
}

export function getPersistedLastUsedAddress(slug: string, scopeKey?: string | null) {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedScopeKey = normalizeScopeKey(scopeKey);

  if (normalizedScopeKey) {
    const scoped = readByScopeKey(normalizedScopeKey);
    if (scoped) {
      return scoped;
    }

    const legacyScopedToSlug = readByScopeKey(normalizedSlug);
    if (legacyScopedToSlug) {
      setPersistedLastUsedAddress(slug, legacyScopedToSlug.address, normalizedScopeKey);
      return legacyScopedToSlug;
    }
    return null;
  }

  return readByScopeKey(normalizedSlug);
}

export function setPersistedLastUsedAddress(
  slug: string,
  address: ResolvedAddress,
  scopeKey?: string | null,
) {
  migrateLegacyJsonIfNeeded();
  const database = getDb();
  const normalizedSlug = normalizeSlug(slug);
  const normalizedScopeKey = normalizeScopeKey(scopeKey) ?? normalizedSlug;
  const nextState = {
    address: {
      ...address,
      providerIds: { ...address.providerIds },
      matchedProviders: [...address.matchedProviders],
    },
    updatedAt: Date.now(),
  } satisfies PersistedLastUsedAddress;

  database
    .prepare(`
      INSERT INTO last_used_addresses (scope_key, slug, address_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        slug = excluded.slug,
        address_json = excluded.address_json,
        updated_at = excluded.updated_at
    `)
    .run(
      normalizedScopeKey,
      normalizedSlug,
      JSON.stringify(nextState.address),
      nextState.updatedAt,
    );

  return nextState;
}
