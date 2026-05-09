# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Vorel is an AI-powered food and grocery ordering assistant for India. It has two surfaces:

- **`/demo`** — a standalone agentic chat demo (Node + Express, plain HTML/JS) that uses mock providers. Good for iterating on conversation flow without live APIs.
- **`/frontend`** — the real Next.js app that connects to live Swiggy/Zepto MCP servers via OAuth.

Both surfaces share the **`/pipeline`** utilities (ingredient matcher, address store, MCP router).

---

## Commands

### Demo server (fastest way to run locally)
```bash
npm run demo          # starts demo/server.js on port 3000
```
The demo uses mock providers by default — no API keys needed. Open `http://localhost:3000`.

### Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev           # dev server with webpack
npm run build         # production build
npm run lint          # ESLint
```
Requires `.env.local` in `/frontend` with provider credentials (see `.env.example` at root for shape).

### Backend (recipe chat API)
```bash
npm start             # node backend/index.js — Express API on port 3001
npm run build-db      # rebuild dishes.db from source CSVs via backend/scripts/build-db.js
npm run enrich        # pipeline/enricher.js — enriches dish metadata
npm run tag           # pipeline/tagger.js — tags dishes for search
```

### Ingredient matcher tests
```bash
node pipeline/utils/ingredient-matcher/test.js
```
No test framework — prints ✅/❌ per case. Run this after any change to `normalize.js`, `sanitize.js`, `scorer.js`, `aliases.js`, or `prefs.js`.

---

## Architecture

### Request flow (demo mode)
```
User message → demo/server.js → runAgentLoop() → Claude API (tool_use)
    → executeTool() in pipeline/mcp/router.js
    → withFallback(category, provider => provider.method())
    → pipeline/mcp/providers/{swiggy-food,zepto,...}.js (mock or live)
    → result rendered as HTML card in chat UI
```

### Request flow (frontend/Next.js)
```
User message → frontend/components/chat-shell.tsx
    → POST /api/chat/[slug]
    → frontend/app/api/chat/[slug]/route.ts
    → frontend/lib/chat-engine.ts → processChatMessage()
    → frontend/lib/grocery-provider.ts → withClient() → MCP HTTP transport
    → Live provider MCP server (mcp.swiggy.com, mcp.zepto.co.in)
```

The Next.js app connects **directly** to provider MCP servers via `@modelcontextprotocol/client` with OAuth tokens. The `/pipeline` MCP router is used in the demo but not in the Next.js app (which has its own provider abstraction in `frontend/lib/`).

---

## Key Modules

### `pipeline/utils/ingredient-matcher/`
Parses raw user input ("dhania", "2 kg shimla mirch", "usual ones like papaya") into structured, alias-resolved items before any catalog search.

Pipeline order: `normalize` → `sanitize` → `resolveAlias` → `rankProducts`

- **`normalize.js`** — lowercase, unit standardisation (`kgs→kg`), fraction words (`half→0.5`), spelling variants (`cilantro→coriander`)
- **`sanitize.js`** — strips conversational prefixes, extracts qty/unit/form hints, applies generic normalisations (`chocolates→milk chocolate`), splits lists (auto-splits 3+ space-separated words)
- **`aliases.js`** — ~90 Hindi/regional name entries → canonical name + form. Edit this to add new aliases.
- **`prefs.js`** — per-ingredient `prefer[]`/`avoid[]`/`category` used by scorer. Edit this to fix wrong product rankings.
- **`scorer.js`** — scores products by prefer/avoid terms, category, in-stock status, pack size proximity to requested qty
- **`index.js`** — public API: `parseItem()`, `parseList()`, `resolveItem()`, `matchOne()`, `matchAll()`

`parseList()` returns `{ items, info }` where `info` is a human-readable message when input was auto-split (e.g. "Treated as 3 separate items: milk, eggs, butter").

### `pipeline/utils/address-store.js`
Canonical address store with per-provider ID mapping. Solves the problem that Swiggy, Zepto, and Zomato each have opaque address IDs that only work for their own system.

- One canonical address per physical location (our UUID shown to Claude)
- `providerIds: { swiggy: "sw_abc", zepto: "zep_xyz" }` on each canonical record
- **Swiggy does NOT return lat/lng** — only Zepto does. When Zepto syncs, it enriches Swiggy-created canonicals with coordinates.
- Matching strategies (priority order): exact line1 text → token containment (e.g. "B-003 Purva Westend" ↔ "Purva Westend Ground Floor B-003") → proximity 50m → strong Jaccard similarity → moderate similarity + same tag → tag-only when one side has no line1
- Confidence levels: HIGH (auto-merge), MEDIUM/LOW (sets `needsConfirmation: true`, Claude should ask user once)
- `confirmMatch()` / `splitMatch()` persist the user's answer

### `pipeline/mcp/router.js`
Unified tool interface. Exposes 11 `VOREL_TOOLS` to Claude and routes each to the right provider with fallback.

Provider registry uses `providerKey` (not class name) for address ID mapping — `SwiggyFoodProvider` and `SwiggyInstamartProvider` both have `providerKey: 'swiggy'` because they share the same Swiggy account and address namespace.

`list_addresses` fetches from all providers in parallel via `ADDRESS_PROVIDERS` (one entry per account, not per class). `place_order` looks up `canonicalAddr.providerIds[p.providerKey]` inside the `withFallback` callback so each provider uses its own address ID.

`syncAddresses(userId)` should be called fire-and-forget at session start to warm the cache before the user places their first order.

### `frontend/lib/chat-engine.ts`
Session state machine for the Next.js app. Tracks `stage` (collecting-context → recipe-selection → shopping → provider-selection → ordering → tracking). Loads the SQLite dishes catalog and ranks recipes by pantry match, diet compatibility, and time constraints.

### `frontend/lib/grocery-provider.ts`
Factory that creates provider objects connecting to remote MCP servers over HTTP with OAuth. Each provider exposes: `beginAuth()`, `finishAuth()`, `listAddresses()`, `buildCart()`, `placeOrder()`, `trackOrder()`. Token expiry is checked proactively and triggers reauthentication before the MCP call.

### `demo/server.js`
Self-contained agentic loop. Includes extra demo-only tools (`search_recipes`, `get_ingredient_diff`, `get_menu`) not in `VOREL_TOOLS`. Card rendering (recipe cards, cart cards, order tracking) is done by injecting HTML into the assistant message stream. Mock mode is always on in the demo.

---

## Provider Conventions

Each file in `pipeline/mcp/providers/` must implement:
- `isAvailable()` — returns false if required env vars are missing
- `name` — internal identifier (e.g. `'swiggy-food'`)
- `displayName` — shown to users (e.g. `'Swiggy'`)
- `providerKey` — address namespace key: `'swiggy'`, `'zepto'`, or `'zomato'`
- `getAddresses()` — returns `{ addresses: Address[] }` where each address has `{ id, tag, line1, line2, city, pincode, lat?, lng? }`

Zepto prices are in paisa — divide by 100 before returning to Claude.

---

## Data Files

- **`backend/dishes.db`** — SQLite with `dishes` and `dishes_fts` (FTS5) tables. Rebuilt via `npm run build-db`. Required for recipe suggestions.
- **`backend/users/`** — Per-user JSON session files keyed by userId. Stores conversation history and preferences. Created automatically on first chat.

---

## Environment Variables

Root `.env`:
```
ANTHROPIC_API_KEY=
SUPABASE_URL=          # optional, for persistence
SUPABASE_SERVICE_KEY=  # optional
OPENAI_API_KEY=        # optional, for embeddings
SWIGGY_MCP_KEY=
ZEPTO_CLIENT_ID=
ZEPTO_CLIENT_SECRET=
```

`frontend/.env.local` — same keys scoped to the Next.js app, plus `NEXTAUTH_SECRET` and OAuth callback URLs.

Mock mode (demo): set `MOCK_MODE=true` or leave provider keys empty — the mock providers in `pipeline/mcp/mock/data.js` will be used.
