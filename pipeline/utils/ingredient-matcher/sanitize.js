/**
 * sanitize.js — Step 2: Normalized text → structured item tokens
 *
 * Takes normalized text (already lowercased + units standardised) and
 * splits it into individual items, extracting quantity, unit, notes,
 * and form hints from each.
 *
 * Input:  "2 kg onion, 0.5 kg tomato, coriander (for garnish)"
 * Output: [
 *   { name: "onion",     qty: 2,   unit: "kg",  note: null,          formHint: null },
 *   { name: "tomato",    qty: 0.5, unit: "kg",  note: null,          formHint: null },
 *   { name: "coriander", qty: null, unit: null, note: "for garnish", formHint: null },
 * ]
 */

import { depluralize } from './normalize.js'

// ── Conversational prefix patterns ───────────────────────────────────────────
// Stripped before any item parsing so they never reach the provider query.
// Order matters: longer/more specific phrases must come before shorter ones.
//
// "usual ones like papaya"   → "papaya"
// "some chocolates"          → "chocolates"  (then GENERIC_NORMALIZATIONS kicks in)
// "just milk"                → "milk"
// "the regular ones"         → ""            (empty → caller treats as vague)

const CONVERSATIONAL_PREFIXES = [
  // "usual ones like X" → "X"  |  "the usual ones like" → "" (nothing after = vague)
  /^(?:the usual ones? like)\s*/i,
  /^(?:usual ones? like)\s*/i,
  /^(?:the regular ones? like)\s*/i,
  /^(?:regular ones? like)\s*/i,
  /^(?:something like)\s*/i,
  /^(?:anything like)\s*/i,
  /^(?:things like)\s*/i,
  /^(?:stuff like)\s*/i,
  // bare vague phrases with nothing useful after
  /^(?:the usual ones?)\s*/i,
  /^(?:usual ones?)\s*/i,
  /^(?:the regular ones?)\s*/i,
  /^(?:regular ones?)\s*/i,
  // action verbs + single-word fillers
  /^(?:restock|replenish|top up)\s+/i,
  /^(?:maybe|just|some|any)\s+/i,
  /^(?:like|the|a|an)\s+/i,
]

// ── Generic term normalisations ───────────────────────────────────────────────
// Vague colloquial terms → canonical product type before alias resolution.
// These handle the gap between how people talk and how products are named.
// Ported from intent-parser.ts GENERIC_ITEM_NORMALIZATIONS.
//
// "chocolates"  → "milk chocolate"   (default form, not dark/white)
// "cold drinks" → "cola soft drink"
// "chips"       → "potato chips"     (most common in Indian context)

const GENERIC_NORMALIZATIONS = [
  { pattern: /^regular chips$|^salted chips$|^classic chips$/i, canonical: 'salted potato chips' },
  { pattern: /^chips$/i,                                        canonical: 'potato chips' },
  { pattern: /^cold drinks?$|^soft drinks?$/i,                  canonical: 'cola soft drink' },
  { pattern: /^chocolates?$/i,                                  canonical: 'milk chocolate' },
  { pattern: /^regular cola$|^cola$/i,                          canonical: 'cola soft drink' },
  { pattern: /^biscuits?$/i,                                    canonical: 'glucose biscuits' },
  { pattern: /^namkeen$|^snacks?$/i,                            canonical: 'salted snacks' },
  { pattern: /^juices?$/i,                                      canonical: 'mixed fruit juice' },
  { pattern: /^noodles?$/i,                                     canonical: 'instant noodles' },
  { pattern: /^bread$/i,                                        canonical: 'white sandwich bread' },
]

// ── Noise words (per-token cleanup) ─────────────────────────────────────────
// Words that carry no product meaning and should be stripped from the name.
// Note: "fresh", "dried", "whole", "ground" are NOT here — they're form hints.
const NOISE_WORDS = [
  'a little', 'little', 'bit of', 'few', 'handful of', 'handful',
  'please', 'need', 'want', 'get', 'buy', 'add',
  'organic', 'good quality', 'nice',  // subjective — not a product attribute
]

// Words that hint at the form (fresh/dried/powder/etc.) — preserved in result
const FORM_HINT_WORDS = [
  'fresh', 'dried', 'dry', 'whole', 'ground', 'powdered', 'powder',
  'frozen', 'canned', 'tinned', 'raw', 'roasted',
  'leaves', 'seeds', 'pods', 'sticks', 'root',
]

// Compound items that should NOT be split on "and"
const COMPOUND_ITEMS = new Set([
  'ginger garlic paste', 'ginger-garlic paste',
  'salt and pepper', 'salt pepper',
  'bread and butter',
  'macaroni and cheese',
])

// Supported units for qty+unit extraction
const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'bunch', 'cup', 'tbsp', 'tsp', 'pkt', 'dozen']
const UNIT_PATTERN = UNITS.join('|')
const QTY_RE = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})?\\s*(?:of\\s+)?`, 'i')

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractParenthetical(text) {
  const match = text.match(/\(([^)]+)\)/)
  if (!match) return { text, note: null }
  return {
    text: text.replace(/\([^)]+\)/g, '').trim(),
    note: match[1].trim(),
  }
}

function extractQtyUnit(text) {
  const match = text.match(QTY_RE)
  if (!match) return { qty: null, unit: null, remaining: text }
  return {
    qty:       parseFloat(match[1]),
    unit:      match[2] || null,
    remaining: text.slice(match[0].length).trim(),
  }
}

function extractFormHints(text) {
  const found = []
  let remaining = text
  for (const hint of FORM_HINT_WORDS) {
    const re = new RegExp(`\\b${hint}\\b`, 'gi')
    if (re.test(remaining)) {
      found.push(hint)
      remaining = remaining.replace(re, '').trim()
    }
  }
  // Collapse multiple spaces
  remaining = remaining.replace(/\s+/g, ' ').trim()
  return { formHints: found, remaining }
}

/**
 * stripConversationalPrefix(text) → string
 *
 * Removes filler phrases that precede the actual item name.
 * Runs before quantity/form extraction so they don't confuse the parser.
 *
 *   "usual ones like papaya"  → "papaya"
 *   "some cold drinks"        → "cold drinks"
 *   "just milk"               → "milk"
 *   "the regular ones"        → ""   (vague — no item, caller should skip)
 */
export function stripConversationalPrefix(text) {
  let t = text.trim()
  for (const re of CONVERSATIONAL_PREFIXES) {
    t = t.replace(re, '')
  }
  return t.trim()
}

/**
 * applyGenericNormalization(text) → string
 *
 * Maps vague colloquial terms to a more specific canonical form.
 * Runs after prefix stripping, before alias resolution.
 *
 *   "chocolates"  → "milk chocolate"
 *   "cold drinks" → "cola soft drink"
 *   "chips"       → "potato chips"
 */
export function applyGenericNormalization(text) {
  const t = text.trim().toLowerCase()
  for (const { pattern, canonical } of GENERIC_NORMALIZATIONS) {
    if (pattern.test(t)) return canonical
  }
  return text
}

function stripNoise(text) {
  let t = text
  for (const noise of NOISE_WORDS) {
    t = t.replace(new RegExp(`^${noise}\\s+`, 'i'), '')
  }
  return t.trim()
}

function extractBrand(text) {
  // Detect "BrandName ProductName" patterns for known brands
  // Simple heuristic: capitalised word at start that isn't a form hint
  // e.g. "Amul butter" → brand=Amul, name=butter
  const knownBrands = [
    'amul', 'britannia', 'mdh', 'everest', 'tata', 'aashirvaad', 'india gate',
    'fortune', 'saffola', 'dabur', 'haldirams', 'nestle', 'licious', 'fresho',
    'mother dairy', 'organic tattva', 'patanjali',
  ]
  for (const brand of knownBrands) {
    if (text.toLowerCase().startsWith(brand + ' ')) {
      return { brand, name: text.slice(brand.length).trim() }
    }
  }
  return { brand: null, name: text }
}

// ── Main exports ─────────────────────────────────────────────────────────────

/**
 * splitList(text) → { parts: string[], autoSplit: boolean }
 *
 * Splits a shopping list into individual item strings.
 * - Comma/newline/semicolon → standard split
 * - 3+ words with no delimiter → auto-split on spaces, caller gets informed
 * - 1–2 words with no delimiter → single item (likely a product name)
 *
 * Compound items (e.g. "ginger garlic paste") are protected in all paths.
 */
export function splitList(text) {
  // Protect known compound items before any splitting
  let t = text
  for (const compound of COMPOUND_ITEMS) {
    t = t.replace(new RegExp(compound, 'gi'), compound.replace(/ /g, '§'))
  }

  const restore = s => s.replace(/§/g, ' ').trim()

  // Has a real delimiter — standard path
  if (/[,\n;]/.test(t)) {
    return {
      parts:     t.split(/[,\n;]/).map(restore).filter(Boolean),
      autoSplit: false,
    }
  }

  // No delimiter — check word count (after compound protection)
  const words = t.trim().split(/\s+/).filter(Boolean)

  // 1–2 words: treat as a single product name
  if (words.length <= 2) {
    return { parts: [text.trim()], autoSplit: false }
  }

  // 3+ words: auto-split on spaces, preserving protected compounds
  return {
    parts:     words.map(restore).filter(Boolean),
    autoSplit: true,
  }
}

/**
 * extractItem(rawText) → StructuredItem
 *
 * Parses one item string (already normalized) into:
 * { name, qty, unit, note, formHints, brand }
 */
export function extractItem(rawText) {
  let text = rawText.trim()

  // 1. Strip conversational prefixes before anything else
  //    "usual ones like papaya" → "papaya"
  //    "some cold drinks"       → "cold drinks"
  text = stripConversationalPrefix(text)

  // 2. Extract parenthetical notes
  const { text: noNote, note } = extractParenthetical(text)
  text = noNote

  // 3. Extract qty + unit
  const { qty, unit, remaining: afterQty } = extractQtyUnit(text)
  text = afterQty

  // 4. Extract form hints (fresh/dried/etc.) before stripping noise
  const { formHints, remaining: afterHints } = extractFormHints(text)
  text = afterHints

  // 5. Strip noise words
  text = stripNoise(text)

  // 6. Apply generic normalisations — vague terms → specific product type
  //    "chocolates" → "milk chocolate", "chips" → "potato chips"
  const normalized = applyGenericNormalization(text)
  const wasNormalized = normalized !== text
  text = normalized

  // 7. Extract brand if present
  const { brand, name: nameWithPlural } = extractBrand(text)

  // 8. Depluralize — skip if normalization already set the canonical form
  //    (depluralize("potato chips") → "potato chip" which breaks the canonical)
  const name = wasNormalized ? nameWithPlural : depluralize(nameWithPlural)

  return {
    name:      name || rawText.trim(),   // fallback to raw if we stripped everything
    qty:       qty,
    unit:      unit,
    note:      note,
    formHints: formHints,
    brand:     brand,
  }
}
