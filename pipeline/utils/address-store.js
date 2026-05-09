/**
 * address-store.js — Canonical address store with per-provider ID mapping
 *
 * Problem: Swiggy, Zepto, and Zomato each have their own opaque address IDs.
 * Swiggy's "sw_addr_abc" means nothing to Zepto — and if an order falls back
 * from Swiggy to Zepto, we need Zepto's ID, not Swiggy's.
 *
 * Solution: One canonical address per physical location (our ID), with a
 * providerIds map hanging off it. place_order always uses the right ID for
 * whichever provider ends up handling the order.
 *
 * Schema (one record):
 * {
 *   id:          string,          ← our UUID (shown to Claude)
 *   userId:      string,
 *   tag:         string,          ← "Home" | "Work" | "Other" | custom label
 *   line1:       string,          ← flat / building
 *   line2:       string,          ← street / area
 *   city:        string,
 *   pincode:     string,
 *   lat:         number,
 *   lng:         number,
 *   isDefault:   boolean,
 *   providerIds: {                ← sparse — only present if synced from that provider
 *     swiggy?:   string,
 *     zepto?:    string,
 *     zomato?:   string,
 *   },
 * }
 *
 * Persistence note:
 * Currently in-memory (Map). To persist, replace the Map with DB reads/writes
 * in saveAddresses() and getAddresses() — the rest of the API is unchanged.
 * Recommended schema: addresses(id, user_id, tag, line1, line2, city, pincode,
 * lat, lng, is_default, provider_ids JSONB).
 */

import { randomUUID } from 'crypto'

// userId → CanonicalAddress[]
const store = new Map()

// ── Address matching ──────────────────────────────────────────────────────────
//
// Provider coordinate availability varies:
//   Swiggy  — does NOT return lat/lng
//   Zepto   — returns lat/lng
//
// Because Swiggy has no coords, proximity matching never fires for Swiggy
// addresses. Strategies 2 and 3 are the primary match path.
//
// Match priority:
//  1. Proximity    — lat/lng within 50 m (Zepto↔Zepto or future providers)
//  2. Pincode+tag  — same pincode + same normalised tag (Home/Work)
//  3. Pincode+line — same pincode + normalised line1 Jaccard similarity ≥ 0.6
//
// When a match is found, the canonical record is enriched with lat/lng from
// the incoming address if the canonical doesn't already have coords. This means
// a Swiggy-created canonical picks up Zepto's coordinates on the next sync,
// enabling coordinate-based fallback for Zepto orders.
//
// If a canonical address ends up with no lat/lng at all (Zepto never synced
// that address), resolveProviderAddressId returns addressId: null and
// fallbackCoords: null — the caller must handle this case explicitly.

const MATCH_RADIUS_KM = 0.05  // 50 m

function haversineKm(lat1, lng1, lat2, lng2) {
  const R  = 6371
  const dL = (lat2 - lat1) * Math.PI / 180
  const dG = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(dL / 2) ** 2
           + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
           * Math.sin(dG / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Common address abbreviations — expanded before any comparison so
// "Apts" and "Apartments" score as identical tokens.
const ABBR = {
  'apts': 'apartments', 'apt': 'apartment',
  'bldg': 'building',   'blvd': 'boulevard',
  'ave':  'avenue',     'rd':   'road',
  'st':   'street',     'ln':   'lane',
  'dr':   'drive',      'flr':  'floor',
  'no':   'number',     'nr':   'near',
  'opp':  'opposite',   'nxt':  'next to',
  'soc':  'society',    'nagar':'nagar',
}

function expandAbbreviations(s) {
  return s.split(/\s+/).map(w => ABBR[w] ?? w).join(' ')
}

// For exact match: lowercase + expand abbreviations + strip punctuation, preserve word order
function normaliseLineExact(s = '') {
  return expandAbbreviations(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  )
}

// For Jaccard similarity: sort words so "Tower B Flat 4A" ≈ "Flat 4A Tower B"
function normaliseLine(s = '') {
  return normaliseLineExact(s).split(' ').sort().join(' ')
}

function normaliseTag(s = '') {
  return s.toLowerCase().trim()
}

// Jaccard similarity on word tokens — 0 (nothing in common) to 1 (identical)
function jaccardSimilarity(a, b) {
  const sa = new Set(a.split(' ').filter(Boolean))
  const sb = new Set(b.split(' ').filter(Boolean))
  const intersection = [...sa].filter(t => sb.has(t)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * isContained(a, b) → boolean
 *
 * Returns true if every token in the shorter string appears in the longer.
 * Catches "B-003, Purva Westend" vs "Purva Westend, Ground Floor, B-003" —
 * the first is a subset of the second; extra tokens (floor, ground) are just
 * additional context, not a different address.
 */
function isContained(a, b) {
  const sa = new Set(a.split(' ').filter(Boolean))
  const sb = new Set(b.split(' ').filter(Boolean))
  const aInB = [...sa].every(t => sb.has(t))
  const bInA = [...sb].every(t => sa.has(t))
  return aInB || bInA
}

/**
 * unitTokens(normalisedLine) → Set<string>
 *
 * Extracts tokens that look like flat/block/unit identifiers:
 * short (≤ 5 chars), alphanumeric, containing at least one digit.
 * e.g. "a001", "b003", "4a", "101", "g4" — but not "floor", "tower", "purva".
 */
function unitTokens(line) {
  return new Set(
    line.split(' ').filter(t => t.length <= 5 && /\d/.test(t) && /[a-z]/.test(t) || /^\d+$/.test(t))
  )
}

/**
 * hasConflictingUnitIds(lineA, lineB) → boolean
 *
 * Returns true when both addresses have unit-identifier tokens and none
 * of them overlap — meaning they're clearly different units in the same
 * complex. "A-001 Purva Westend" vs "B-003 Purva Westend": a001 ≠ b003.
 * "B-003 Purva Westend" vs "Purva Westend Ground Floor B-003": b003 = b003,
 * so no conflict.
 */
function hasConflictingUnitIds(lineA, lineB) {
  const ua = unitTokens(lineA)
  const ub = unitTokens(lineB)
  if (!ua.size || !ub.size) return false          // one side has no unit ID — can't tell
  const overlap = [...ua].some(t => ub.has(t))
  return !overlap                                  // both have IDs but none match → conflict
}

// Match confidence levels — determines whether Claude surfaces a confirmation prompt
export const MATCH_CONFIDENCE = {
  HIGH:   'high',    // lat/lng proximity — auto-merge, no prompt needed
  MEDIUM: 'medium',  // pincode + tag AND pincode + line1 both agree — likely correct
  LOW:    'low',     // only one heuristic matched — show separately, ask user
}

/**
 * findCanonical(addresses, providerAddr) → { canonical, confidence } | null
 *
 * Tries the three matching strategies in order, returning the best match
 * along with a confidence level.
 *
 * HIGH   — lat/lng within 50 m (Zepto only; Swiggy never returns coords)
 * MEDIUM — pincode+tag AND pincode+line1 both agree
 * LOW    — only pincode+tag OR only pincode+line1 matched (not both)
 *
 * Returns null if no strategy matches → genuinely new address.
 */
function findCanonical(addresses, pa) {
  // ── HIGH confidence ─────────────────────────────────────────────────────────

  // Identical line1 + same pincode — tag is irrelevant, the address text is definitive.
  // Catches "Home" (Swiggy) vs "New Home" (Zepto) at the same flat.
  if (pa.pincode && pa.line1) {
    const paLine = normaliseLineExact(pa.line1)
    const exact  = addresses.find(
      a => a.pincode === pa.pincode && a.line1 && normaliseLineExact(a.line1) === paLine
    )
    if (exact) return { canonical: exact, confidence: MATCH_CONFIDENCE.HIGH }
  }

  // Containment + same pincode — one address is a subset of the other.
  // Catches "B-003, Purva Westend" vs "Purva Westend, Ground Floor, B-003":
  // all tokens of the shorter appear in the longer; extra tokens (floor,
  // landmark) are additional context, not a different address.
  //
  // Guard: shorter side must have ≥ 3 tokens so a bare complex name like
  // "Purva Westend" (2 tokens) doesn't absorb every flat in the complex.
  if (pa.pincode && pa.line1) {
    const paLine  = normaliseLine(pa.line1)
    const paTokens = paLine.split(' ').filter(Boolean)
    const contained = addresses.find(a => {
      if (!a.pincode || a.pincode !== pa.pincode || !a.line1) return false
      const aLine   = normaliseLine(a.line1)
      const aTokens = aLine.split(' ').filter(Boolean)
      const shorter = paTokens.length <= aTokens.length ? paTokens : aTokens
      if (shorter.length < 3) return false            // too vague — skip
      return isContained(aLine, paLine)
    })
    if (contained) return { canonical: contained, confidence: MATCH_CONFIDENCE.HIGH }
  }

  // Proximity — both sides have coords and are within 50 m.
  // Zepto↔Zomato, or any future provider that returns lat/lng.
  if (pa.lat && pa.lng) {
    const match = addresses.find(
      a => a.lat && a.lng && haversineKm(a.lat, a.lng, pa.lat, pa.lng) <= MATCH_RADIUS_KM
    )
    if (match) return { canonical: match, confidence: MATCH_CONFIDENCE.HIGH }
  }

  // ── MEDIUM confidence ───────────────────────────────────────────────────────

  if (pa.pincode && pa.line1) {
    const paLineSorted = normaliseLine(pa.line1)

    // Strong line1 similarity (≥0.8) + same pincode.
    // Tag may differ — "My Flat" vs "Home" for the same address.
    // Note: exact-token-set matches (Jaccard=1.0) are caught earlier by
    // containment as HIGH, so this only fires for near-but-not-identical text.
    const strongLine = addresses.find(
      a => a.pincode === pa.pincode
        && a.line1
        && jaccardSimilarity(normaliseLine(a.line1), paLineSorted) >= 0.8
    )
    if (strongLine) return { canonical: strongLine, confidence: MATCH_CONFIDENCE.MEDIUM }

    // Moderate line1 similarity (≥0.6) AND same tag + pincode.
    // Both signals agree on the same canonical.
    if (pa.tag) {
      const moderateLine = addresses.find(
        a => a.pincode === pa.pincode
          && normaliseTag(a.tag) === normaliseTag(pa.tag)
          && a.line1
          && jaccardSimilarity(normaliseLine(a.line1), paLineSorted) >= 0.6
      )
      if (moderateLine) return { canonical: moderateLine, confidence: MATCH_CONFIDENCE.MEDIUM }
    }
  }

  // ── LOW confidence ──────────────────────────────────────────────────────────

  // Tag + pincode match, but only when at least one side is missing line1.
  //
  // When both sides have line1 and neither HIGH nor MEDIUM fired, the lines
  // are different enough to be separate addresses — "A-001 Purva Westend" vs
  // "B-003 Purva Westend" would score 0.5 Jaccard (shared complex name) but
  // are clearly different flats. No threshold is safe here; splitting and
  // letting the user see two addresses is more correct than a wrong merge.
  //
  // When one side has no line1 at all (provider didn't return it), we can't
  // compare — LOW fires so the user is prompted to confirm once.
  if (pa.pincode && pa.tag) {
    const tagOnly = addresses.find(
      a => a.pincode === pa.pincode && normaliseTag(a.tag) === normaliseTag(pa.tag)
    )
    if (tagOnly && !(pa.line1 && tagOnly.line1)) {
      return { canonical: tagOnly, confidence: MATCH_CONFIDENCE.LOW }
    }
  }

  return null
}

// ── Core sync ─────────────────────────────────────────────────────────────────

/**
 * mergeProviderAddresses(userId, providerName, providerAddresses)
 *
 * Called once per provider after fetching their address list.
 * Merges each provider address into the canonical store:
 *   - If a canonical address exists within 50 m → add/update providerIds[providerName]
 *   - Otherwise → create a new canonical address with this provider's ID
 *
 * @param providerName  'swiggy' | 'zepto' | 'zomato'
 * @param providerAddresses  Array of addresses returned by the provider
 *   Each must have: { id, tag?, line1?, line2?, city?, pincode?, lat?, lng? }
 */
export function mergeProviderAddresses(userId, providerName, providerAddresses) {
  const existing = store.get(userId) ?? []

  for (const pa of providerAddresses) {
    const result = findCanonical(existing, pa)
    if (result) {
      const { canonical, confidence } = result
      // Known location — add this provider's ID
      canonical.providerIds[providerName] = pa.id
      // Enrich coords from providers that return them (Zepto), Swiggy never does
      if (!canonical.lat && pa.lat) canonical.lat = pa.lat
      if (!canonical.lng && pa.lng) canonical.lng = pa.lng
      // Flag for user confirmation if we're not certain it's the same address.
      // Once the user confirms (confirmMatch), this flag is cleared permanently.
      if (confidence !== MATCH_CONFIDENCE.HIGH && !canonical.userConfirmed) {
        canonical.needsConfirmation = true
        canonical.matchConfidence   = confidence
      }
    } else {
      // New location — create canonical record
      existing.push({
        id:               randomUUID(),
        userId,
        tag:              pa.tag     ?? 'Other',
        line1:            pa.line1   ?? '',
        line2:            pa.line2   ?? '',
        city:             pa.city    ?? '',
        pincode:          pa.pincode ?? '',
        lat:              pa.lat     ?? null,
        lng:              pa.lng     ?? null,
        isDefault:        false,
        providerIds:      { [providerName]: pa.id },
        needsConfirmation: false,
        userConfirmed:    false,
        matchConfidence:  null,
      })
    }
  }

  store.set(userId, existing)
}

// ── Read API ──────────────────────────────────────────────────────────────────

export function getAddresses(userId) {
  return store.get(userId) ?? []
}

export function hasAddresses(userId) {
  return (store.get(userId)?.length ?? 0) > 0
}

/**
 * getDefault(userId) → CanonicalAddress | null
 *
 * Priority: explicit default → Home tag → Work tag → first in list.
 */
export function getDefault(userId) {
  const addresses = store.get(userId)
  if (!addresses?.length) return null

  const explicit = addresses.find(a => a.isDefault)
  if (explicit) return explicit

  return (
    addresses.find(a => a.tag?.toLowerCase() === 'home') ??
    addresses.find(a => a.tag?.toLowerCase() === 'work') ??
    addresses[0]
  )
}

/**
 * resolveProviderAddressId(userId, providerName) → Resolution | null
 *
 * Returns how to pass the delivery address to a specific provider.
 *
 * {
 *   addressId:      string | null   ← provider's own saved-address ID (preferred)
 *   fallbackCoords: {lat,lng} | null ← coordinate fallback when addressId is null
 *                                      null when Swiggy-only address, Zepto never synced
 *   canFulfil:      boolean          ← false if neither ID nor coords are available
 *   canonicalAddr:  CanonicalAddress
 * }
 *
 * Returns null if no address on file at all (list_addresses not yet called).
 */
export function resolveProviderAddressId(userId, providerName) {
  const addr = getDefault(userId)
  if (!addr) return null

  const addressId      = addr.providerIds?.[providerName] ?? null
  const fallbackCoords = addr.lat && addr.lng ? { lat: addr.lat, lng: addr.lng } : null

  return {
    addressId,
    fallbackCoords,
    canFulfil:    addressId !== null || fallbackCoords !== null,
    canonicalAddr: addr,
  }
}

// ── Write API ─────────────────────────────────────────────────────────────────

/**
 * setDefault(userId, canonicalAddressId) → boolean
 * Marks one canonical address as the default; clears isDefault on all others.
 */
export function setDefault(userId, canonicalAddressId) {
  const addresses = store.get(userId)
  if (!addresses) return false
  const target = addresses.find(a => a.id === canonicalAddressId)
  if (!target) return false
  for (const a of addresses) a.isDefault = (a.id === canonicalAddressId)
  return true
}

/**
 * confirmMatch(userId, canonicalAddressId)
 *
 * Call when the user explicitly confirms that a merged address is correct
 * (e.g. "yes, that's my home address on both apps").
 * Clears needsConfirmation so the prompt never fires again.
 */
export function confirmMatch(userId, canonicalAddressId) {
  const addresses = store.get(userId)
  if (!addresses) return false
  const addr = addresses.find(a => a.id === canonicalAddressId)
  if (!addr) return false
  addr.userConfirmed    = true
  addr.needsConfirmation = false
  return true
}

/**
 * splitMatch(userId, canonicalAddressId, providerName)
 *
 * Call when the user says "no, that's a different address" for a merged record.
 * Removes the provider ID from the canonical and creates a new separate canonical.
 */
export function splitMatch(userId, canonicalAddressId, providerName) {
  const addresses = store.get(userId)
  if (!addresses) return false
  const canonical = addresses.find(a => a.id === canonicalAddressId)
  if (!canonical || !canonical.providerIds[providerName]) return false

  const providerId = canonical.providerIds[providerName]
  delete canonical.providerIds[providerName]
  canonical.needsConfirmation = false
  canonical.userConfirmed     = true

  // Create a new standalone canonical for this provider's address
  addresses.push({
    id:               randomUUID(),
    userId,
    tag:              canonical.tag,
    line1:            canonical.line1,
    line2:            canonical.line2,
    city:             canonical.city,
    pincode:          canonical.pincode,
    lat:              null,
    lng:              null,
    isDefault:        false,
    providerIds:      { [providerName]: providerId },
    needsConfirmation: false,
    userConfirmed:    true,
    matchConfidence:  null,
  })
  return true
}

export function clearAddresses(userId) {
  store.delete(userId)
}
