/**
 * prefs.js — Per-ingredient product preference rules
 *
 * Encodes the domain knowledge: when a user says "coriander" in an Indian
 * household context, what product attributes should we prefer or avoid?
 *
 * Structure per entry:
 *   prefer[]        → score +10 per match in product name
 *   avoid[]         → score -15 per match in product name
 *   category        → pass to catalog search to narrow results
 *   default_pack    → preferred pack size when qty not specified
 *                     'smallest' | '500g' | '1kg' | '1L' | etc.
 *   form_prefs      → overrides prefer/avoid when a specific form is known
 *
 * Keys are canonical ingredient names (output of aliases.js).
 */

export const INGREDIENT_PREFS = {

  // ── Vegetables ─────────────────────────────────────────────────────────────

  coriander: {
    prefer:       ['fresh', 'leaves', 'dhania', 'bunch', 'hara'],
    avoid:        ['powder', 'seeds', 'dried', 'ground', 'coriander seed'],
    category:     'Vegetables',
    default_pack: 'smallest',
    form_prefs: {
      'fresh-leaves': { prefer: ['fresh', 'leaves', 'bunch'], avoid: ['powder', 'seeds'] },
      'seeds':        { prefer: ['seeds', 'whole', 'sabut'],  avoid: ['powder', 'leaves'] },
      'powder':       { prefer: ['powder', 'ground'],         avoid: ['fresh', 'leaves', 'seeds'] },
    },
  },

  tomato: {
    prefer:       [],
    avoid:        ['cherry', 'sun-dried', 'paste', 'puree', 'sauce', 'ketchup',
                   'crush', 'canned', 'tinned', 'chopped', 'diced'],
    category:     'Vegetables',
    default_pack: '500g',
  },

  onion: {
    prefer:       ['red', 'nasik'],
    avoid:        ['spring', 'powder', 'flakes', 'fried', 'paste', 'pearl',
                   'shallot', 'green', 'barista'],
    category:     'Vegetables',
    default_pack: '1kg',
  },

  potato: {
    prefer:       [],
    avoid:        ['powder', 'flakes', 'chips', 'wafers', 'fries', 'wedges',
                   'baby', 'sweet'],
    category:     'Vegetables',
    default_pack: '1kg',
  },

  ginger: {
    prefer:       ['fresh', 'root'],
    avoid:        ['powder', 'paste', 'dried', 'pickled', 'candy'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  garlic: {
    prefer:       ['fresh', 'whole', 'bulb'],
    avoid:        ['powder', 'paste', 'dried', 'flakes', 'minced', 'pickled'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  'green chilli': {
    prefer:       ['green', 'fresh', 'hari'],
    avoid:        ['powder', 'sauce', 'paste', 'dried', 'flakes', 'pickle', 'red'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  spinach: {
    prefer:       ['fresh', 'palak', 'baby'],
    avoid:        ['frozen', 'canned', 'powder', 'puree'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  capsicum: {
    prefer:       ['green'],  // default to green unless colour specified
    avoid:        ['powder', 'roasted', 'pickled', 'sauce'],
    category:     'Vegetables',
    default_pack: 'smallest',
    form_prefs: {
      fresh: {
        prefer_color: ['green'],  // signal to caller to prefer green if no color specified
      },
    },
  },

  'curry leaves': {
    prefer:       ['fresh', 'kari', 'meethi neem'],
    avoid:        ['dried', 'powder', 'frozen'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  fenugreek: {
    prefer:       ['fresh', 'methi', 'leaves'],
    avoid:        ['seeds', 'powder', 'dried', 'kasuri'],
    category:     'Vegetables',
    default_pack: 'smallest',
    form_prefs: {
      'fresh-leaves': { prefer: ['fresh', 'leaves', 'methi'],   avoid: ['seeds', 'kasuri', 'dried'] },
      'dried-leaves': { prefer: ['kasuri', 'kasoori', 'dried'], avoid: ['fresh', 'seeds'] },
      'seeds':        { prefer: ['seeds', 'whole', 'methi'],    avoid: ['leaves', 'kasuri'] },
    },
  },

  'kasuri methi': {
    // Treated as its own canonical product — not just a form of fenugreek
    prefer:       ['kasuri', 'kasoori', 'dried'],
    avoid:        ['fresh', 'seeds'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  mint: {
    prefer:       ['fresh', 'pudina', 'leaves'],
    avoid:        ['dried', 'powder', 'sauce', 'extract', 'flavour'],
    category:     'Vegetables',
    default_pack: 'smallest',
  },

  // ── Spices ─────────────────────────────────────────────────────────────────

  cumin: {
    prefer:       ['seeds', 'whole', 'jeera'],
    avoid:        ['powder', 'ground'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
    form_prefs: {
      seeds:   { prefer: ['seeds', 'whole', 'jeera'], avoid: ['powder', 'ground'] },
      powder:  { prefer: ['powder', 'ground'],        avoid: ['seeds', 'whole'] },
    },
  },

  turmeric: {
    prefer:       ['powder', 'haldi'],
    avoid:        ['fresh', 'root', 'raw'],  // turmeric root exists but isn't what people mean
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  'red chilli': {
    prefer:       ['powder', 'lal', 'mirch'],
    avoid:        ['whole', 'dried', 'sauce', 'paste', 'fresh', 'green', 'flakes'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
    form_prefs: {
      powder: { prefer: ['powder', 'ground'], avoid: ['whole', 'dried'] },
      whole:  { prefer: ['whole', 'dried'],   avoid: ['powder', 'ground'] },
    },
  },

  'mustard seeds': {
    prefer:       ['seeds', 'whole', 'rai', 'sarson'],
    avoid:        ['oil', 'powder', 'paste', 'sauce'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  asafoetida: {
    prefer:       ['hing', 'heeng', 'asafoetida'],
    avoid:        [],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  cardamom: {
    prefer:       ['pods', 'elaichi', 'green'],
    avoid:        ['powder', 'black', 'oil'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
    form_prefs: {
      pods:  { prefer: ['pods', 'whole', 'green'],  avoid: ['powder', 'black'] },
      powder:{ prefer: ['powder', 'ground'],        avoid: ['pods', 'whole'] },
    },
  },

  cinnamon: {
    prefer:       ['sticks', 'dalchini'],
    avoid:        ['powder', 'ground', 'oil'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  cloves: {
    prefer:       ['whole', 'laung'],
    avoid:        ['powder', 'ground', 'oil'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  'black pepper': {
    prefer:       ['whole', 'seeds', 'kali mirch'],
    avoid:        ['sauce', 'oil'],
    category:     'Masalas & Spices',
    default_pack: 'smallest',
    form_prefs: {
      seeds:  { prefer: ['whole', 'seeds'], avoid: ['powder', 'ground'] },
      powder: { prefer: ['powder', 'ground', 'crushed'], avoid: ['whole', 'seeds'] },
    },
  },

  'garam masala': {
    prefer:       ['garam masala', 'whole spice'],
    avoid:        ['chaat', 'pav bhaji', 'biryani'],  // flavoured variants
    category:     'Masalas & Spices',
    default_pack: 'smallest',
  },

  // ── Dairy ──────────────────────────────────────────────────────────────────

  paneer: {
    prefer:       ['fresh', 'amul', 'block'],
    avoid:        ['frozen', 'crumbled', 'processed', 'smoked'],
    category:     'Dairy',
    default_pack: '200g',
  },

  curd: {
    prefer:       ['dahi', 'masti', 'natural'],
    avoid:        ['flavoured', 'fruit', 'greek', 'hung'],
    category:     'Dairy',
    default_pack: '400g',
  },

  ghee: {
    prefer:       ['pure', 'desi', 'cow'],
    avoid:        ['vanaspati', 'dalda'],
    category:     'Dairy',
    default_pack: '500ml',
  },

  butter: {
    prefer:       ['salted', 'unsalted', 'table'],
    avoid:        ['peanut', 'almond', 'cocoa', 'compound', 'vegan'],
    category:     'Dairy',
    default_pack: '100g',
  },

  cream: {
    prefer:       ['fresh', 'amul', 'cooking'],
    avoid:        ['whipping', 'sour', 'ice cream', 'non-dairy', 'coconut'],
    category:     'Dairy',
    default_pack: '200ml',
  },

  milk: {
    prefer:       ['toned', 'full fat', 'amul', 'mother dairy'],
    avoid:        ['condensed', 'evaporated', 'flavoured', 'soy', 'oat', 'almond',
                   'coconut', 'powder'],
    category:     'Dairy',
    default_pack: '1L',
  },

  // ── Staples ────────────────────────────────────────────────────────────────

  'wheat flour': {
    prefer:       ['atta', 'whole wheat', 'chakki'],
    avoid:        ['refined', 'maida', 'self-raising'],
    category:     'Atta & Flours',
    default_pack: '1kg',
  },

  'refined flour': {
    prefer:       ['maida', 'refined', 'all purpose'],
    avoid:        ['whole wheat', 'atta', 'self-raising'],
    category:     'Atta & Flours',
    default_pack: '500g',
  },

  'gram flour': {
    prefer:       ['besan', 'gram'],
    avoid:        [],
    category:     'Atta & Flours',
    default_pack: '500g',
  },

  oil: {
    prefer:       ['refined', 'sunflower', 'vegetable'],
    avoid:        ['mustard', 'coconut', 'olive', 'sesame', 'palm', 'essential'],
    category:     'Oils & Ghee',
    default_pack: '1L',
  },

  salt: {
    prefer:       ['iodised', 'table', 'tata'],
    avoid:        ['pink', 'rock', 'himalayan', 'black', 'sea'],
    category:     'Masalas & Spices',
    default_pack: '1kg',
  },

  sugar: {
    prefer:       ['white', 'refined', 'crystal'],
    avoid:        ['brown', 'raw', 'powdered', 'icing', 'cane', 'coconut'],
    category:     'Sugar & Sweeteners',
    default_pack: '1kg',
  },

  rice: {
    prefer:       ['basmati', 'sona masoori'],
    avoid:        ['brown', 'flattened', 'puffed', 'parboiled', 'red', 'black'],
    category:     'Rice & Grains',
    default_pack: '1kg',
  },

  'basmati rice': {
    prefer:       ['basmati', 'aged', 'extra long'],
    avoid:        ['brown', 'quick cook'],
    category:     'Rice & Grains',
    default_pack: '1kg',
  },

  eggs: {
    prefer:       ['farm fresh', 'country', 'brown'],
    avoid:        ['liquid', 'powdered', 'pasteurised'],
    category:     'Eggs',
    default_pack: '6 pcs',
  },

  // ── Meat ───────────────────────────────────────────────────────────────────

  chicken: {
    prefer:       ['curry cut', 'fresh', 'whole'],
    avoid:        ['frozen', 'nuggets', 'strips', 'wings', 'processed', 'smoked',
                   'sausage', 'salami', 'canned'],
    category:     'Meat & Seafood',
    default_pack: '500g',
  },

  mutton: {
    prefer:       ['curry cut', 'fresh'],
    avoid:        ['frozen', 'keema', 'mince', 'processed'],
    category:     'Meat & Seafood',
    default_pack: '500g',
  },
}

/**
 * getPrefs(canonical, form) → prefs object
 *
 * Returns the preference object for a canonical ingredient name.
 * If a specific form is known, merges the form-specific overrides.
 * Falls back to a neutral prefs object if canonical not found.
 */
export function getPrefs(canonical, form = null) {
  const base = INGREDIENT_PREFS[canonical?.toLowerCase()]

  if (!base) {
    // Unknown ingredient — return neutral prefs (category guess from name)
    return { prefer: [], avoid: [], category: null, default_pack: null }
  }

  if (form && base.form_prefs?.[form]) {
    // Merge base with form-specific override
    return {
      ...base,
      prefer: base.form_prefs[form].prefer ?? base.prefer,
      avoid:  base.form_prefs[form].avoid  ?? base.avoid,
    }
  }

  return base
}
