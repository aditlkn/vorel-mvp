import dotenv from 'dotenv'
dotenv.config({ override: true })
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const USERS_DIR     = process.env.USERS_DIR || path.join(__dirname, 'users')
const FRONTEND_DIR  = path.join(__dirname, '..', 'frontend')
const FRONTEND_HTML = path.join(FRONTEND_DIR, 'index.html')
const DB_PATH       = process.env.DB_PATH   || path.join(__dirname, 'dishes.db')

fs.mkdirSync(USERS_DIR, { recursive: true })

// ── Recipe DB ──────────────────────────────────────────────────────────────
let db = null
if (fs.existsSync(DB_PATH)) {
  db = new Database(DB_PATH, { readonly: true })
  const { n } = db.prepare('SELECT COUNT(*) as n FROM dishes').get()
  console.log(`Dishes DB: ${n} recipes loaded`)
} else {
  console.warn('No dishes.db found — recipe search disabled')
}

// ── Express ────────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use(express.static(FRONTEND_DIR))
app.get('/u/:slug', (req, res) => res.sendFile(FRONTEND_HTML))

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are Vorel, a friendly kitchen assistant powered by the YourFoodLab recipe catalog.

How to run the conversation:

Step 1 — Find out what they have
Ask what's in their kitchen today. Be casual and brief.

Step 2 — Understand constraints
Ask one follow-up: time available, spice level, mood, dietary needs.
One question only.

Step 3 — Suggest dishes
After 2 exchanges MAX, stop asking questions and suggest 3 dishes.
Use ONLY recipes from the "Available recipes" section below.
Format each suggestion like this:

1. [Dish name] — [time] — [one line why it fits tonight]
   [youtube_url] · [views] views

2. ...

3. ...

End with: "Which one sounds good?"

Step 4 — Recipe walkthrough
When they pick one, walk through it step by step.
One step at a time. Wait for "next" or "ready" before continuing.

Rules:
- After the user's 2nd message, move to suggestions — stop asking follow-up questions
- Only suggest dishes from "Available recipes" — never invent dishes
- Always include the youtube_url on its own line below each suggestion
- Keep all messages short — 3 lines max except recipe steps
- NEVER use affirmations to start a message — not "Great!", "Nice!", "Perfect!", "Nice start!", "Got it!", "Sure!", or any similar filler. Start with substance.
- Don't ask more than one question at a time
- Plain text only — no markdown, no **bold**, no asterisks
`

// ── Intent parser ──────────────────────────────────────────────────────────
// Tiny Claude call (~80 tokens) to decide if we should search and what to search for.
// Only runs when conversation has enough context to suggest dishes.
async function parseIntent(conversation) {
  const userMsgs = conversation.filter(
    m => m.role === 'user' && typeof m.content === 'string'
  )
  if (userMsgs.length < 2) return { suggest: false }

  // Don't search if already in recipe walkthrough
  const lastUser = userMsgs.at(-1).content.toLowerCase().trim()
  const walkthroughSignals = ['next', 'ready', 'done', 'go', 'continue', 'yep', 'got it']
  if (walkthroughSignals.some(w => lastUser === w || lastUser === `${w}.`)) {
    return { suggest: false }
  }

  // Don't search if we already showed suggestions
  const alreadySuggested = conversation.some(
    m => m.role === 'assistant' &&
         typeof m.content === 'string' &&
         /\n1\./.test(m.content)
  )
  if (alreadySuggested) return { suggest: false }

  // After 3+ user messages, force suggest using all conversation text as query
  // — don't burn another LLM call, just search with what we have
  if (userMsgs.length >= 3) {
    const query = userMsgs.map(m => m.content).join(' ')
    return { suggest: true, query, tags: [], max_time: null }
  }

  // 2 user messages: use small intent extraction call
  const recentUserText = userMsgs.map(m => m.content).join('\n')
  try {
    const r = await claude.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 100,
      system:     'Extract cooking intent. Return JSON only, no explanation.',
      messages:   [{
        role:    'user',
        content: `User messages:\n${recentUserText}\n\n` +
                 `Return: {"suggest":true/false,"query":"ingredients as search string","tags":[],"max_time":null}\n` +
                 `suggest=true if ingredients are mentioned. Be generous — if in doubt, suggest.\n` +
                 `tags from: veg,non-veg,egg,quick,snacks,breakfast,jain,healthy,soup,dessert,biryani,italian`
      }]
    })
    return JSON.parse(r.content[0].text.replace(/```json?\n?/g, '').replace(/```/g, ''))
  } catch {
    // Fallback: search with raw text
    return { suggest: true, query: recentUserText, tags: [], max_time: null }
  }
}

// ── Multi-ingredient search ────────────────────────────────────────────────
// Searches each ingredient term separately, scores dishes by how many they match.
// Returns a blended, ranked list so no single ingredient dominates.
function searchDishes(query, tags = [], maxTime = null) {
  if (!db || !query) return []

  const terms = query.toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z]/g, ''))
    .filter(t => t.length > 2)

  if (!terms.length) return []

  const scoreMap = new Map()

  for (const term of terms) {
    try {
      let sql = `
        SELECT d.clean_title  AS title,
               d.ingredients,
               d.tags,
               d.cook_time_mins,
               d.video_url,
               d.view_count
        FROM   dishes_fts f
        JOIN   dishes d ON d.id = f.rowid
        WHERE  dishes_fts MATCH ?
      `
      const params = [`"${term}"`]

      if (tags.length) {
        const clauses = tags.map(() => 'd.tags LIKE ?').join(' OR ')
        sql += ` AND (${clauses})`
        tags.forEach(t => params.push(`%${t}%`))
      }
      if (maxTime) {
        sql += ` AND (d.cook_time_mins IS NULL OR d.cook_time_mins <= ?)`
        params.push(maxTime)
      }
      sql += ` ORDER BY rank LIMIT 10`

      const rows = db.prepare(sql).all(...params)
      for (const row of rows) {
        const key = row.video_url
        if (scoreMap.has(key)) {
          scoreMap.get(key).score++
        } else {
          scoreMap.set(key, { ...row, score: 1 })
        }
      }
    } catch (e) {
      console.error(`FTS error for term "${term}":`, e.message)
    }
  }

  // Sort by score (dishes matching more ingredients rank higher)
  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score || (b.view_count ?? 0) - (a.view_count ?? 0))
    .slice(0, 8)
}

function formatViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`
  return String(n)
}

// Format search results for injection into system prompt
function formatResultsForContext(results) {
  if (!results.length) return ''
  const lines = results.map(r => {
    const time  = r.cook_time_mins ? `${r.cook_time_mins} mins` : '?'
    const views = r.view_count ? formatViews(r.view_count) : null
    return `- ${r.title} | ${time}${views ? ` | ${views} views` : ''} | tags: ${r.tags} | ${r.video_url}`
  }).join('\n')
  return `\n\nAvailable recipes (use ONLY these when suggesting):\n${lines}`
}

// ── Food-only guard ────────────────────────────────────────────────────────
// Zero API cost — pure keyword check on the server.
// We allow anything that's plausibly food/cooking related.
// Anything clearly off-topic gets rejected before touching Claude.

const FOOD_KEYWORDS = [
  // ingredients
  'chicken','mutton','lamb','fish','prawn','shrimp','egg','paneer','tofu','beef','pork',
  'rice','dal','lentil','pasta','noodle','bread','roti','naan','paratha','puri','poha',
  'potato','onion','tomato','garlic','ginger','spinach','mushroom','carrot','pea',
  'pepper','capsicum','corn','cauliflower','broccoli','cabbage','beans','curd','yogurt',
  'cheese','butter','cream','milk','oil','flour','sugar','salt','spice','masala',
  'turmeric','cumin','coriander','chili','chilli','cardamom','clove','cinnamon',
  // dishes
  'biryani','curry','sabzi','stir','fry','soup','salad','sandwich','wrap','roll',
  'tikka','kebab','korma','pulao','khichdi','idli','dosa','uttapam','vada','samosa',
  'halwa','kheer','ladoo','barfi','raita','chutney','pickle','papad',
  // cooking context
  'cook','recipe','make','bake','boil','grill','roast','steam','fry','marinate',
  'ingredient','kitchen','fridge','dinner','lunch','breakfast','snack','meal','dish',
  'eat','hungry','food','taste','flavor','spicy','sweet','sour','light','heavy',
  'quick','easy','healthy','veg','vegetarian','jain','non-veg','calories',
  'minutes','mins','hour','time','tonight','today',
  // conversational yes/no that's fine in context
  'yes','no','ok','okay','next','ready','done','more','less','sure',
]

const OFF_TOPIC_PATTERNS = [
  /\b(stock|crypto|bitcoin|invest|finance|loan|insurance)\b/i,
  /\b(politics|election|vote|president|minister|government)\b/i,
  /\b(code|program|javascript|python|sql|database|api|software)\b/i,
  /\b(movie|film|series|netflix|music|song|album|artist)\b/i,
  /\b(sport|cricket|football|ipl|match|score|player)\b/i,
  /\b(travel|flight|hotel|vacation|tour|visa|passport)\b/i,
  /\b(medical|doctor|hospital|disease|symptom|medicine|drug)\b/i,
  /\b(write me|essay|poem|story|summarize|translate|explain)\b/i,
]

function isFoodRelated(message) {
  const lower = message.toLowerCase()

  // Short messages (next / ready / yes / numbers) are fine — they're in-conversation
  if (message.trim().split(/\s+/).length <= 3) return true

  // Explicit off-topic patterns — reject immediately
  if (OFF_TOPIC_PATTERNS.some(p => p.test(lower))) return false

  // Must contain at least one food keyword
  return FOOD_KEYWORDS.some(w => lower.includes(w))
}

// ── User helpers ───────────────────────────────────────────────────────────
function getUser(slug) {
  const file = path.join(USERS_DIR, `${slug}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function saveUser(slug, data) {
  fs.writeFileSync(
    path.join(USERS_DIR, `${slug}.json`),
    JSON.stringify(data, null, 2)
  )
}

function buildPrefContext(prefs) {
  const parts = []
  if (prefs?.constraints?.length) parts.push(`Dietary constraints: ${prefs.constraints.join(', ')}`)
  if (prefs?.liked?.length)       parts.push(`Dishes they like: ${prefs.liked.join(', ')}`)
  if (prefs?.disliked?.length)    parts.push(`Dishes they dislike: ${prefs.disliked.join(', ')}`)
  return parts.join('\n')
}

// ── Main chat endpoint ─────────────────────────────────────────────────────
app.post('/chat/:slug', async (req, res) => {
  const user = getUser(req.params.slug)
  if (!user) return res.status(404).json({ error: 'Not found' })

  const { message } = req.body

  if (message === '__init__') {
    if (user.conversation.length === 0) {
      const greeting = `Hey ${user.name}! What have you got in the kitchen today?`
      user.conversation.push({ role: 'assistant', content: greeting })
      saveUser(req.params.slug, user)
      return res.json({ reply: greeting })
    }
    const last = user.conversation
      .filter(m => m.role === 'assistant' && typeof m.content === 'string')
      .at(-1)
    return res.json({ reply: last?.content || '' })
  }

  // Guard — reject off-topic messages before touching Claude
  if (!isFoodRelated(message)) {
    return res.json({ reply: "I'm only here to help with cooking and recipes. What have you got in the kitchen?" })
  }

  user.conversation.push({ role: 'user', content: message })

  const prefContext = buildPrefContext(user.known_preferences)
    ? `\n\nKnown about this user:\n${buildPrefContext(user.known_preferences)}`
    : ''

  try {
    // ── Intent parse + DB search (our code, not Claude's tool) ────────────
    const intent  = await parseIntent(user.conversation)
    let recipeCtx = ''

    if (intent.suggest && intent.query) {
      console.log(`Intent: ${JSON.stringify(intent)}`)
      const results = searchDishes(intent.query, intent.tags || [], intent.max_time)
      console.log(`  → ${results.length} results (scores: ${results.map(r => r.score).join(',')})`)
      recipeCtx = formatResultsForContext(results)
    }

    // ── Single Claude call — no tool definitions needed ───────────────────
    const response = await claude.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 600,
      system:     SYSTEM_PROMPT + prefContext + recipeCtx,
      messages:   user.conversation
    })

    const reply = response.content[0].text
    user.conversation.push({ role: 'assistant', content: reply })

    await learnFromConversation(user, message, reply)
    saveUser(req.params.slug, user)
    res.json({ reply })

  } catch (err) {
    console.error('Chat error:', err.message)
    user.conversation.pop()
    saveUser(req.params.slug, user)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

// ── Learning ───────────────────────────────────────────────────────────────
async function learnFromConversation(user, userMessage, vorelReply) {
  const signals = ['loved', 'hated', 'terrible', 'not again', 'too spicy', 'too bland', 'never again']
  if (!signals.some(s => userMessage.toLowerCase().includes(s))) return
  try {
    const r = await claude.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 150,
      system: 'Extract preference signals. Return JSON only.',
      messages: [{ role: 'user', content:
        `User: "${userMessage}" Context: "${vorelReply}"
         Return: {"liked_dish":"or null","disliked_dish":"or null","constraint":"or null"}`
      }]
    })
    const s = JSON.parse(r.content[0].text)
    if (s.liked_dish)    user.known_preferences.liked.push(s.liked_dish)
    if (s.disliked_dish) user.known_preferences.disliked.push(s.disliked_dish)
    if (s.constraint)    user.known_preferences.constraints.push(s.constraint)
  } catch { /* best-effort */ }
}

// ── History ────────────────────────────────────────────────────────────────
app.get('/history/:slug', (req, res) => {
  const user = getUser(req.params.slug)
  if (!user) return res.status(404).json({ error: 'Not found' })
  res.json({ conversation: user.conversation })
})

// ── Reset ──────────────────────────────────────────────────────────────────
app.post('/reset/:slug', (req, res) => {
  const user = getUser(req.params.slug)
  if (!user) return res.status(404).json({ error: 'Not found' })
  user.conversation = []
  saveUser(req.params.slug, user)
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Vorel on :${PORT}`))
