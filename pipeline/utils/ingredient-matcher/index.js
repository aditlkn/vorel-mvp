/**
 * ingredient-matcher — Public API
 *
 * Resolves raw ingredient names or shopping list text into matched catalog products.
 * Works across all ordering flows: recipe, shopping list, ad-hoc add.
 *
 * Usage:
 *
 *   import { parseList, resolveItem, matchAll } from './ingredient-matcher/index.js'
 *
 *   // 1. Parse a shopping list into structured items (no catalog needed)
 *   const items = parseList("coriander, 2 kg onions, shimla mirch")
 *   // → [{ name, qty, unit, canonical, form, formHints }, ...]
 *
 *   // 2. Resolve one item against a list of catalog products
 *   const { match, confidence, alternatives } = resolveItem(items[0], products)
 *
 *   // 3. Full pipeline: parse list → search catalog → rank results
 *   const results = await matchAll("coriander, 2 kg onions", searchFn)
 *   // → [{ input, resolved, match, confidence, alternatives }]
 *
 *   // 4. Single ingredient with optional grocery_id hint (recipe flow)
 *   const result = await matchOne({ name: 'coriander', grocery_id: 'groc_x' }, searchFn)
 */

import { normalize }         from './normalize.js'
import { splitList, extractItem } from './sanitize.js'
import { resolveAlias }      from './aliases.js'
import { rankProducts }      from './scorer.js'

// ── Step: parse + resolve alias (no catalog needed) ──────────────────────────

/**
 * parseItem(raw) → ResolvedItem
 *
 * Parses a single item string into a structured, alias-resolved object.
 * Does NOT touch the catalog — pure text processing.
 *
 * Output shape:
 * {
 *   raw:       "shimla mirch",
 *   name:      "shimla mirch",       ← sanitized input name
 *   canonical: "capsicum",           ← resolved canonical name for search
 *   form:      "fresh",              ← preferred product form
 *   formHints: ["fresh"],            ← form hints from user's words
 *   qty:       null,
 *   unit:      null,
 *   note:      null,
 *   brand:     null,
 * }
 */
export function parseItem(raw) {
  const normalized = normalize(raw)
  const extracted  = extractItem(normalized)
  const alias      = resolveAlias(extracted.name)

  return {
    raw,
    ...extracted,
    canonical: alias?.canonical ?? extracted.name,
    form:      alias?.form      ?? null,
  }
}

/**
 * parseList(text) → { items: ResolvedItem[], info: string | null }
 *
 * Parses a comma/newline-separated shopping list into structured items.
 * Handles: Hindi names, qty+unit extraction, form hints, brand detection.
 *
 * When 3+ words arrive with no delimiter, auto-splits on spaces and returns
 * an info message so the caller can tell the user what happened.
 *
 *   parseList("milk, eggs, butter")
 *   → { items: [...], info: null }
 *
 *   parseList("milk eggs butter")
 *   → { items: [milk, eggs, butter], info: "Treated as 3 separate items: milk, eggs, butter" }
 */
export function parseList(text) {
  const normalized               = normalize(text)
  const { parts, autoSplit }     = splitList(normalized)
  const items                    = parts.map(part => parseItem(part))
  const info = autoSplit
    ? `Treated as ${items.length} separate items: ${parts.join(', ')}`
    : null
  return { items, info }
}

// ── Step: rank products for a parsed item ────────────────────────────────────

/**
 * resolveItem(item, products) → MatchResult
 *
 * Given a parsed item and a list of catalog products, picks the best match.
 *
 * @param item      - Output of parseItem()
 * @param products  - Array of products from catalog search
 *
 * @returns {
 *   match:        best product | null,
 *   confidence:   0–1,
 *   alternatives: Product[],
 *   scores:       [{ name, score }],   ← debug/logging
 * }
 */
export function resolveItem(item, products) {
  return rankProducts(products, item)
}

// ── Full pipeline helpers ─────────────────────────────────────────────────────

/**
 * matchOne(ingredient, searchFn) → Promise<FullResult>
 *
 * Single ingredient through the full pipeline.
 * Respects grocery_id hint to skip search when available.
 *
 * @param ingredient  { name, qty?, unit?, grocery_id? }  (from recipe / tool call)
 * @param searchFn    async (query, category) => Product[]
 */
export async function matchOne(ingredient, searchFn) {
  const parsed = parseItem(ingredient.name)

  // Fast path: grocery_id hint provided → direct lookup, skip search
  if (ingredient.grocery_id) {
    const products = await searchFn(ingredient.grocery_id, null, { byId: true })
    if (products?.length) {
      return {
        input:      ingredient.name,
        resolved:   parsed,
        ...resolveItem({ ...parsed, qty: ingredient.qty, unit: ingredient.unit }, products),
        via:        'grocery_id',
      }
    }
    // Hint not found — fall through to search
  }

  // Normal path: search by canonical name + category
  const products = await searchFn(parsed.canonical, parsed.form
    ? null  // let the category filter do the work when form is known
    : null
  )

  return {
    input:    ingredient.name,
    resolved: parsed,
    ...resolveItem({ ...parsed, qty: ingredient.qty, unit: ingredient.unit }, products),
    via:      'search',
  }
}

/**
 * matchAll(input, searchFn) → Promise<FullResult[]>
 *
 * Full pipeline for a shopping list or array of ingredients.
 * All catalog searches run in parallel for minimum latency.
 *
 * @param input     string (shopping list text) | Array<{name, qty?, unit?, grocery_id?}>
 * @param searchFn  async (query, category) => Product[]
 */
export async function matchAll(input, searchFn) {
  let info = null

  const ingredients = typeof input === 'string'
    ? (() => { const { items, info: i } = parseList(input); info = i; return items })()
        .map(p => ({ name: p.raw, _parsed: p }))
    : input

  const results = await Promise.all(
    ingredients.map(ing => matchOne(ing, searchFn))
  )

  return { results, info }
}

// ── Convenience: build search query from parsed item ─────────────────────────

/**
 * buildSearchQuery(item) → { query, category }
 *
 * Derives what to pass to searchProducts() from a parsed item.
 * Useful when you want to do the search yourself rather than via matchAll.
 */
export function buildSearchQuery(item) {
  const parsed = typeof item === 'string' ? parseItem(item) : item
  return {
    query:    parsed.canonical,
    category: parsed.form
      ? formToCategory(parsed.canonical, parsed.form)
      : null,
  }
}

function formToCategory(canonical, form) {
  if (['fresh', 'fresh-leaves'].includes(form)) return 'Vegetables'
  if (['powder', 'seeds', 'whole', 'pods', 'sticks', 'dried-leaves'].includes(form)) return 'Masalas & Spices'
  if (form === 'dried') return 'Dal & Pulses'
  return null
}
