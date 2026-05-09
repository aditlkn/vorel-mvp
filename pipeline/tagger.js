/**
 * tagger.js — Cron 3: Deterministic extraction → LLM gap-fill → embedding
 *
 * Usage:  node pipeline/tagger.js
 *         node pipeline/tagger.js --limit 500
 *
 * What it does per recipe:
 *   A. Run deterministic extraction script (regex + keyword matching)
 *   B. Compute confidence score (0.0–1.0)
 *   C. Route:
 *       ≥ 0.7  → script result used directly, no LLM
 *       ≥ 0.4  → LLM fills only the failed fields (partial)
 *       < 0.4  → full LLM extraction
 *   D. Generate embedding via OpenAI text-embedding-3-small
 *   E. Update recipe in Supabase
 *   F. Clear transcript (extracted — no longer needed)
 *   G. Set status='active'
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(__rootDir, '.env'), override: true })

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ── Config ─────────────────────────────────────────────────────────────────
const BATCH_SIZE         = 100   // recipes fetched from DB per loop
const LLM_BATCH_FULL     = 20    // recipes per full-LLM call
const LLM_BATCH_PARTIAL  = 5     // recipes per partial-LLM call (more context per recipe)
const EMBED_BATCH        = 100   // texts per OpenAI embedding call

const limitArg = process.argv.indexOf('--limit')
const RUN_LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : Infinity

// ── Clients ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ══════════════════════════════════════════════════════════════════════════════
//  Extraction Constants
// ══════════════════════════════════════════════════════════════════════════════

const MEAT_KEYWORDS = [
  'chicken', 'mutton', 'lamb', 'beef', 'pork', 'fish', 'prawn',
  'shrimp', 'crab', 'lobster', 'tuna', 'salmon', 'keema', 'gosht',
  'murg', 'murgh', 'machli', 'jhinga', 'non-veg', 'nonveg', 'meat',
  'bacon', 'ham', 'sausage',
]

const EGG_KEYWORDS = ['egg', 'eggs', 'anda', 'ande']

const DAIRY_FREE_SIGNALS = [
  'dairy free', 'dairy-free', 'no milk', 'no dairy', 'vegan',
  'plant based', 'plant-based',
]

const GLUTEN_FREE_SIGNALS = [
  'gluten free', 'gluten-free', 'no wheat', 'no maida', 'no atta',
]

const JAIN_SIGNALS = [
  'jain', 'no onion no garlic', 'without onion', 'without garlic',
  'no onion', 'no garlic', 'onion garlic free', 'jain recipe',
  'jain style', 'sattvic', 'no root vegetable',
]

const VEGAN_SIGNALS = [
  'vegan', 'plant based', 'plant-based', 'no dairy', 'dairy free',
  'no milk no butter', 'no animal',
]

const CUISINE_MAP = {
  north_indian:    ['punjabi', 'north indian', 'delhi', 'butter chicken',
                    'dal makhani', 'chole', 'rajma', 'paratha', 'naan',
                    'kadai', 'dhaba', 'amritsari', 'lahori'],
  south_indian:    ['south indian', 'tamil', 'kerala', 'andhra', 'dosa',
                    'idli', 'sambar', 'rasam', 'appam', 'uttapam', 'vada',
                    'telugu', 'kannada', 'chettinad', 'udupi'],
  mughlai:         ['mughlai', 'biryani', 'korma', 'haleem', 'nihari',
                    'kebab', 'shahi', 'nawabi', 'lucknow', 'hyderabadi', 'dum'],
  gujarati:        ['gujarati', 'dhokla', 'thepla', 'khandvi', 'fafda',
                    'undhiyu', 'gujarat', 'khakhra', 'sev'],
  bengali:         ['bengali', 'mishti doi', 'rasgulla', 'hilsa',
                    'mustard oil', 'shorshe', 'bengal', 'kolkata'],
  street_food:     ['chaat', 'pani puri', 'bhel', 'vada pav', 'pav bhaji',
                    'frankie', 'kathi roll', 'dabeli', 'samosa', 'aloo tikki'],
  indo_chinese:    ['indo chinese', 'manchurian', 'fried rice', 'noodles',
                    'hakka', 'chilli', 'schezwan', 'momos', 'spring roll'],
  maharashtrian:   ['maharashtrian', 'maharashtra', 'misal', 'puran poli',
                    'vada', 'modak', 'kolhapuri', 'sabudana'],
  rajasthani:      ['rajasthani', 'rajasthan', 'dal baati', 'laal maas',
                    'gatte', 'ker sangri', 'churma'],
  italian:         ['pasta', 'pizza', 'risotto', 'lasagna', 'pesto',
                    'carbonara', 'aglio', 'alfredo', 'italian'],
  chinese:         ['chinese', 'dim sum', 'wonton', 'kung pao',
                    'szechuan', 'fried rice', 'stir fry'],
}

const TIME_PATTERNS = [
  /ready in (\d+)\s*min/i,
  /takes? (\d+)\s*min/i,
  /(\d+)[- ]minute recipe/i,
  /under (\d+)\s*min/i,
  /only (\d+)\s*min/i,
  /just (\d+)\s*min/i,
  /in (\d+)\s*min(?:ute)?s?/i,
  /(\d+)\s*min(?:ute)?s? (?:to )?(?:make|cook|prepare|ready)/i,
  /cook(?:ing)? time[:\s]+(\d+)/i,
  /prep(?:aration)? time[:\s]+(\d+)/i,
  /total time[:\s]+(\d+)/i,
  /active time[:\s]+(\d+)/i,
  /(\d+)\s*मिनट/,
  /(\d+)-?MINUTE/i,
]

const INGREDIENT_DB = {
  // Proteins
  chicken:         { category: 'protein',   is_staple: false },
  mutton:          { category: 'protein',   is_staple: false },
  lamb:            { category: 'protein',   is_staple: false },
  fish:            { category: 'protein',   is_staple: false },
  prawn:           { category: 'protein',   is_staple: false },
  paneer:          { category: 'dairy',     is_staple: false },
  tofu:            { category: 'protein',   is_staple: false },
  dal:             { category: 'legume',    is_staple: true  },
  chana:           { category: 'legume',    is_staple: true  },
  rajma:           { category: 'legume',    is_staple: true  },
  moong:           { category: 'legume',    is_staple: true  },
  lentil:          { category: 'legume',    is_staple: true  },
  // Grains
  rice:            { category: 'grain',     is_staple: true  },
  atta:            { category: 'grain',     is_staple: true  },
  maida:           { category: 'grain',     is_staple: true  },
  sooji:           { category: 'grain',     is_staple: true  },
  poha:            { category: 'grain',     is_staple: true  },
  oats:            { category: 'grain',     is_staple: true  },
  bread:           { category: 'grain',     is_staple: true  },
  pasta:           { category: 'grain',     is_staple: false },
  noodle:          { category: 'grain',     is_staple: false },
  // Fats
  oil:             { category: 'fat',       is_staple: true  },
  ghee:            { category: 'fat',       is_staple: true  },
  butter:          { category: 'dairy',     is_staple: true  },
  // Vegetables
  onion:           { category: 'vegetable', is_staple: true  },
  tomato:          { category: 'vegetable', is_staple: true  },
  potato:          { category: 'vegetable', is_staple: true  },
  spinach:         { category: 'vegetable', is_staple: false },
  cauliflower:     { category: 'vegetable', is_staple: false },
  capsicum:        { category: 'vegetable', is_staple: false },
  peas:            { category: 'vegetable', is_staple: true  },
  mushroom:        { category: 'vegetable', is_staple: false },
  corn:            { category: 'vegetable', is_staple: false },
  carrot:          { category: 'vegetable', is_staple: false },
  cabbage:         { category: 'vegetable', is_staple: false },
  broccoli:        { category: 'vegetable', is_staple: false },
  eggplant:        { category: 'vegetable', is_staple: false },
  // Dairy
  curd:            { category: 'dairy',     is_staple: true  },
  yogurt:          { category: 'dairy',     is_staple: true  },
  milk:            { category: 'dairy',     is_staple: true  },
  cream:           { category: 'dairy',     is_staple: false },
  cheese:          { category: 'dairy',     is_staple: false },
  // Spices (all staples)
  cumin:           { category: 'spice',     is_staple: true  },
  coriander:       { category: 'spice',     is_staple: true  },
  turmeric:        { category: 'spice',     is_staple: true  },
  chilli:          { category: 'spice',     is_staple: true  },
  chili:           { category: 'spice',     is_staple: true  },
  'garam masala':  { category: 'spice',     is_staple: true  },
  mustard:         { category: 'spice',     is_staple: true  },
  ginger:          { category: 'spice',     is_staple: true  },
  garlic:          { category: 'spice',     is_staple: true  },
  cardamom:        { category: 'spice',     is_staple: true  },
  cinnamon:        { category: 'spice',     is_staple: true  },
  clove:           { category: 'spice',     is_staple: true  },
  pepper:          { category: 'spice',     is_staple: true  },
  saffron:         { category: 'spice',     is_staple: false },
  // Other
  sugar:           { category: 'sweetener', is_staple: true  },
  salt:            { category: 'seasoning', is_staple: true  },
  lemon:           { category: 'fruit',     is_staple: true  },
  coconut:         { category: 'fruit',     is_staple: false },
  mango:           { category: 'fruit',     is_staple: false },
}

const DIFFICULTY_EASY_SIGNALS    = ['easy', 'simple', 'quick', 'beginner', '5 ingredient', '3 ingredient']
const DIFFICULTY_HARD_SIGNALS    = ['restaurant style', 'chef special', 'advanced', 'complex', 'authentic']
const MEAL_TYPE_SIGNALS = {
  breakfast: ['breakfast', 'morning', 'nashta', 'नाश्ता'],
  dessert:   ['dessert', 'sweet', 'mithai', 'halwa', 'kheer', 'ladoo', 'barfi', 'cake'],
  soup:      ['soup', 'shorba', 'rasam', 'broth'],
  drinks:    ['juice', 'smoothie', 'drink', 'beverage', 'lassi', 'chai', 'coffee', 'tea', 'sherbet'],
  snacks:    ['snack', 'starter', 'appetizer', 'chaat', 'samosa', 'pakora', 'tikki', 'sandwich'],
  biryani:   ['biryani', 'pulao'],
}

// ══════════════════════════════════════════════════════════════════════════════
//  Step A — Deterministic Extraction Script
// ══════════════════════════════════════════════════════════════════════════════

function extractFromScript(recipe) {
  // Combine all text sources, weighted by reliability
  const title       = (recipe.name || '').toLowerCase()
  const desc        = (recipe.description || '').toLowerCase()
  const transcript  = (recipe.transcript || '').toLowerCase()
  const combined    = `${title} ${desc} ${transcript}`

  const result = {
    // Fields extracted by script (null = not found)
    active_minutes:    null,
    cook_minutes:      null,
    is_vegetarian:     null,
    is_vegan:          null,
    is_jain:           null,
    is_gluten_free:    null,
    is_dairy_free:     null,
    contains_egg:      null,
    contains_meat:     null,
    contains_onion:    null,
    contains_garlic:   null,
    contains_nuts:     null,
    cuisine:           [],
    course:            null,
    difficulty:        null,
    ingredients:       [],
    tags:              [],
    // confidence per field (null = not attempted, true = found, false = not found)
    _confidence: {},
  }

  // ── Time extraction ──────────────────────────────────────────────────────
  // Try title first (most reliable), then description
  let timeMinutes = null
  for (const source of [title, desc.slice(0, 500)]) {
    for (const pattern of TIME_PATTERNS) {
      const m = source.match(pattern)
      if (m) {
        const mins = parseInt(m[1])
        if (mins >= 1 && mins <= 240) {  // sanity: 1 min to 4 hours
          timeMinutes = mins
          break
        }
      }
    }
    if (timeMinutes) break
  }
  // Fallback: derive from video duration if nothing found
  if (!timeMinutes && recipe.duration_seconds) {
    const videoMins = Math.round(recipe.duration_seconds / 60)
    // Video duration ≈ 1.5× active cooking time for recipe videos
    timeMinutes = Math.round(videoMins * 0.7)
  }
  if (timeMinutes) {
    result.active_minutes = timeMinutes
    result.cook_minutes   = timeMinutes
  }
  result._confidence.active_minutes = timeMinutes !== null

  // ── Dietary flags ────────────────────────────────────────────────────────
  const hasMeat = MEAT_KEYWORDS.some(k => combined.includes(k))
  const hasEgg  = EGG_KEYWORDS.some(k => combined.includes(k))
  result.contains_meat   = hasMeat
  result.contains_egg    = hasEgg
  result.contains_onion  = combined.includes('onion')
  result.contains_garlic = combined.includes('garlic')
  result.contains_nuts   = combined.includes('nut') || combined.includes('cashew')
    || combined.includes('almond') || combined.includes('peanut')
    || combined.includes('walnut') || combined.includes('pistachio')
  result.is_vegetarian   = !hasMeat && !hasEgg ? true : (hasMeat ? false : null)
  result.contains_egg    = hasEgg
  result.is_vegan        = VEGAN_SIGNALS.some(s => combined.includes(s))
    ? true
    : (hasMeat || hasEgg ? false : null)
  result.is_jain         = JAIN_SIGNALS.some(s => combined.includes(s))
  result.is_gluten_free  = GLUTEN_FREE_SIGNALS.some(s => combined.includes(s))
  result.is_dairy_free   = DAIRY_FREE_SIGNALS.some(s => combined.includes(s))

  // If jain → no onion/garlic by definition
  if (result.is_jain) {
    result.contains_onion  = false
    result.contains_garlic = false
  }

  result._confidence.dietary = true  // always extracted (may be wrong, but we tried)

  // ── Cuisine detection ────────────────────────────────────────────────────
  const cuisines = []
  for (const [cuisine, keywords] of Object.entries(CUISINE_MAP)) {
    if (keywords.some(k => combined.includes(k))) {
      cuisines.push(cuisine)
    }
  }
  result.cuisine = cuisines
  result._confidence.cuisine = cuisines.length > 0

  // ── Course / meal type ───────────────────────────────────────────────────
  for (const [course, signals] of Object.entries(MEAL_TYPE_SIGNALS)) {
    if (signals.some(s => combined.includes(s))) {
      result.course = course
      break
    }
  }
  if (!result.course) {
    result.course = 'main'  // default
  }
  result._confidence.course = true

  // ── Difficulty ───────────────────────────────────────────────────────────
  if (DIFFICULTY_EASY_SIGNALS.some(s => combined.includes(s))) {
    result.difficulty = 'easy'
  } else if (DIFFICULTY_HARD_SIGNALS.some(s => combined.includes(s))) {
    result.difficulty = 'hard'
  } else if (timeMinutes && timeMinutes <= 20) {
    result.difficulty = 'easy'
  } else if (timeMinutes && timeMinutes > 60) {
    result.difficulty = 'medium'
  } else {
    result.difficulty = 'medium'  // safe default
  }
  result._confidence.difficulty = true

  // ── Ingredient extraction ─────────────────────────────────────────────────
  const foundIngredients = []
  for (const [name, meta] of Object.entries(INGREDIENT_DB)) {
    if (combined.includes(name)) {
      foundIngredients.push({ name, ...meta, substitutes: [] })
    }
  }
  result.ingredients = foundIngredients
  result._confidence.ingredients = foundIngredients.length >= 3

  // ── Tags ─────────────────────────────────────────────────────────────────
  const tags = []
  if (result.is_jain)                         tags.push('jain')
  if (result.is_vegan)                        tags.push('vegan')
  if (result.is_vegetarian && !hasEgg)        tags.push('veg')
  if (!result.is_vegetarian && hasMeat)       tags.push('non-veg')
  if (hasEgg && !hasMeat)                     tags.push('egg')
  if (result.active_minutes && result.active_minutes <= 20) tags.push('quick')
  if (result.is_gluten_free)                  tags.push('gluten-free')
  if (result.is_dairy_free)                   tags.push('dairy-free')
  if (result.course === 'breakfast')          tags.push('breakfast')
  if (result.course === 'dessert')            tags.push('dessert')
  if (result.course === 'snacks')             tags.push('snacks')
  if (result.course === 'soup')               tags.push('soup')
  if (result.course === 'drinks')             tags.push('drinks')
  if (cuisines.includes('street_food'))       tags.push('street-food')
  if (cuisines.includes('mughlai'))           tags.push('biryani')
  if (foundIngredients.some(i => i.name === 'rice')) tags.push('rice')
  if (foundIngredients.some(i => i.name === 'dal'))  tags.push('dal')
  if (foundIngredients.some(i => ['pasta','noodle'].includes(i.name))) tags.push('pasta')

  result.tags = [...new Set(tags)]  // dedupe

  return result
}

// ══════════════════════════════════════════════════════════════════════════════
//  Step B — Confidence Scoring
// ══════════════════════════════════════════════════════════════════════════════

function computeConfidence(extracted) {
  let score = 1.0

  if (!extracted._confidence.active_minutes)  score -= 0.3
  if (!extracted._confidence.cuisine)         score -= 0.2
  if (!extracted._confidence.ingredients)     score -= 0.2  // < 3 ingredients found
  if (extracted.is_jain === null)             score -= 0.1  // uncertain jain status
  // Nutrition is always null from script (no extraction), small penalty
  score -= 0.1

  return Math.max(0.0, Math.round(score * 100) / 100)
}

// ══════════════════════════════════════════════════════════════════════════════
//  Step C — LLM Extraction (Claude Haiku with prompt caching)
// ══════════════════════════════════════════════════════════════════════════════

// System prompt is stable → cached by Claude with cache_control: ephemeral
const LLM_SYSTEM_PROMPT = `You are a recipe metadata extraction expert specializing in Indian cooking content from YouTube.

Given recipe information (title, description, transcript excerpt), extract structured metadata and return ONLY a valid JSON array.

For each recipe extract:
- active_minutes: integer cook/prep time in minutes (null if unclear)
- cuisine: array of strings from: north_indian, south_indian, mughlai, gujarati, bengali, street_food, indo_chinese, maharashtrian, rajasthani, italian, chinese, continental (empty array if unclear)
- course: one of: main, breakfast, snacks, dessert, soup, drinks (default: main)
- difficulty: one of: easy, medium, hard
- is_vegetarian: true/false/null
- is_vegan: true/false/null
- is_jain: true/false/null (jain = no onion, garlic, root veg)
- is_gluten_free: true/false/null
- is_dairy_free: true/false/null
- contains_egg: true/false
- contains_meat: true/false (meat includes chicken, mutton, fish, prawn, beef, pork)
- contains_onion: true/false
- contains_garlic: true/false
- contains_nuts: true/false
- ingredients: array of top 5-8 main ingredients as strings (lowercase, English only)
- tags: array from: veg, non-veg, egg, quick, jain, vegan, healthy, breakfast, dessert, snacks, soup, drinks, street-food, biryani, rice, dal, pasta, gluten-free, dairy-free
- calories: integer estimate per serving (null if unknown)

Rules:
- Return EXACTLY ${LLM_BATCH_FULL} objects in the array (one per recipe, in order)
- JSON only, no explanation, no markdown fences
- If genuinely unknown, use null (not false or empty string)
- Hindi/Hinglish titles: translate mentally, extract in English`

const LLM_PARTIAL_SYSTEM_PROMPT = `You are a recipe metadata extraction expert for Indian cooking YouTube content.

You will receive recipes that have been partially extracted. Fill in ONLY the missing fields (marked as null or empty).
Return ONLY a valid JSON array with exactly the same number of objects as input recipes.

Rules:
- Return JSON array only, no explanation
- Only provide values for fields that are null/missing — preserve existing non-null values
- Hindi/Hinglish: extract in English`

/** Full LLM extraction for a batch of recipes. */
async function llmFullExtract(recipes) {
  const numbered = recipes.map((r, i) => {
    const desc    = (r.description || '').slice(0, 400)
    const excerpt = (r.transcript  || '').slice(0, 300)
    return `${i + 1}. Title: "${r.name}"\n   Description: ${desc}\n   Transcript: ${excerpt}`
  }).join('\n\n')

  const userContent = `Extract metadata for these ${recipes.length} recipes:\n\n${numbered}\n\nReturn JSON array of ${recipes.length} objects.`

  const response = await claude.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 2000,
    system: [
      {
        type:          'text',
        text:          LLM_SYSTEM_PROMPT.replace(/\$\{LLM_BATCH_FULL\}/g, recipes.length),
        cache_control: { type: 'ephemeral' },  // cached — same prompt every batch
      }
    ],
    messages: [{ role: 'user', content: userContent }],
  })

  const text = response.content[0].text.trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '')

  return JSON.parse(text)
}

/** Partial LLM extraction: fill gaps in script-extracted data. */
async function llmPartialExtract(recipes, scriptResults) {
  const items = recipes.map((r, i) => {
    const ex = scriptResults[i]
    return {
      title:          r.name,
      description:    (r.description || '').slice(0, 300),
      already_known:  {
        active_minutes: ex.active_minutes,
        cuisine:        ex.cuisine.length ? ex.cuisine : null,
        course:         ex.course,
        difficulty:     ex.difficulty,
        is_vegetarian:  ex.is_vegetarian,
        is_vegan:       ex.is_vegan,
        is_jain:        ex.is_jain,
        contains_meat:  ex.contains_meat,
        contains_egg:   ex.contains_egg,
      },
      missing: [
        ...(!ex._confidence.active_minutes ? ['active_minutes'] : []),
        ...(!ex._confidence.cuisine        ? ['cuisine'] : []),
        ...(ex.is_jain === null            ? ['is_jain'] : []),
        ...(ex.ingredients.length < 3      ? ['ingredients'] : []),
      ],
    }
  })

  const userContent = `Fill missing fields for these ${recipes.length} recipes:\n\n${JSON.stringify(items, null, 2)}\n\nReturn JSON array of ${recipes.length} objects with ALL fields (preserve known values).`

  const response = await claude.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 1500,
    system: [
      {
        type:          'text',
        text:          LLM_PARTIAL_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }
    ],
    messages: [{ role: 'user', content: userContent }],
  })

  const text = response.content[0].text.trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '')

  return JSON.parse(text)
}

/** Merge partial LLM result back into script extraction. */
function mergePartial(scriptResult, llmResult) {
  const merged = { ...scriptResult }
  if (!scriptResult._confidence.active_minutes && llmResult.active_minutes) {
    merged.active_minutes = llmResult.active_minutes
    merged.cook_minutes   = llmResult.active_minutes
  }
  if (!scriptResult._confidence.cuisine && Array.isArray(llmResult.cuisine)) {
    merged.cuisine = llmResult.cuisine
  }
  if (scriptResult.is_jain === null && llmResult.is_jain !== undefined) {
    merged.is_jain = llmResult.is_jain
  }
  if (scriptResult.ingredients.length < 3 && Array.isArray(llmResult.ingredients)) {
    // LLM returns string array; convert to our object format
    merged.ingredients = llmResult.ingredients.map(name =>
      typeof name === 'string'
        ? { name: name.toLowerCase(), ...(INGREDIENT_DB[name.toLowerCase()] || { category: 'other', is_staple: false }), substitutes: [] }
        : name
    )
  }
  return merged
}

// ══════════════════════════════════════════════════════════════════════════════
//  Step D — Embedding Generation
// ══════════════════════════════════════════════════════════════════════════════

/** Build embedding input text from recipe + extracted metadata. */
function buildEmbeddingText(recipe, extracted) {
  const parts = [
    recipe.name,
    extracted.cuisine?.join(', '),
    extracted.ingredients?.map(i => i.name || i).join(', '),
    extracted.tags?.join(', '),
    extracted.difficulty,
    extracted.course,
    extracted.active_minutes ? `${extracted.active_minutes} minutes` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

/** Generate embeddings for a batch of texts. Returns float32[][] */
async function generateEmbeddings(texts) {
  const result = await openai.embeddings.create({
    model: 'text-embedding-3-small',  // 1536 dimensions, cheap
    input: texts,
  })
  // Return in original order (OpenAI guarantees order)
  return result.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

// ══════════════════════════════════════════════════════════════════════════════
//  Step E/F/G — Supabase Update
// ══════════════════════════════════════════════════════════════════════════════

async function updateRecipe(recipe, extracted, embedding, method) {
  const update = {
    // Core extracted fields
    active_minutes:       extracted.active_minutes,
    cook_minutes:         extracted.cook_minutes,
    prep_minutes:         extracted.active_minutes
                          ? Math.round(extracted.active_minutes * 0.3)
                          : null,
    total_minutes:        extracted.active_minutes,
    cuisine:              extracted.cuisine || [],
    course:               extracted.course,
    difficulty:           extracted.difficulty,
    ingredients:          JSON.stringify(extracted.ingredients || []),
    tags:                 extracted.tags || [],

    // Dietary flags
    is_vegetarian:        extracted.is_vegetarian,
    is_vegan:             extracted.is_vegan,
    is_jain:              extracted.is_jain,
    is_gluten_free:       extracted.is_gluten_free,
    is_dairy_free:        extracted.is_dairy_free,
    contains_egg:         extracted.contains_egg,
    contains_meat:        extracted.contains_meat,
    contains_onion:       extracted.contains_onion,
    contains_garlic:      extracted.contains_garlic,
    contains_nuts:        extracted.contains_nuts,

    // Nutrition (null — requires separate pipeline)
    calories:             extracted.calories || null,

    // Vector embedding
    embedding:            embedding,

    // Pipeline metadata
    status:               'active',
    extraction_method:    method,
    extraction_version:   1,
    extraction_confidence: computeConfidence(extracted),
    tagging_attempts:     (recipe.tagging_attempts || 0) + 1,
    last_tagged_at:       new Date().toISOString(),
    updated_at:           new Date().toISOString(),

    // Step F: clear transcript to save space
    transcript:           null,
  }

  const { error } = await supabase
    .from('recipes')
    .update(update)
    .eq('id', recipe.id)

  if (error) throw new Error(`Supabase update failed for ${recipe.id}: ${error.message}`)
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════════════════════

async function processBatch(recipes) {
  const n = recipes.length
  let stats = { script: 0, partial: 0, full: 0, errors: 0 }

  // ── Step A+B: Run extraction + score all recipes ──────────────────────────
  const scriptResults    = recipes.map(extractFromScript)
  const confidences      = scriptResults.map(computeConfidence)

  // ── Step C: Route by confidence tier ─────────────────────────────────────
  const scriptOnlyIdx  = []  // confidence >= 0.7
  const partialLlmIdx  = []  // 0.4 <= confidence < 0.7
  const fullLlmIdx     = []  // confidence < 0.4

  for (let i = 0; i < n; i++) {
    if      (confidences[i] >= 0.7) scriptOnlyIdx.push(i)
    else if (confidences[i] >= 0.4) partialLlmIdx.push(i)
    else                            fullLlmIdx.push(i)
  }

  // Final extracted results (same order as recipes[])
  const finalResults = [...scriptResults]

  // ── Full LLM extraction (batches of LLM_BATCH_FULL) ──────────────────────
  for (let b = 0; b < fullLlmIdx.length; b += LLM_BATCH_FULL) {
    const chunk   = fullLlmIdx.slice(b, b + LLM_BATCH_FULL)
    const batch   = chunk.map(i => recipes[i])
    try {
      const llmResults = await llmFullExtract(batch)
      chunk.forEach((recipeIdx, j) => {
        const llm = llmResults[j]
        if (llm) {
          // Merge LLM result with any script-found fields
          finalResults[recipeIdx] = {
            ...scriptResults[recipeIdx],
            ...llm,
            // Prefer script for structural fields
            _confidence: scriptResults[recipeIdx]._confidence,
          }
          // Normalize ingredients from LLM (string[] → object[])
          if (Array.isArray(llm.ingredients)) {
            finalResults[recipeIdx].ingredients = llm.ingredients.map(name =>
              typeof name === 'string'
                ? { name: name.toLowerCase(), ...(INGREDIENT_DB[name.toLowerCase()] || { category: 'other', is_staple: false }), substitutes: [] }
                : name
            )
          }
        }
      })
      stats.full += chunk.length
    } catch (e) {
      console.error(`\n  Full LLM batch error: ${e.message}`)
      // Fall back to script results for this chunk
      stats.errors += chunk.length
    }
  }

  // ── Partial LLM extraction (fill gaps, smaller batches) ──────────────────
  for (let b = 0; b < partialLlmIdx.length; b += LLM_BATCH_PARTIAL) {
    const chunk       = partialLlmIdx.slice(b, b + LLM_BATCH_PARTIAL)
    const batch       = chunk.map(i => recipes[i])
    const batchScript = chunk.map(i => scriptResults[i])
    try {
      const llmResults = await llmPartialExtract(batch, batchScript)
      chunk.forEach((recipeIdx, j) => {
        if (llmResults[j]) {
          finalResults[recipeIdx] = mergePartial(scriptResults[recipeIdx], llmResults[j])
        }
      })
      stats.partial += chunk.length
    } catch (e) {
      console.error(`\n  Partial LLM batch error: ${e.message}`)
      stats.errors += chunk.length
    }
  }

  stats.script = scriptOnlyIdx.length

  // ── Step D: Generate embeddings in one batch call ─────────────────────────
  const embeddingTexts = recipes.map((r, i) => buildEmbeddingText(r, finalResults[i]))
  let embeddings
  try {
    embeddings = await generateEmbeddings(embeddingTexts)
  } catch (e) {
    console.error(`\n  Embedding error: ${e.message}`)
    embeddings = recipes.map(() => null)
    stats.errors += recipes.length
  }

  // ── Steps E/F/G: Update Supabase ─────────────────────────────────────────
  const methodFor = (i) => {
    if (fullLlmIdx.includes(i))    return 'llm_only'
    if (partialLlmIdx.includes(i)) return 'script_plus_llm'
    return 'script'
  }

  for (let i = 0; i < n; i++) {
    try {
      await updateRecipe(recipes[i], finalResults[i], embeddings[i], methodFor(i))
      process.stdout.write(
        fullLlmIdx.includes(i)    ? 'L' :   // full LLM
        partialLlmIdx.includes(i) ? 'P' :   // partial LLM
        '.'                                  // script only
      )
    } catch (e) {
      console.error(`\n  Update error for recipe ${recipes[i].id}: ${e.message}`)
      stats.errors++
      process.stdout.write('E')
    }
  }

  return stats
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Vorel Tagger')
  console.log('  Legend: . = script  P = partial-LLM  L = full-LLM  E = error')
  console.log('═══════════════════════════════════════════')

  let totalScript = 0, totalPartial = 0, totalFull = 0, totalErrors = 0
  let processed = 0
  let page = 0

  while (processed < RUN_LIMIT) {
    const remaining = Math.min(BATCH_SIZE, RUN_LIMIT - processed)

    // Fetch enriched and stale recipes (prioritise quality tier via view_count)
    const { data: batch, error } = await supabase
      .from('recipes')
      .select(`
        id, youtube_id, name, description, transcript,
        duration_seconds, view_count, channel_subs,
        tagging_attempts, status
      `)
      .in('status', ['enriched', 'stale'])
      .lt('tagging_attempts', 3)
      .order('view_count', { ascending: false })
      .range(0, remaining - 1)

    if (error) {
      console.error('Supabase fetch error:', error.message)
      process.exit(1)
    }
    if (!batch || batch.length === 0) {
      console.log('\n  No more recipes to tag.')
      break
    }

    page++
    process.stdout.write(`\nBatch ${page} (${batch.length} recipes): `)

    const stats = await processBatch(batch)

    totalScript  += stats.script
    totalPartial += stats.partial
    totalFull    += stats.full
    totalErrors  += stats.errors
    processed    += batch.length
  }

  console.log(`\n\n═══════════════════════════════════════════`)
  console.log(`  Done. ${processed} recipes tagged.`)
  console.log(`  . Script only: ${totalScript}`)
  console.log(`  P Partial LLM: ${totalPartial}`)
  console.log(`  L Full LLM:    ${totalFull}`)
  console.log(`  E Errors:      ${totalErrors}`)
  console.log('═══════════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })
