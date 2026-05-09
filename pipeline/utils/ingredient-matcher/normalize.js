/**
 * normalize.js — Step 1: Raw text → consistent lowercase text
 *
 * Pure string transformation. No lookups, no parsing — just makes
 * the text consistent so every downstream step works on the same shape.
 *
 * Input:  "2 Kgs Onions, Half kg Tamatar"
 * Output: "2 kg onion, 0.5 kg tomato"
 */

// ── Unit standardisation ─────────────────────────────────────────────────────

const UNIT_MAP = {
  kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  grams: 'g', gram: 'g', gm: 'g', gms: 'g',
  litre: 'L', liter: 'L', litres: 'L', liters: 'L', lt: 'L', ltr: 'L',
  milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  pieces: 'pcs', piece: 'pcs', pc: 'pcs', nos: 'pcs',
  packets: 'pkt', packet: 'pkt', pkt: 'pkt', pack: 'pkt', packs: 'pkt',
  tablespoon: 'tbsp', tablespoons: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp',
  bunches: 'bunch',
  cups: 'cup',
}

// ── Fraction words → numbers ─────────────────────────────────────────────────

const FRACTION_MAP = {
  'half a':   0.5,
  'a half':   0.5,
  half:       0.5,
  quarter:    0.25,
  'a quarter':0.25,
  one:   1, two:   2, three: 3, four:  4, five:  5,
  six:   6, seven: 7, eight: 8, nine:  9, ten:   10,
}

// ── Spelling variants → canonical English ───────────────────────────────────
// Only English spelling variants here.
// Hindi/regional aliases live in aliases.js.

const SPELLING_MAP = {
  'chili':        'chilli',
  'chile':        'chilli',
  'chiles':       'chilli',
  'chilies':      'chilli',
  'cilantro':     'coriander',
  'bell pepper':  'capsicum',
  'bell peppers': 'capsicum',
  'eggplant':     'brinjal',
  'aubergine':    'brinjal',
  'zucchini':     'courgette',
  'scallion':     'spring onion',
  'scallions':    'spring onion',
  'green onion':  'spring onion',
  'green onions': 'spring onion',
  'lady finger':  'okra',
  'ladyfinger':   'okra',
  'ladies finger':'okra',
  'groundnut':    'peanut',
  'groundnuts':   'peanuts',
  'curd':         'curd',   // keep — Swiggy uses "curd" not "yogurt"
  'yogurt':       'curd',
  'yoghurt':      'curd',
  'corn flour':   'cornflour',
  'corn starch':  'cornflour',
}

// ── Simple depluralization ───────────────────────────────────────────────────
// Only runs on the ingredient name token, not the whole input.

const IRREGULAR_PLURALS = {
  tomatoes: 'tomato', potatoes: 'potato', mangoes: 'mango',
  avocados: 'avocado', onions: 'onion', lemons: 'lemon',
  limes: 'lime', oranges: 'orange', eggs: 'egg', leaves: 'leaf',
}

export function depluralize(word) {
  const w = word.toLowerCase().trim()
  if (IRREGULAR_PLURALS[w]) return IRREGULAR_PLURALS[w]
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('ses') || w.endsWith('xes') || w.endsWith('zes')) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1)
  return w
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * normalize(text) → string
 *
 * Applies all transformations in order:
 *   lowercase → fractions → spelling variants → units
 *
 * Does NOT split into items — that's sanitize.js.
 */
export function normalize(text) {
  if (!text || typeof text !== 'string') return ''
  let t = text.toLowerCase().trim()

  // Fraction words → numbers (longest match first to avoid partial replacement)
  const fractionEntries = Object.entries(FRACTION_MAP).sort((a, b) => b[0].length - a[0].length)
  for (const [word, val] of fractionEntries) {
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), String(val))
  }

  // Spelling variants (longest match first for "bell peppers" before "pepper")
  const spellingEntries = Object.entries(SPELLING_MAP).sort((a, b) => b[0].length - a[0].length)
  for (const [variant, canonical] of spellingEntries) {
    t = t.replace(new RegExp(`\\b${variant}\\b`, 'gi'), canonical)
  }

  // Unit aliases
  for (const [alias, canonical] of Object.entries(UNIT_MAP)) {
    t = t.replace(new RegExp(`\\b${alias}\\b`, 'g'), canonical)
  }

  return t
}
