import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import type { GroceryProviderId } from "@/lib/grocery-provider";

export type PersistedAuthState = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  encryptedTokens?: string;
  expiresAt?: string;
  delegatedUserId?: string;
  codeVerifier?: string;
  state?: string;
  pendingAuthUrl?: string;
  authorizationServerUrl?: string;
  resourceUrl?: string;
};

type PersistedStore = Partial<
  Record<GroceryProviderId, Record<string, PersistedAuthState>>
>;

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "grocery-auth.json");

let cache: PersistedStore | null = null;
const AUTH_STORE_SECRET = process.env.VOREL_AUTH_STORE_SECRET?.trim() ?? "";

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase();
}

function hasEncryptionSecret() {
  return AUTH_STORE_SECRET.length >= 16;
}

function deriveKey() {
  return crypto.scryptSync(AUTH_STORE_SECRET, "vorel-auth-store", 32);
}

function encryptTokens(tokens: OAuthTokens) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptTokens(payload: string) {
  const parsed = JSON.parse(payload) as {
    iv: string;
    tag: string;
    ciphertext: string;
  };
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as OAuthTokens;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): PersistedStore {
  if (cache) {
    return cache;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    cache = JSON.parse(raw) as PersistedStore;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      cache = {};
    } else {
      cache = {};
    }
  }

  return cache;
}

function writeStore(store: PersistedStore) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  cache = store;
}
export function getPersistedAuthState(
  provider: GroceryProviderId,
  slug: string,
): PersistedAuthState {
  const normalizedSlug = normalizeSlug(slug);
  const store = readStore();
  const state = store[provider]?.[normalizedSlug] ?? {};

  if (state.encryptedTokens && hasEncryptionSecret()) {
    try {
      return {
        ...state,
        tokens: decryptTokens(state.encryptedTokens),
      };
    } catch {
      return state;
    }
  }

  return state;
}

export function savePersistedAuthState(
  provider: GroceryProviderId,
  slug: string,
  state: PersistedAuthState,
) {
  const normalizedSlug = normalizeSlug(slug);
  const store = readStore();
  const nextState = { ...state };

  if (nextState.tokens && hasEncryptionSecret()) {
    nextState.encryptedTokens = encryptTokens(nextState.tokens);
    nextState.tokens = undefined;
  }

  const nextProviderStore = {
    ...(store[provider] ?? {}),
    [normalizedSlug]: nextState,
  };

  writeStore({
    ...store,
    [provider]: nextProviderStore,
  });
}

export function updatePersistedAuthState(
  provider: GroceryProviderId,
  slug: string,
  patch: Partial<PersistedAuthState>,
) {
  const current = getPersistedAuthState(provider, slug);
  savePersistedAuthState(provider, slug, {
    ...current,
    ...patch,
  });
}

export function clearPersistedAuthState(
  provider: GroceryProviderId,
  slug: string,
) {
  const normalizedSlug = normalizeSlug(slug);
  const store = readStore();
  const providerStore = { ...(store[provider] ?? {}) };
  delete providerStore[normalizedSlug];

  writeStore({
    ...store,
    [provider]: providerStore,
  });
}
