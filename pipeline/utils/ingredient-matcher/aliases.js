/**
 * aliases.js — Step 3a: Regional/Hindi names → canonical English + form
 *
 * The canonical name is what we search the product catalog with.
 * The form tells the scorer which product type to prefer.
 *
 * Forms used in this file:
 *   fresh          → whole fresh produce (no further qualifier)
 *   fresh-leaves   → fresh herb/leaf form (coriander, methi, curry leaves)
 *   dried-leaves   → dried leaf form (kasuri methi)
 *   powder         → ground/powdered form
 *   seeds          → whole seeds
 *   whole          → whole, unprocessed (applies to spices)
 *   dried          → dried/shelf-stable form (legumes, beans)
 *   pods           → pod form (cardamom)
 *   sticks         → stick form (cinnamon)
 *   null           → no strong form preference — let scorer decide
 */

export const ALIASES = {

  // ── Vegetables ─────────────────────────────────────────────────────────────

  dhania:          { canonical: 'coriander',    form: 'fresh-leaves' },
  'hara dhania':   { canonical: 'coriander',    form: 'fresh-leaves' },
  kothamalli:      { canonical: 'coriander',    form: 'fresh-leaves' }, // Tamil
  kothambari:      { canonical: 'coriander',    form: 'fresh-leaves' }, // Kannada
  palak:           { canonical: 'spinach',      form: 'fresh' },
  'shimla mirch':  { canonical: 'capsicum',     form: 'fresh' },
  'shimla mirchi': { canonical: 'capsicum',     form: 'fresh' },
  'lal shimla mirch': { canonical: 'red capsicum', form: 'fresh' },
  'hari shimla mirch': { canonical: 'capsicum', form: 'fresh' },
  aloo:            { canonical: 'potato',       form: 'fresh' },
  alu:             { canonical: 'potato',       form: 'fresh' },
  tamatar:         { canonical: 'tomato',       form: 'fresh' },
  tamater:         { canonical: 'tomato',       form: 'fresh' },
  pyaaz:           { canonical: 'onion',        form: 'fresh' },
  pyaz:            { canonical: 'onion',        form: 'fresh' },
  piaz:            { canonical: 'onion',        form: 'fresh' },
  adrak:           { canonical: 'ginger',       form: 'fresh' },
  lahsun:          { canonical: 'garlic',       form: 'fresh' },
  lasun:           { canonical: 'garlic',       form: 'fresh' },
  lasoon:          { canonical: 'garlic',       form: 'fresh' },
  gobhi:           { canonical: 'cauliflower',  form: 'fresh' },
  'phool gobhi':   { canonical: 'cauliflower',  form: 'fresh' },
  'fulgobi':       { canonical: 'cauliflower',  form: 'fresh' },
  'band gobhi':    { canonical: 'cabbage',      form: 'fresh' },
  'patta gobhi':   { canonical: 'cabbage',      form: 'fresh' },
  gajar:           { canonical: 'carrot',       form: 'fresh' },
  matar:           { canonical: 'peas',         form: 'fresh' },
  'hari matar':    { canonical: 'green peas',   form: 'fresh' },
  bhindi:          { canonical: 'okra',         form: 'fresh' },
  'lady finger':   { canonical: 'okra',         form: 'fresh' },
  baingan:         { canonical: 'brinjal',      form: 'fresh' },
  baigan:          { canonical: 'brinjal',      form: 'fresh' },
  'tori':          { canonical: 'ridge gourd',  form: 'fresh' },
  'turai':         { canonical: 'ridge gourd',  form: 'fresh' },
  'lauki':         { canonical: 'bottle gourd', form: 'fresh' },
  'ghiya':         { canonical: 'bottle gourd', form: 'fresh' },
  'karela':        { canonical: 'bitter gourd', form: 'fresh' },
  'arbi':          { canonical: 'taro root',    form: 'fresh' },
  'kachalu':       { canonical: 'taro root',    form: 'fresh' },
  shakarkand:      { canonical: 'sweet potato', form: 'fresh' },
  methi:           { canonical: 'fenugreek',    form: 'fresh-leaves' },  // methi alone = fresh sabzi
  'methi leaves':  { canonical: 'fenugreek',    form: 'fresh-leaves' },
  'kasuri methi':  { canonical: 'kasuri methi', form: 'dried-leaves' },  // compound — own SKU
  'kasoori methi': { canonical: 'kasuri methi', form: 'dried-leaves' },
  'meethi neem':   { canonical: 'curry leaves', form: 'fresh' },
  'kari patta':    { canonical: 'curry leaves', form: 'fresh' },
  'curry patta':   { canonical: 'curry leaves', form: 'fresh' },
  'karhi patta':   { canonical: 'curry leaves', form: 'fresh' },
  pudina:          { canonical: 'mint',         form: 'fresh-leaves' },
  'pudina leaves': { canonical: 'mint',         form: 'fresh-leaves' },

  // ── Spices (where name implies form) ───────────────────────────────────────

  jeera:           { canonical: 'cumin',        form: 'seeds' },    // jeera = seeds
  zeera:           { canonical: 'cumin',        form: 'seeds' },
  'jeera powder':  { canonical: 'cumin',        form: 'powder' },
  haldi:           { canonical: 'turmeric',     form: 'powder' },   // haldi = always powder
  'haldi powder':  { canonical: 'turmeric',     form: 'powder' },
  hing:            { canonical: 'asafoetida',   form: null },
  heeng:           { canonical: 'asafoetida',   form: null },
  'lal mirch':     { canonical: 'red chilli',   form: 'powder' },   // lal mirch = spice
  'lal mirchi':    { canonical: 'red chilli',   form: 'powder' },
  'hari mirch':    { canonical: 'green chilli', form: 'fresh' },    // hari mirch = fresh
  'hari mirchi':   { canonical: 'green chilli', form: 'fresh' },
  sarson:          { canonical: 'mustard seeds',form: 'seeds' },
  rai:             { canonical: 'mustard seeds',form: 'seeds' },
  'sarson seeds':  { canonical: 'mustard seeds',form: 'seeds' },
  ajwain:          { canonical: 'carom seeds',  form: 'seeds' },
  'ajwain seeds':  { canonical: 'carom seeds',  form: 'seeds' },
  kalonji:         { canonical: 'nigella seeds',form: 'seeds' },
  elaichi:         { canonical: 'cardamom',     form: 'pods' },
  ilaychi:         { canonical: 'cardamom',     form: 'pods' },
  'badi elaichi':  { canonical: 'black cardamom', form: 'pods' },
  dalchini:        { canonical: 'cinnamon',     form: 'sticks' },
  laung:           { canonical: 'cloves',       form: 'whole' },
  lavang:          { canonical: 'cloves',       form: 'whole' },
  javitri:         { canonical: 'mace',         form: 'whole' },
  jaiphal:         { canonical: 'nutmeg',       form: 'whole' },
  'kali mirch':    { canonical: 'black pepper', form: 'seeds' },
  'sabut dhania':  { canonical: 'coriander',    form: 'seeds' },
  'dhania powder': { canonical: 'coriander',    form: 'powder' },
  'garam masala':  { canonical: 'garam masala', form: null },       // compound spice blend

  // ── Dairy & Eggs ───────────────────────────────────────────────────────────

  dahi:            { canonical: 'curd',         form: null },
  ghee:            { canonical: 'ghee',         form: null },
  paneer:          { canonical: 'paneer',        form: null },
  malai:           { canonical: 'cream',         form: null },
  makkhan:         { canonical: 'butter',        form: null },

  // ── Grains, Flours & Staples ───────────────────────────────────────────────

  maida:           { canonical: 'refined flour', form: null },
  besan:           { canonical: 'gram flour',    form: null },
  atta:            { canonical: 'wheat flour',   form: null },
  'gehun atta':    { canonical: 'wheat flour',   form: null },
  sooji:           { canonical: 'semolina',      form: null },
  suji:            { canonical: 'semolina',      form: null },
  rava:            { canonical: 'semolina',      form: null },  // South Indian term
  chawal:          { canonical: 'rice',          form: null },
  basmati:         { canonical: 'basmati rice',  form: null },
  poha:            { canonical: 'flattened rice', form: null },

  // ── Lentils & Legumes ──────────────────────────────────────────────────────

  'moong dal':     { canonical: 'moong dal',     form: 'dried' },
  moong:           { canonical: 'moong dal',     form: 'dried' },
  'masoor dal':    { canonical: 'masoor dal',    form: 'dried' },
  masoor:          { canonical: 'masoor dal',    form: 'dried' },
  'toor dal':      { canonical: 'toor dal',      form: 'dried' },
  'arhar dal':     { canonical: 'toor dal',      form: 'dried' },
  'chana dal':     { canonical: 'chana dal',     form: 'dried' },
  'urad dal':      { canonical: 'urad dal',      form: 'dried' },
  rajma:           { canonical: 'kidney beans',  form: 'dried' },
  chole:           { canonical: 'chickpeas',     form: 'dried' },
  'kabuli chana':  { canonical: 'chickpeas',     form: 'dried' },
  chana:           { canonical: 'chickpeas',     form: 'dried' },
  'kala chana':    { canonical: 'black chickpeas', form: 'dried' },

  // ── Sweeteners & Misc ──────────────────────────────────────────────────────

  namak:           { canonical: 'salt',          form: null },
  cheeni:          { canonical: 'sugar',         form: null },
  shakkar:         { canonical: 'sugar',         form: null },
  gur:             { canonical: 'jaggery',       form: null },
  gud:             { canonical: 'jaggery',       form: null },
  tel:             { canonical: 'oil',           form: null },
  'sarson ka tel': { canonical: 'mustard oil',   form: null },
  imli:            { canonical: 'tamarind',      form: null },
  kesar:           { canonical: 'saffron',       form: null },
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * resolveAlias(name) → { canonical, form } | null
 *
 * Looks up the ingredient name (already normalized/lowercased) in the alias table.
 * Returns null if no alias found — caller uses the name as-is.
 *
 * Multi-word aliases are checked before single-word ones to avoid
 * "kasuri methi" matching "methi" first.
 */
export function resolveAlias(name) {
  const n = name.toLowerCase().trim()

  // Try exact match first
  if (ALIASES[n]) return ALIASES[n]

  // Try with any leading/trailing noise removed
  // (sanitize.js should handle this, but belt-and-suspenders)
  for (const [key, value] of Object.entries(ALIASES)) {
    if (n.includes(key)) return value
  }

  return null
}
