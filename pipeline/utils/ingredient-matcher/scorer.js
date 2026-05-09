/**
 * scorer.js — Step 5: Score and rank catalog products for a resolved ingredient
 *
 * Takes a list of products from the catalog search and ranks them
 * using preference rules + pack size matching.
 *
 * Returns a ranked list with confidence scores (0–1).
 */

import { getPrefs } from './prefs.js'

// ── Weight parsing ────────────────────────────────────────────────────────────

const UNIT_TO_GRAMS = {
  kg: 1000, g: 1, L: 1000, ml: 1,
  pcs: null, bunch: null, pkt: null,   // non-weight units — skip pack matching
}

/**
 * parseWeight(weightString) → { value, unit } | null
 * e.g. "500 g" → { value: 500, unit: 'g' }
 *      "1 kg"  → { value: 1000, unit: 'g' }  (normalised to grams)
 */
function parseWeight(str) {
  if (!str) return null
  const m = str.match(/(\d+(?:\.\d+)?)\s*(kg|g|L|ml|pcs|pkt|bunch)/i)
  if (!m) return null
  const value = parseFloat(m[1])
  const unit  = m[2].toLowerCase()
  const grams = UNIT_TO_GRAMS[unit]
  if (grams === null) return { value, unit, normalised: null }  // non-weight unit
  return { value, unit, normalised: value * grams }
}

/**
 * packSizeScore(product, requestedQty, requestedUnit) → number (0–8)
 *
 * Rewards products whose pack size is close to the requested quantity.
 * e.g. user says "2 kg onions" → prefer 1 kg pack (buy 2) over 200 g pack (buy 10).
 */
function packSizeScore(product, requestedQty, requestedUnit) {
  if (!requestedQty || !requestedUnit) return 0

  const requested = parseWeight(`${requestedQty} ${requestedUnit}`)
  const product_w = parseWeight(product.weight)

  if (!requested?.normalised || !product_w?.normalised) return 0

  // How many packs needed?
  const packsNeeded = requested.normalised / product_w.normalised

  // Ideal: 1–3 packs. Penalise needing many small packs or one oversized pack.
  if (packsNeeded >= 0.9 && packsNeeded <= 1.1) return 8   // near-perfect match
  if (packsNeeded >= 0.5 && packsNeeded <= 2.0) return 5
  if (packsNeeded >= 0.3 && packsNeeded <= 4.0) return 2
  return 0
}

// ── Product scoring ───────────────────────────────────────────────────────────

/**
 * scoreProduct(product, prefs, qty?, unit?) → number
 *
 * Scores a single product against preference rules + pack size.
 * Higher score = better match.
 */
export function scoreProduct(product, prefs, qty = null, unit = null) {
  if (!product) return -Infinity

  const name = (product.name + ' ' + (product.category || '')).toLowerCase()
  let score = 0

  // Prefer terms: +10 per match
  for (const term of (prefs.prefer || [])) {
    if (name.includes(term.toLowerCase())) score += 10
  }

  // Avoid terms: -15 per match (stronger than prefer to ensure hard exclusions)
  for (const term of (prefs.avoid || [])) {
    if (name.includes(term.toLowerCase())) score -= 15
  }

  // Category match bonus
  if (prefs.category && product.category) {
    if (product.category.toLowerCase().includes(prefs.category.toLowerCase())) {
      score += 5
    }
  }

  // In-stock bonus
  if (product.in_stock === true)  score += 3
  if (product.in_stock === false) score -= 50   // strong penalty for OOS

  // Pack size match
  score += packSizeScore(product, qty, unit)

  return score
}

// ── Confidence calculation ────────────────────────────────────────────────────

/**
 * computeConfidence(scores) → number (0–1)
 *
 * Confidence is based on how much better the top result is vs the second.
 * - Large gap → high confidence
 * - Tied scores → low confidence
 */
function computeConfidence(scores) {
  if (!scores.length) return 0
  if (scores.length === 1) return 0.85   // only one result, probably fine

  const [first, second] = scores
  const gap = first - second

  if (gap >= 20) return 0.95   // dominant winner
  if (gap >= 10) return 0.80
  if (gap >= 5)  return 0.65
  if (gap >= 0)  return 0.45   // close race — worth flagging
  return 0.20                  // second scored higher — shouldn't happen but handle it
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * rankProducts(products, resolved) → RankedResult
 *
 * @param products  - Array of products from catalog search
 * @param resolved  - Resolved ingredient: { canonical, form, qty, unit }
 *
 * @returns {
 *   match:        best product | null,
 *   confidence:   0–1,
 *   alternatives: next 2 products,
 *   scores:       debug info (product + score),
 * }
 */
export function rankProducts(products, resolved) {
  if (!products?.length) {
    return { match: null, confidence: 0, alternatives: [], scores: [] }
  }

  const prefs = getPrefs(resolved.canonical, resolved.form)

  // Apply form hints from user input (e.g. user said "fresh coriander")
  // These override the dictionary's prefer/avoid for this query only
  const effectivePrefs = applyFormHints(prefs, resolved.formHints || [])

  const scored = products
    .map(p => ({ product: p, score: scoreProduct(p, effectivePrefs, resolved.qty, resolved.unit) }))
    .sort((a, b) => b.score - a.score)

  const confidence = computeConfidence(scored.map(s => s.score))

  return {
    match:        scored[0]?.product ?? null,
    confidence,
    alternatives: scored.slice(1, 3).map(s => s.product),
    scores:       scored.slice(0, 5).map(s => ({ name: s.product.name, score: s.score })),
  }
}

// ── Form hint override ────────────────────────────────────────────────────────

/**
 * applyFormHints(prefs, formHints) → prefs
 *
 * When the user explicitly says "fresh coriander" or "coriander powder",
 * their explicit form overrides the dictionary default.
 */
function applyFormHints(prefs, formHints) {
  if (!formHints.length) return prefs

  const extraPrefer = []
  const extraAvoid  = []

  if (formHints.includes('fresh')) {
    extraPrefer.push('fresh')
    extraAvoid.push('powder', 'dried', 'ground')
  }
  if (formHints.includes('dried') || formHints.includes('dry')) {
    extraPrefer.push('dried', 'dry')
    extraAvoid.push('fresh')
  }
  if (formHints.includes('powder') || formHints.includes('powdered')) {
    extraPrefer.push('powder', 'ground')
    extraAvoid.push('fresh', 'whole', 'seeds')
  }
  if (formHints.includes('seeds') || formHints.includes('whole')) {
    extraPrefer.push('seeds', 'whole')
    extraAvoid.push('powder', 'ground')
  }
  if (formHints.includes('leaves')) {
    extraPrefer.push('leaves', 'fresh')
    extraAvoid.push('powder', 'seeds')
  }

  return {
    ...prefs,
    prefer: [...new Set([...extraPrefer, ...prefs.prefer])],
    avoid:  [...new Set([...extraAvoid,  ...prefs.avoid])],
  }
}
