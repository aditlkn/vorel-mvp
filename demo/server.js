/**
 * demo/server.js — Vorel ordering demo
 * Run:  node demo/server.js
 *
 * MOCK_MODE (default: true) — set to false in .env to place real orders.
 * When true: providers use mock data, no real API calls are made.
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(__rootDir, '.env'), override: true })

// Default to mock mode — set MOCK_MODE=false in .env to enable live orders
if (!('MOCK_MODE' in process.env)) process.env.MOCK_MODE = 'true'

import express    from 'express'
import Anthropic  from '@anthropic-ai/sdk'
import Database   from 'better-sqlite3'
import { VOREL_TOOLS, executeTool }          from '../pipeline/mcp/router.js'
import { SwiggyFoodProvider }                from '../pipeline/mcp/providers/swiggy-food.js'
import { getMockOrderStatus, fmtViews } from '../pipeline/mcp/mock/data.js'

// ── Dishes DB ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__rootDir, 'backend/dishes.db'), { readonly: true })

const app    = express()
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
app.use(express.json())

// ── Sessions (2-hour TTL) ─────────────────────────────────────────────────────
const sessions   = new Map()
const SESSION_TTL = 2 * 60 * 60 * 1000

function getSession(id) {
  const now   = Date.now()
  const entry = sessions.get(id)
  if (entry && now - entry.ts < SESSION_TTL) { entry.ts = now; return entry.history }
  const history = []
  sessions.set(id, { history, ts: now })
  return history
}

const DEMO_CONTEXT = { lat: 12.9352, lng: 77.6245 }

// ── Recipe visual metadata ────────────────────────────────────────────────────
const RECIPE_UI = {
  rec_dal_tadka:            { emoji: '🥣', grad: '#c9a227, #8B6914', bg: '#f5e6c8' },
  rec_chicken_curry:        { emoji: '🍗', grad: '#8B2500, #5c1a00', bg: '#f5d5c8' },
  rec_paneer_butter_masala: { emoji: '🧡', grad: '#c45c1a, #8B3a0f', bg: '#f5dac8' },
  rec_aloo_paratha:         { emoji: '🫓', grad: '#7a6000, #4a3a00', bg: '#f5edc8' },
  rec_egg_bhurji:           { emoji: '🍳', grad: '#8B5a00, #5c3a00', bg: '#f5e2c8' },
}

// ── Personalised "why this recipe" reason ─────────────────────────────────────
function recipeReason(r) {
  const matched = r.matched_count ?? r.matched ?? 0
  const missing = r.missing_count ?? r.missing ?? 0
  const time    = r.cook_time_mins

  if (missing === 0) return `You already have everything — ready in ${time} min`
  if (missing <= 2)  return `Almost there — just ${missing} ingredient${missing > 1 ? 's' : ''} to order`
  if (matched >= 4)  return `Uses ${matched} things you already have`
  if (time <= 20)    return `Quick ${time}-min dish — good call for tonight`
  return `Classic comfort food, ${time} min from start to finish`
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Vorel, a smart kitchen and food assistant for Indian households.

IMPORTANT — pre-configured, never ask for these:
- Location: Koramangala, Bengaluru. Always pass lat: 12.9352, lng: 77.6245 in tool calls.
- Delivery address: address_id "addr_home"
- Payment: upi by default, card if user says card.

THE MAIN FLOW:

STEP 1 — FRIDGE CHECK
Ask what they have in the kitchen. Casual, one sentence.
One follow-up ok: dietary preference or time.

STEP 2 — RECIPES
Call search_recipes. Say one sentence introducing options ("Based on what you have, here are a few:"), then end with "Which one sounds good?" — let the UI show the cards.

STEP 3 — INGREDIENT DIFF
User picks a recipe → call get_ingredient_diff.
Say: "You already have: [list]. Need to order: [list]. Should I order the missing ingredients?"

STEP 4 — ORDER GROCERIES
On yes: YOU MUST call order_ingredients — this is mandatory, never skip it.
Pass ALL missing ingredient names as a single array — one call, not one per ingredient.
NEVER say "I'm ordering" or "I'll add that" without actually calling the tool.
The tool returns: added (items found and added), unavailable (not found), and the cart summary.
If key ingredients are unavailable:
  - Say which ones aren't available.
  - Offer the restaurant pivot: "Want me to order [recipe name] from a restaurant nearby instead? Ready in ~30 mins."
  - If user agrees → call search_restaurants with the recipe name, show options, proceed with restaurant ordering flow.
After order_ingredients returns, say ONLY: "Here's your cart — ready to place the order?" — the UI shows a cart card automatically. Do NOT list items or prices in text.
On confirm: call place_order (type: "grocery").

STEP 5 — AFTER ORDER
Offer to walk through the recipe step by step. Always offer to track the order.

ALSO AVAILABLE: user can ask to order food from a restaurant directly any time.

RESTAURANT ORDERING RULES (all mandatory, in order):
1. SEARCH: call search_restaurants with a query (dish name or cuisine).
2. PRESENT: tell the user which restaurants were found (name, rating, ETA, offer). Ask which one.
3. MENU — MANDATORY: as soon as the user picks a restaurant (or says "okay"/"yes"/"that one"), call get_menu for that restaurant BEFORE asking what they want to order. Then tell the user what's on the menu: list 4-6 key items with names and prices. Only show items from the actual menu result.
4. If the user asks for something not on that menu, say so and offer alternatives from the same menu or a different restaurant. Never add items that aren't in the menu result.
5. ADD: YOU MUST call add_to_cart for each confirmed item — never say you're adding without calling the tool.
6. STOP HERE. Say only: "Here's your cart — ready to place the order?" — the UI shows a cart card with items and pricing. Do NOT list items or prices in text.
7. PLACE: only call place_order AFTER the user sends an explicit confirmation ("yes", "place it", "go ahead"). Never call place_order in the same response as add_to_cart.

CART EDITING (after a cart exists):
If the user wants to change the cart — remove an item, change a quantity, or says "actually skip the X" — use these tools:
- remove_from_cart: call get_cart first to get item IDs, then call remove_from_cart with the matching id.
- update_cart_item: same — get_cart to find the id, then update_cart_item with the new quantity. Quantity 0 removes it.
After any cart edit, say only: "Done — here's your updated cart." The UI re-renders automatically. Do NOT list items.
Never call place_order in the same response as a cart edit.

CRITICAL TOOL RULES:
- order_ingredients and add_to_cart MUST always be called as actual tool calls — never narrate ordering without calling the tool
- add_to_cart and place_order must NEVER be called in the same response; confirm with user first
- After any add_to_cart or order_ingredients, always end your turn immediately with the confirmation prompt

For North Indian dishes (paneer butter masala, roti, naan, dal makhani, butter chicken) — Punjab Grill (rst_punjab_grill_003) and Moti Mahal Delux (rst_moti_mahal_004) both have these. Saravana Bhavan is South Indian only (dosa, idli, meals).

RULES:
- Never ask for location, address, payment — all pre-set
- NEVER start with "Great!", "Sure!", "Perfect!", "Of course!" or any filler
- Plain text only — no markdown, no asterisks, no bullet symbols
- One question at a time`

// ── Demo-only tools ───────────────────────────────────────────────────────────
const DEMO_EXTRA_TOOLS = [
  {
    name: 'search_recipes',
    description: 'Search for recipes matching the user\'s fridge ingredients.',
    input_schema: {
      type: 'object',
      properties: {
        fridge_items:  { type: 'array', items: { type: 'string' } },
        max_time_mins: { type: 'number' },
        diet:          { type: 'string', description: 'veg, non-veg, or egg' },
      },
      required: ['fridge_items'],
    },
  },
  {
    name: 'get_ingredient_diff',
    description: 'Returns what the user already has vs what needs to be ordered for a recipe.',
    input_schema: {
      type: 'object',
      properties: {
        recipe_id:    { type: 'string' },
        fridge_items: { type: 'array', items: { type: 'string' } },
      },
      required: ['recipe_id', 'fridge_items'],
    },
  },
  {
    name: 'get_menu',
    description: 'Get the menu for a restaurant after user picks one.',
    input_schema: {
      type: 'object',
      properties: { restaurant_id: { type: 'string' } },
      required: ['restaurant_id'],
    },
  },
]

const ALL_TOOLS = [...VOREL_TOOLS, ...DEMO_EXTRA_TOOLS].map(t => {
  if (!t.input_schema?.required) return t
  return { ...t, input_schema: { ...t.input_schema, required: t.input_schema.required.filter(f => f !== 'lat' && f !== 'lng') } }
})

const swiggyFood = new SwiggyFoodProvider()

// ── DB helpers ────────────────────────────────────────────────────────────────
function extractChannel(originalTitle) {
  const parts = originalTitle.split('|').map(s => s.trim()).filter(Boolean)
  // Walk from the end; take the first segment that has no Devanagari characters
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!/[ऀ-ॿ]/.test(parts[i]) && parts[i].length < 40) return parts[i]
  }
  return 'YourFoodLab'
}

function estimateCookTime(row) {
  if (row.cook_time_mins) return row.cook_time_mins
  if (row.duration_seconds) return Math.max(10, Math.round(row.duration_seconds / 60))
  return 30
}

function ingredientsFromDB(row) {
  return row.ingredients.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

function diffAgainstFridge(dish, fridgeItems) {
  const fridge = fridgeItems.map(f => f.toLowerCase().trim())
  const allIngs = ingredientsFromDB(dish)
  const have = [], need = []
  for (const ing of allIngs) {
    const inFridge = fridge.some(f => ing.includes(f) || f.includes(ing))
    if (inFridge) have.push(ing)
    else need.push({ name: ing, qty: 'as needed', grocery_id: null })
  }
  return { recipe: dish.clean_title, have, need }
}

const stmtSearch = db.prepare(`
  SELECT d.* FROM dishes d
  JOIN dishes_fts f ON d.id = f.rowid
  WHERE dishes_fts MATCH ?
  ORDER BY rank
  LIMIT 20
`)
const stmtAll    = db.prepare(`SELECT * FROM dishes ORDER BY view_count DESC LIMIT 20`)
const stmtById   = db.prepare(`SELECT * FROM dishes WHERE id = ?`)

// ── Tool executor ─────────────────────────────────────────────────────────────
async function runTool(name, input, sessionId = 'default') {
  if (name === 'search_recipes') {
    const fridge  = input.fridge_items || []
    const maxTime = input.max_time_mins || null
    const diet    = input.diet || null

    // FTS search when fridge items provided; otherwise top by views
    const ftsTerm = fridge.length ? fridge.join(' OR ') : null
    const rows    = ftsTerm ? stmtSearch.all(ftsTerm) : stmtAll.all()

    // Score by ingredient overlap with fridge
    const scored = rows.map(r => {
      const ings    = ingredientsFromDB(r)
      const matched = fridge.filter(f => ings.some(i => i.includes(f.toLowerCase()) || f.toLowerCase().includes(i))).length
      const missing = ings.filter(i => !fridge.some(f => i.includes(f.toLowerCase()) || f.toLowerCase().includes(i))).length
      return { ...r, matched, missing, cook_time_mins: estimateCookTime(r) }
    })

    let results = scored
    if (diet)    results = results.filter(r => r.tags.split(',').map(t=>t.trim()).includes(diet))
    if (maxTime) results = results.filter(r => r.cook_time_mins <= maxTime)

    return results
      .sort((a, b) => b.matched - a.matched || a.missing - b.missing)
      .slice(0, 4)
      .map(r => ({
        id:            String(r.id),
        name:          r.clean_title,
        cook_time_mins: r.cook_time_mins,
        view_count:    r.view_count || 0,
        views:         fmtViews(r.view_count || 0),
        channel:       extractChannel(r.original_title),
        thumbnail_url: r.thumbnail_url || null,
        youtube_url:   r.video_url,
        tags:          r.tags.split(',').map(t => t.trim()),
        matched:       r.matched,
        missing:       r.missing,
      }))
  }

  if (name === 'get_ingredient_diff') {
    const dish = stmtById.get(parseInt(input.recipe_id))
    if (!dish) return { error: true, message: 'Recipe not found' }
    return diffAgainstFridge(dish, input.fridge_items || [])
  }

  if (name === 'get_menu') {
    return swiggyFood.getRestaurantMenu({ restaurant_id: input.restaurant_id })
  }

  return executeTool(name, input, { ...DEMO_CONTEXT, sessionId })
}

// ── Cart card normaliser — extracts a cart card from any tool result ──────────
function cartCardFromResult(result) {
  // order_ingredients wraps cart under result.cart; add_to_cart / get_cart is flat
  const src   = (result.items ? result : result.cart) ?? {}
  const items = src.items ?? []
  if (!items.length) return null
  return {
    type:             'cart',
    restaurant_name:  src.restaurant_name  ?? null,
    items,
    subtotal:         src.subtotal         ?? 0,
    delivery_fee:     src.delivery_fee     ?? 0,
    delivery_message: src.delivery_message ?? null,
    taxes:            src.taxes            ?? 0,
    total:            src.total            ?? 0,
    item_count:       src.item_count       ?? items.length,
  }
}

// ── Agentic loop ──────────────────────────────────────────────────────────────
async function runAgentLoop(history, userMessage, sessionId = 'default') {
  history.push({ role: 'user', content: userMessage })
  const messages = history.map(m => ({ role: m.role, content: m.content }))
  let finalText = null

  const cards      = []
  const upsertCart = c => { const i = cards.findIndex(x => x.type === 'cart'); i >= 0 ? cards[i] = c : cards.push(c) }
  const removeCart = ()  => { const i = cards.findIndex(x => x.type === 'cart'); if (i >= 0) cards.splice(i, 1) }

  const MAX_ITERS = 20
  let iter = 0
  while (iter++ < MAX_ITERS) {
    const response = await claude.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 4096,
      system: SYSTEM_PROMPT, tools: ALL_TOOLS, messages,
    })

    if (response.stop_reason === 'end_turn') {
      finalText = response.content.find(b => b.type === 'text')?.text ?? ''
      history.push({ role: 'assistant', content: response.content })
      break
    }

    if (response.stop_reason === 'max_tokens') {
      finalText = response.content.find(b => b.type === 'text')?.text ?? 'I ran a bit long — can you say that again?'
      history.push({ role: 'assistant', content: response.content })
      console.warn('  ⚠ max_tokens hit')
      break
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content })
      history.push({ role: 'assistant', content: response.content })

      // Guard: block place_order when add_to_cart fired in the same batch
      // (forces a cart-review step before the order is placed)
      const batchTools   = response.content.filter(b => b.type === 'tool_use').map(b => b.name)
      const cartAddedNow = batchTools.includes('add_to_cart') || batchTools.includes('order_ingredients')

      const toolResults = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        console.log(`  ⚙ ${block.name}`, JSON.stringify(block.input).slice(0, 100))

        if (block.name === 'place_order' && cartAddedNow) {
          console.log('  🛡 place_order blocked — forcing cart confirmation step')
          toolResults.push({
            type: 'tool_result', tool_use_id: block.id,
            content: JSON.stringify({ error: true, message: 'Cart updated. Ask the user to confirm before placing.' }),
          })
          continue
        }

        let result
        try   { result = await runTool(block.name, block.input, sessionId) }
        catch (e) { result = { error: true, message: e.message } }

        console.log(`  ← ${JSON.stringify(result).slice(0, 120)}`)

        if (block.name === 'search_recipes' && Array.isArray(result) && result.length) {
          cards.push({
            type: 'recipes',
            recipes: result.map(r => ({
              ...r,
              // RECIPE_UI only covers hardcoded mock IDs; DB recipes use thumbnail_url
              emoji:  r.thumbnail_url ? null : (RECIPE_UI[r.id]?.emoji ?? '🍽'),
              grad:   RECIPE_UI[r.id]?.grad ?? '#555, #333',
              reason: recipeReason(r),
            })),
          })
        }

        if (['add_to_cart', 'get_cart', 'order_ingredients'].includes(block.name)) {
          const c = cartCardFromResult(result)
          console.log(`  🛒 cartCard(${block.name}):`, c ? `${c.items.length} items, ₹${c.total}` : `null — result keys: ${Object.keys(result).join(',')}`)
          if (c) upsertCart(c)
        }

        if (block.name === 'place_order') {
          const orderId = result.order_id ?? result.id
          if (orderId && !result.error) {
            removeCart()
            cards.push({
              type:               'order',
              order_id:           orderId,
              status:             result.status             ?? 'placed',
              item_count:         result.item_count         ?? '?',
              total:              result.total              ?? '?',
              estimated_delivery: result.estimated_delivery ?? '10-15 mins',
              order_type:         block.input.type          ?? 'grocery',
            })
            console.log(`  🃏 order card → ${orderId}`)
          }
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }

      messages.push({ role: 'user', content: toolResults })
      history.push({ role: 'user', content: toolResults })
      continue
    }

    if (response.stop_reason === 'max_tokens') {
      // Partial text still useful — grab whatever was generated
      finalText = response.content.find(b => b.type === 'text')?.text
        ?? 'I ran a bit long there. Can you say that again?'
      history.push({ role: 'assistant', content: response.content })
      console.warn('  ⚠ max_tokens hit')
      break
    }

    finalText = 'Something went wrong — please try again.'
    break
  }

  if (iter > MAX_ITERS) finalText = 'I lost track — can you start over?'
  return { reply: finalText, cards }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/demo/chat', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default'
  const history   = getSession(sessionId)
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'Empty message' })

  if (message === '__init__') {
    if (!history.length) {
      const greeting = "What have you got in the kitchen today?"
      history.push({ role: 'assistant', content: greeting })
    }
    const last = [...history].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string')
    return res.json({ reply: last?.content ?? '' })
  }

  console.log(`[vorel] ▶ ${message}`)
  try {
    const { reply, cards } = await runAgentLoop(history, message, sessionId)
    console.log(`[vorel] ◀ ${reply?.slice(0, 80)} | cards:[${cards.map(c=>c.type).join(',')}]`)
    res.json({ reply, cards })
  } catch (err) {
    console.error('[vorel] error:', err.message)
    history.pop()
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

app.get('/demo/history', (req, res) => {
  res.json({ conversation: getSession(req.headers['x-session-id'] || 'default') })
})

app.post('/demo/reset', (req, res) => {
  sessions.delete(req.headers['x-session-id'] || 'default')
  res.json({ ok: true })
})

app.get('/demo/track/:orderId', (req, res) => {
  const status = getMockOrderStatus(req.params.orderId)
  if (!status) return res.status(404).json({ error: 'Order not found' })
  res.json(status)
})

// Update a cart item's quantity — routes through the provider layer (MCP-aware)
app.patch('/demo/cart/:type/item/:itemId', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default'
  const type      = req.params.type === 'food' ? 'food' : 'grocery'
  const qty       = Number(req.body.qty)
  if (!Number.isFinite(qty)) return res.status(400).json({ error: 'qty must be a number' })
  const tool = qty <= 0 ? 'remove_from_cart' : 'update_cart_item'
  const args = qty <= 0
    ? { type, item_id: req.params.itemId }
    : { type, item_id: req.params.itemId, quantity: qty }
  await executeTool(tool, args, { ...DEMO_CONTEXT, sessionId })
  const result = await executeTool('get_cart', { type }, { ...DEMO_CONTEXT, sessionId })
  res.json(cartCardFromResult(result) ?? { empty: true })
})

// Remove a cart item — routes through the provider layer (MCP-aware)
app.delete('/demo/cart/:type/item/:itemId', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default'
  const type      = req.params.type === 'food' ? 'food' : 'grocery'
  await executeTool('remove_from_cart', { type, item_id: req.params.itemId }, { ...DEMO_CONTEXT, sessionId })
  const result = await executeTool('get_cart', { type }, { ...DEMO_CONTEXT, sessionId })
  res.json(cartCardFromResult(result) ?? { empty: true })
})

// Returns the live cart for a session (food or grocery) as a cart card object
app.get('/demo/cart/:type', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default'
  const type      = req.params.type === 'food' ? 'food' : 'grocery'
  try {
    const result = await executeTool('get_cart', { type }, { ...DEMO_CONTEXT, sessionId })
    const card   = cartCardFromResult(result)
    res.json(card ?? { empty: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/demo',  (req, res) => res.send(DEMO_HTML))
app.get('/demo2', (req, res) => res.send(DEMO2_HTML))

// ── HTML ──────────────────────────────────────────────────────────────────────
const DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vorel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --cream: #f5f0e8;
  --cream2: #ede8df;
  --ink: #1a1a1a;
  --ink2: #4a4a4a;
  --ink3: #8a8a8a;
  --white: #ffffff;
  --border: rgba(0,0,0,0.08);
  --radius: 20px;
}

body {
  font-family: 'DM Sans', -apple-system, sans-serif;
  background: var(--cream);
  height: 100dvh;
  display: flex;
  flex-direction: column;
  max-width: 430px;
  margin: 0 auto;
  color: var(--ink);
  overflow: hidden;
}

/* ── Header ── */
header {
  flex-shrink: 0;
  padding: 16px 20px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--cream);
}
.logo { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.header-right { display: flex; align-items: center; gap: 8px; }
.demo-pill { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: var(--cream2); color: var(--ink3); padding: 3px 10px; border-radius: 20px; border: 1px solid var(--border); }
#muteBtn { width: 32px; height: 32px; border-radius: 50%; background: var(--cream2); border: 1px solid var(--border); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--ink2); }
#muteBtn.muted { opacity: 0.4; }
#restart { font-size: 12px; color: var(--ink3); background: none; border: none; cursor: pointer; padding: 4px; }
#restart:hover { color: var(--ink); }

/* ── Messages — the only scrollable area ── */
#messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Chat bubbles ── */
.msg { font-size: 15px; line-height: 1.5; white-space: pre-wrap; max-width: 82%; }
.msg.user { align-self: flex-end; background: var(--ink); color: var(--white); padding: 10px 16px; border-radius: var(--radius) var(--radius) 4px var(--radius); }
.msg.assistant { align-self: flex-start; background: var(--white); color: var(--ink); padding: 10px 16px; border-radius: 4px var(--radius) var(--radius) var(--radius); border: 1px solid var(--border); }
.msg.typing { color: var(--ink3); font-size: 20px; letter-spacing: 2px; }

/* ── Recipe row (inline in chat) ── */
.recipe-row {
  align-self: stretch;
  width: calc(100% + 40px);
  margin-left: -20px;
  display: flex;
  overflow-x: auto;
  gap: 12px;
  padding: 2px 20px 10px;
  scrollbar-width: none;
}
.recipe-row::-webkit-scrollbar { display: none; }

.recipe-card {
  flex-shrink: 0;
  width: 220px;
  background: var(--white);
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: transform 0.18s, box-shadow 0.18s, opacity 0.2s;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.recipe-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.11); }
.recipe-card.selected { border-color: var(--ink); box-shadow: 0 0 0 2px var(--ink); }
.recipe-card.dimmed { opacity: 0.25; pointer-events: none; }

.recipe-thumb {
  width: 100%; height: 140px;
  background: var(--cream2);
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  font-size: 44px;
}
.recipe-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.recipe-thumb-overlay {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 28px 12px 10px;
  background: linear-gradient(to top, rgba(0,0,0,0.5), transparent);
}
.recipe-thumb-overlay span { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 700; color: white; }
.recipe-thumb-badge {
  position: absolute; top: 8px; right: 8px;
  background: var(--ink); color: white;
  font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 20px;
}

.recipe-body { padding: 10px 12px 12px; }
.recipe-channel { font-size: 11px; color: var(--ink3); margin-bottom: 3px; }
.recipe-reason { font-size: 12px; color: var(--ink2); line-height: 1.35; margin-bottom: 10px; }
.recipe-actions { display: flex; gap: 6px; }
.rbtn {
  flex: 1; padding: 8px 0; border-radius: 10px;
  font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
  border: none; cursor: pointer; transition: background 0.15s;
}
.rbtn.skip { background: var(--cream2); color: var(--ink2); border: 1px solid var(--border); }
.rbtn.cook { background: var(--ink); color: white; }

/* ── Cart card (inline in chat) ── */
.cart-card {
  align-self: flex-start;
  width: 96%;
  background: var(--white);
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 4px 18px rgba(0,0,0,0.08);
}
.cart-head {
  padding: 14px 16px 12px;
  display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid var(--border);
}
.cart-icon { width: 34px; height: 34px; border-radius: 10px; background: var(--cream); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
.cart-title { font-size: 14px; font-weight: 600; }
.cart-subtitle { font-size: 11px; color: var(--ink3); margin-top: 1px; }

.cart-items { padding: 4px 0; }
.cart-item { display: flex; align-items: center; padding: 8px 16px; gap: 10px; }
.cart-qty { width: 22px; height: 22px; border-radius: 7px; background: var(--cream); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.cart-name { flex: 1; font-size: 13px; }
.cart-price { font-size: 13px; font-weight: 600; flex-shrink: 0; }

.cart-divider { height: 1px; background: var(--border); margin: 0 16px; }
.cart-totals { padding: 8px 16px; }
.cart-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink3); padding: 3px 0; }
.cart-row.grand { font-size: 15px; font-weight: 700; color: var(--ink); padding-top: 8px; margin-top: 5px; border-top: 1px solid var(--border); }
.free-tag { font-size: 10px; font-weight: 700; color: #16a34a; background: #dcfce7; padding: 1px 6px; border-radius: 8px; }

.cart-actions { display: flex; gap: 8px; padding: 12px 16px 14px; }
.cart-btn {
  flex: 1; padding: 11px 0; border-radius: 13px;
  font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
  border: none; cursor: pointer; transition: all 0.15s;
}
.cart-btn.edit { background: var(--cream2); color: var(--ink2); border: 1px solid var(--border); flex: 0 0 80px; }
.cart-btn.place { background: var(--ink); color: white; }
.cart-btn.place:hover { background: #333; }
.cart-btn:disabled { opacity: 0.5; cursor: default; }

/* ── Cart edit controls ── */
.cart-controls { display: none; align-items: center; gap: 3px; flex-shrink: 0; }
.cart-card.editing .cart-controls { display: flex; }
.cart-card.editing .cart-qty { display: none; }
.ctrl-btn {
  width: 26px; height: 26px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--cream);
  font-size: 14px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--ink2); line-height: 1; padding: 0;
  font-family: 'DM Sans', sans-serif; transition: background 0.1s;
}
.ctrl-btn:active { background: var(--cream2); }
.ctrl-btn.del { background: #fff0f0; border-color: #fecaca; color: #e53e3e; font-size: 11px; }
.ctrl-qty { width: 20px; text-align: center; font-size: 13px; font-weight: 700; }

/* ── Order card (inline in chat) ── */
.order-card {
  align-self: flex-start;
  width: 88%;
  background: var(--ink);
  border-radius: 18px;
  overflow: hidden;
  color: white;
}
.order-top { padding: 16px 18px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.order-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; margin-bottom: 3px; }
.order-title { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; }
.order-body { padding: 14px 18px; }
.order-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
.order-row:last-of-type { border-bottom: none; }
.order-row .k { opacity: 0.55; }
.order-row .v { font-weight: 600; }
.order-track-btn { width: 100%; margin-top: 12px; padding: 11px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 11px; color: white; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; }
.order-track-btn:hover { background: rgba(255,255,255,0.2); }

/* ── Tracking card (inline in chat) ── */
.tracking-card {
  align-self: flex-start;
  width: 90%;
  background: var(--white);
  border-radius: 18px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.track-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.track-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink3); margin-bottom: 3px; }
.track-stage { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; }
.track-eta { font-size: 12px; font-weight: 600; background: var(--cream2); color: var(--ink); padding: 4px 11px; border-radius: 20px; border: 1px solid var(--border); white-space: nowrap; }
.track-dots { display: flex; align-items: center; margin-bottom: 14px; }
.tdot { width: 9px; height: 9px; border-radius: 50%; background: var(--cream2); border: 2px solid var(--border); flex-shrink: 0; }
.tdot.done { background: var(--ink); border-color: var(--ink); }
.tdot.active { background: white; border-color: var(--ink); border-width: 2.5px; box-shadow: 0 0 0 3px rgba(0,0,0,0.08); }
.tline { flex: 1; height: 1.5px; background: var(--cream2); margin: 0 3px; }
.tline.done { background: var(--ink); }
.track-msg { font-size: 12px; color: var(--ink2); margin-bottom: 10px; line-height: 1.4; }
.rider-pill { display: flex; align-items: center; gap: 9px; background: var(--cream); border-radius: 12px; padding: 9px 12px; }
.rider-av { width: 30px; height: 30px; border-radius: 50%; background: var(--ink); color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
.rider-name { font-weight: 600; font-size: 12px; }
.rider-rating { font-size: 11px; color: var(--ink3); }

/* ── Footer ── */
footer {
  flex-shrink: 0;
  padding: 10px 20px 24px;
  background: var(--cream);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
#recipeChip {
  display: none;
  align-items: center;
  gap: 10px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 7px 14px 7px 8px;
}
#recipeChip.on { display: flex; }
.chip-thumb {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--cream2);
  background-size: cover; background-position: center;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
  border: 1px solid var(--border);
}
.chip-info { min-width: 0; flex: 1; }
.chip-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink3); }
.chip-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.input-wrap {
  display: flex; align-items: center;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 26px;
  padding: 4px 4px 4px 16px;
  gap: 8px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.05);
}
#input {
  flex: 1; background: none; border: none; outline: none;
  font-family: 'DM Sans', sans-serif; font-size: 15px; color: var(--ink);
  resize: none; max-height: 100px; line-height: 1.4;
}
#input::placeholder { color: var(--ink3); font-style: italic; }
#input:disabled { opacity: 0.5; }
#send {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--ink); color: white;
  border: none; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
#send:disabled { background: var(--cream2); cursor: default; }
#mic {
  align-self: center; background: none; border: none;
  font-size: 12px; color: var(--ink3); cursor: pointer;
  display: flex; align-items: center; gap: 6px;
}
.mic-icon { width: 26px; height: 26px; border-radius: 50%; background: var(--cream2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 12px; }
#mic.recording .mic-icon { background: #fee2e2; border-color: #ef4444; }
#mic.recording { color: #ef4444; }
</style>
</head>
<body>

<header>
  <span class="logo">Vorel</span>
  <div class="header-right">
    <span class="demo-pill">Demo</span>
    <button id="muteBtn">🔊</button>
    <button id="restart">✕ reset</button>
  </div>
</header>

<div id="messages"></div>

<footer>
  <div id="recipeChip">
    <div id="chipThumb" class="chip-thumb">🍽</div>
    <div class="chip-info">
      <div class="chip-lbl">Cooking tonight</div>
      <div id="chipName" class="chip-name">—</div>
    </div>
  </div>
  <div class="input-wrap">
    <textarea id="input" rows="1" placeholder="Talk to Vorel"></textarea>
    <button id="send">↑</button>
  </div>
  <button id="mic"><span class="mic-icon">🎤</span> Tap to speak</button>
</footer>

<script>
  const SESSION_ID  = 'demo-' + Math.random().toString(36).slice(2, 8)
  const g           = id => document.getElementById(id)
  const messagesEl  = g('messages')
  const inputEl     = g('input')
  const sendBtn     = g('send')
  const micBtn      = g('mic')
  const muteBtn     = g('muteBtn')
  const chipEl      = g('recipeChip')
  const chipNameEl  = g('chipName')
  const chipThumbEl = g('chipThumb')

  // ── Scroll (one rule: always scroll to bottom after any append) ──────────
  const scrollBottom = () => requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight
  })

  // ── Escape ────────────────────────────────────────────────────────────────
  const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const getMessageText = c => typeof c === 'string' ? c : (Array.isArray(c) ? c.find(b => b.type==='text')?.text ?? null : null)

  // ── TTS ───────────────────────────────────────────────────────────────────
  const synth = window.speechSynthesis
  let ttsOn = !!synth, voices = [], speakingEl = null
  if (synth) { const lv = () => { voices = synth.getVoices() }; lv(); synth.onvoiceschanged = lv }
  const pickVoice = () => voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en')) || null
  function speak(text, el, cb) {
    if (!ttsOn || !synth) { cb?.(); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/\\n+/g, '. ').replace(/\\*/g, ''))
    const v = pickVoice(); if (v) u.voice = v
    u.lang = 'en-IN'; u.rate = 1.05
    speakingEl = el; el?.classList.add('speaking')
    u.onend = u.onerror = () => { el?.classList.remove('speaking'); speakingEl = null; cb?.() }
    synth.speak(u)
  }
  function stopSpeaking() { synth?.cancel(); speakingEl?.classList.remove('speaking'); speakingEl = null }
  muteBtn.onclick = () => {
    ttsOn = !ttsOn
    muteBtn.textContent = ttsOn ? '🔊' : '🔇'
    muteBtn.classList.toggle('muted', !ttsOn)
    if (!ttsOn) stopSpeaking()
  }

  // ── Bubble ────────────────────────────────────────────────────────────────
  function addBubble(text, role, opts = {}) {
    const div = document.createElement('div')
    div.className = 'msg ' + role
    div.innerHTML = role === 'typing' ? '•••' : esc(text).replace(/\\n/g,'<br>')
    if (role === 'assistant' && opts.speak !== false) {
      speak(text, div, () => { if (ttsOn && SR && !listening) autoListen() })
    }
    messagesEl.appendChild(div)
    scrollBottom()
    return div
  }

  // ── Recipe chip (footer) ──────────────────────────────────────────────────
  function showChip(r) {
    chipNameEl.textContent = r.name
    if (r.thumbnail_url) {
      chipThumbEl.style.backgroundImage = \`url('\${r.thumbnail_url}')\`
      chipThumbEl.textContent = ''
    } else {
      chipThumbEl.style.backgroundImage = ''
      chipThumbEl.textContent = r.emoji ?? '🍽'
    }
    chipEl.classList.add('on')
  }
  function hideChip() { chipEl.classList.remove('on') }

  // ── Recipe cards ──────────────────────────────────────────────────────────
  function renderRecipes(recipes) {
    // Remove any previous recipe row (new search replaces old)
    document.querySelectorAll('.recipe-row').forEach(el => el.remove())

    const row = document.createElement('div')
    row.className = 'recipe-row'

    recipes.forEach(r => {
      const card = document.createElement('div')
      card.className = 'recipe-card'
      const thumb = r.thumbnail_url
        ? \`<img src="\${esc(r.thumbnail_url)}" loading="lazy" onerror="this.style.display='none'">\`
        : \`<span>\${r.emoji ?? '🍽'}</span>\`
      const bg = r.thumbnail_url ? '' : \` style="background:linear-gradient(160deg,\${r.grad ?? '#555,#333'})"\`
      card.innerHTML = \`
        <div class="recipe-thumb"\${bg}>
          \${thumb}
          <div class="recipe-thumb-overlay"><span>\${esc(r.name)}</span></div>
        </div>
        <div class="recipe-body">
          <div class="recipe-channel">\${esc(r.channel ?? '')} · \${r.cook_time_mins}min · \${esc(r.views ?? '')}</div>
          <div class="recipe-reason">\${esc(r.reason ?? '')}</div>
          <div class="recipe-actions">
            <button class="rbtn skip">Skip</button>
            <button class="rbtn cook">Cook this</button>
          </div>
        </div>
      \`
      const pick = () => {
        if (row.dataset.picked) return
        row.dataset.picked = '1'
        card.classList.add('selected')
        card.querySelector('.recipe-thumb').insertAdjacentHTML('beforeend','<div class="recipe-thumb-badge">✓</div>')
        row.querySelectorAll('.recipe-card:not(.selected)').forEach(c => c.classList.add('dimmed'))
        showChip(r)
        setTimeout(() => send("Let's make " + r.name), 300)
      }
      card.querySelector('.rbtn.cook').onclick = e => { e.stopPropagation(); pick() }
      card.querySelector('.rbtn.skip').onclick  = e => { e.stopPropagation(); card.classList.add('dimmed') }
      card.onclick = pick
      row.appendChild(card)
    })

    messagesEl.appendChild(row)
    scrollBottom()
    return row
  }

  // ── Cart card ─────────────────────────────────────────────────────────────
  function renderCart(c, editMode = false) {
    document.querySelectorAll('.cart-card').forEach(el => el.remove())
    const isGrocery = !c.restaurant_name
    const cartType  = isGrocery ? 'grocery' : 'food'
    const title     = c.restaurant_name || 'Your groceries'
    const count     = c.item_count ?? c.items.length
    const delivHTML = c.delivery_fee === 0
      ? '<span class="free-tag">FREE</span>'
      : \`₹\${c.delivery_fee}\`

    const itemsHTML = c.items.map(i => {
      const qty   = i.quantity ?? 1
      const amt   = i.subtotal ?? (i.price * qty)
      const id    = esc(i.id ?? '')
      return \`
        <div class="cart-item" data-id="\${id}">
          <div class="cart-qty">\${qty}</div>
          <div class="cart-controls">
            <button class="ctrl-btn minus">−</button>
            <span class="ctrl-qty">\${qty}</span>
            <button class="ctrl-btn plus">+</button>
            <button class="ctrl-btn del">✕</button>
          </div>
          <div class="cart-name">\${esc(i.name)}</div>
          <div class="cart-price">₹\${amt}</div>
        </div>\`
    }).join('')

    const div = document.createElement('div')
    div.className = 'cart-card' + (editMode ? ' editing' : '')
    div.innerHTML = \`
      <div class="cart-head">
        <div class="cart-icon">\${isGrocery ? '🛒' : '🍽'}</div>
        <div><div class="cart-title">\${esc(title)}</div><div class="cart-subtitle">\${count} item\${count!==1?'s':''} · Review order</div></div>
      </div>
      <div class="cart-items">\${itemsHTML}</div>
      <div class="cart-divider"></div>
      <div class="cart-totals">
        <div class="cart-row"><span>Subtotal</span><span>₹\${c.subtotal}</span></div>
        <div class="cart-row"><span>Delivery</span><span>\${delivHTML}</span></div>
        <div class="cart-row"><span>Taxes</span><span>₹\${c.taxes}</span></div>
        <div class="cart-row grand"><span>Total</span><span>₹\${c.total}</span></div>
      </div>
      <div class="cart-actions">
        <button class="cart-btn edit">\${editMode ? 'Done' : 'Edit'}</button>
        <button class="cart-btn place" \${editMode ? 'disabled' : ''}>Place order →</button>
      </div>
    \`

    // Edit / Done toggle
    div.querySelector('.cart-btn.edit').onclick = () => renderCart(c, !editMode)

    // Place order (disabled in edit mode)
    if (!editMode) {
      div.querySelector('.cart-btn.place').onclick = () => {
        div.querySelector('.cart-btn.place').disabled = true
        div.querySelector('.cart-btn.place').textContent = 'Placing…'
        send('Yes, place the order')
      }
    }

    // Row-level edit controls
    const apiFetch = async (url, opts = {}) => {
      const r = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'x-session-id': SESSION_ID, ...(opts.headers || {}) },
      })
      return r.json()
    }

    div.querySelectorAll('.cart-item[data-id]').forEach(row => {
      const id = row.dataset.id
      if (!id) return
      const qtyEl = row.querySelector('.ctrl-qty')

      row.querySelector('.ctrl-btn.minus').onclick = async () => {
        const next = parseInt(qtyEl.textContent) - 1
        const updated = next <= 0
          ? await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'DELETE' })
          : await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: JSON.stringify({ qty: next }) })
        if (updated && !updated.empty && updated.items?.length) renderCart(updated, true)
        else document.querySelectorAll('.cart-card').forEach(el => el.remove())
      }

      row.querySelector('.ctrl-btn.plus').onclick = async () => {
        const next = parseInt(qtyEl.textContent) + 1
        const updated = await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: JSON.stringify({ qty: next }) })
        if (updated && !updated.empty && updated.items?.length) renderCart(updated, true)
      }

      row.querySelector('.ctrl-btn.del').onclick = async () => {
        row.style.opacity = '0.35'
        const updated = await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'DELETE' })
        if (updated && !updated.empty && updated.items?.length) renderCart(updated, true)
        else document.querySelectorAll('.cart-card').forEach(el => el.remove())
      }
    })

    messagesEl.appendChild(div)
    scrollBottom()
    return div
  }

  // ── Order card ────────────────────────────────────────────────────────────
  function renderOrder(c) {
    document.querySelectorAll('.cart-card').forEach(el => el.remove())
    hideChip()
    const icon = c.order_type === 'food' ? '🍔' : '🛒'
    const div  = document.createElement('div')
    div.className = 'order-card'
    div.innerHTML = \`
      <div class="order-top">
        <div class="order-label">Order confirmed</div>
        <div class="order-title">On its way ✦</div>
      </div>
      <div class="order-body">
        <div class="order-row"><span class="k">Order ID</span><span class="v" style="font-size:11px;font-family:monospace">\${esc(c.order_id)}</span></div>
        <div class="order-row"><span class="k">\${icon} Items</span><span class="v">\${c.item_count} items</span></div>
        <div class="order-row"><span class="k">Total</span><span class="v">₹\${c.total}</span></div>
        <div class="order-row"><span class="k">ETA</span><span class="v">\${esc(c.estimated_delivery)}</span></div>
        <button class="order-track-btn">📍 Track live</button>
      </div>
    \`
    div.querySelector('.order-track-btn').onclick = () => renderTracking(c.order_id)
    messagesEl.appendChild(div)
    scrollBottom()
    return div
  }

  // ── Tracking card ─────────────────────────────────────────────────────────
  const STAGES      = ['placed','confirmed','preparing','out_for_delivery','delivered']
  const STAGE_NAMES = ['Placed','Confirmed','Preparing','On the way','Delivered']

  function renderTracking(orderId) {
    const div = document.createElement('div')
    div.className = 'tracking-card'
    messagesEl.appendChild(div)
    scrollBottom()
    let timer = null

    async function tick() {
      try {
        const data = await fetch('/demo/track/' + orderId, { headers: { 'x-session-id': SESSION_ID } }).then(r => r.json())
        if (data.error) { div.innerHTML = '<p style="color:var(--ink3);font-size:13px">Tracking unavailable.</p>'; return }
        const idx = STAGES.indexOf(data.stage)
        let dots = ''
        STAGES.forEach((_, i) => {
          if (i > 0) dots += \`<div class="tline \${i<=idx?'done':''}"></div>\`
          dots += \`<div class="tdot \${i<idx?'done':i===idx?'active':''}"></div>\`
        })
        div.innerHTML = \`
          <div class="track-top">
            <div><div class="track-lbl">Live tracking</div><div class="track-stage">\${STAGE_NAMES[idx]}</div></div>
            \${data.eta_mins > 0 ? \`<span class="track-eta">⏱ \${data.eta_mins} min</span>\` : '<span class="track-eta">✓ Done</span>'}
          </div>
          <div class="track-dots">\${dots}</div>
          <div class="track-msg">\${esc(data.message)}</div>
          \${data.rider ? \`<div class="rider-pill"><div class="rider-av">\${data.rider.name[0]}</div><div><div class="rider-name">\${esc(data.rider.name)}</div><div class="rider-rating">★ \${data.rider.rating} · Delivery partner</div></div></div>\` : ''}
        \`
        scrollBottom()
        if (data.stage === 'delivered' && timer) { clearInterval(timer); timer = null }
      } catch(e) { console.error(e) }
    }
    tick()
    timer = setInterval(tick, 10000)
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  function setLoading(on) { sendBtn.disabled = on; inputEl.disabled = on }

  async function send(text) {
    text = text.trim()
    if (!text) return
    if (ttsOn && synth) { synth.speak(Object.assign(new SpeechSynthesisUtterance(''), { volume: 0 })); synth.cancel() }
    stopSpeaking()
    addBubble(text, 'user')
    inputEl.value = ''; inputEl.style.height = 'auto'
    setLoading(true)
    const typingBubble = addBubble('', 'typing')

    try {
      const res  = await fetch('/demo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': SESSION_ID },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      typingBubble.remove()

      if (data.reply) addBubble(data.reply, 'assistant')
      else            addBubble(data.error || 'Something went wrong.', 'assistant')

      const cards = data.cards ?? (data.card ? [data.card] : [])
      console.log('[vorel] cards:', cards.map(c => c.type))

      let hasCart = false
      for (const card of cards) {
        if (card.type === 'recipes') renderRecipes(card.recipes)
        if (card.type === 'cart')    { renderCart(card); hasCart = true }
        if (card.type === 'order')   {
          renderOrder(card)
          setTimeout(() => renderTracking(card.order_id), 1800)
        }
      }

      // Fallback: if reply asks to place order but no cart card came, fetch it
      if (!hasCart && data.reply) {
        const low = data.reply.toLowerCase()
        if (low.includes('ready to place') || low.includes("here's your cart") || low.includes('place the order')) {
          const cartType = chipEl.classList.contains('on') ? 'grocery' : 'food'
          console.log('[vorel] fallback cart fetch:', cartType)
          const cartData = await fetch(\`/demo/cart/\${cartType}\`, { headers: { 'x-session-id': SESSION_ID } }).then(r => r.json())
          if (cartData && !cartData.empty && !cartData.error) renderCart(cartData)
        }
      }
    } catch(e) {
      typingBubble.remove()
      addBubble('Something went wrong. Try again.', 'assistant')
    }

    setLoading(false)
    inputEl.focus()
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px'
  })
  sendBtn.onclick   = () => { stopSpeaking(); send(inputEl.value) }
  inputEl.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopSpeaking(); send(inputEl.value) } }

  g('restart').onclick = async () => {
    if (!confirm('Start over?')) return
    stopSpeaking()
    await fetch('/demo/reset', { method: 'POST', headers: { 'x-session-id': SESSION_ID } })
    messagesEl.innerHTML = ''
    hideChip()
    init()
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  let listening = false, autoListen = () => {}

  if (SR) {
    const rec = new SR()
    rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = true
    autoListen = () => {
      if (listening) return
      setTimeout(() => { if (!listening) { stopSpeaking(); rec.start(); micBtn.className = 'recording'; listening = true } }, 400)
    }
    micBtn.onclick  = () => { if (listening) rec.stop(); else { stopSpeaking(); rec.start(); micBtn.className = 'recording'; listening = true } }
    rec.onresult    = e => { inputEl.value = Array.from(e.results).map(r => r[0].transcript).join(''); inputEl.style.height = 'auto'; inputEl.style.height = inputEl.scrollHeight + 'px' }
    rec.onend       = () => { listening = false; micBtn.className = ''; if (inputEl.value.trim()) send(inputEl.value) }
    rec.onerror     = () => { listening = false; micBtn.className = '' }
  } else { micBtn.style.display = 'none' }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const hist = await fetch('/demo/history', { headers: { 'x-session-id': SESSION_ID } }).then(r => r.json())
    if (hist.conversation?.length) {
      hist.conversation.forEach(m => { const t = getMessageText(m.content); if (t) addBubble(t, m.role, { speak: false }) })
    } else {
      const gr = await fetch('/demo/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': SESSION_ID }, body: JSON.stringify({ message: '__init__' }) }).then(r => r.json())
      if (gr.reply) addBubble(gr.reply, 'assistant')
    }
    inputEl.focus()
  }

  init()
</script>
</body>
</html>`

// ── Demo 2 — clean rewrite ────────────────────────────────────────────────────
const DEMO2_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vorel</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f5f0e8;
  --surface:#ffffff;
  --surface-2:#ede8df;
  --ink:#1a1a1a;
  --muted:#6f6a63;
  --line:rgba(26,26,26,.1);
}
html,body{height:100%}
body{
  font-family:'DM Sans',sans-serif;
  background:var(--bg);
  color:var(--ink);
}
.app{
  width:min(100%,430px);
  min-height:100dvh;
  margin:0 auto;
  display:flex;
  flex-direction:column;
  background:var(--bg);
}
header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:16px 20px 12px;
}
.logo{font-family:'Playfair Display',serif;font-size:22px}
.hdr-r{display:flex;gap:10px;align-items:center}
.pill{
  font-size:10px;
  font-weight:600;
  letter-spacing:.08em;
  text-transform:uppercase;
  background:var(--surface-2);
  color:var(--muted);
  padding:4px 10px;
  border:1px solid var(--line);
  border-radius:999px;
}
#restartBtn{
  border:none;
  background:none;
  color:var(--muted);
  font-size:12px;
  cursor:pointer;
}
#chat{
  flex:1;
  padding:8px 16px 120px;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.msg{
  max-width:84%;
  padding:12px 14px;
  border-radius:20px;
  font-size:15px;
  line-height:1.5;
  white-space:pre-wrap;
}
.msg.bot{
  align-self:flex-start;
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:6px 20px 20px 20px;
}
.msg.user{
  align-self:flex-end;
  background:var(--ink);
  color:var(--surface);
  border-radius:20px 20px 6px 20px;
}
.msg.typing{
  align-self:flex-start;
  background:none;
  border:none;
  color:var(--muted);
  padding:4px 2px;
  letter-spacing:2px;
}
.stack{
  width:100%;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.card{
  width:100%;
  align-self:stretch;
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:18px;
  overflow:hidden;
}
.recipe-card{padding:12px}
.recipe-top{display:block}
.recipe-copy{min-width:0}
.recipe-name{font-size:15px;font-weight:600}
.recipe-meta{margin-top:4px;font-size:12px;color:var(--muted)}
.recipe-reason{margin-top:8px;font-size:13px;line-height:1.45;color:#37332e}
.actions{
  display:flex;
  gap:8px;
  margin-top:12px;
}
.btn{
  border:none;
  border-radius:12px;
  padding:10px 12px;
  font-family:'DM Sans',sans-serif;
  font-size:13px;
  font-weight:600;
  cursor:pointer;
}
.btn.secondary{
  background:var(--surface-2);
  color:#47413b;
  border:1px solid var(--line);
}
.btn.primary{
  background:var(--ink);
  color:var(--surface);
}
.recipe-card.is-dim{opacity:.45}
.recipe-card.is-picked{border-color:var(--ink)}
.section-title{
  padding:12px 14px 0;
  font-size:12px;
  font-weight:600;
  letter-spacing:.06em;
  text-transform:uppercase;
  color:var(--muted);
}
.cart-body,.order-body,.track-body{padding:12px 14px 14px}
.cart-head,.order-head,.track-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}
.headline{font-size:16px;font-weight:600}
.subline{margin-top:3px;font-size:12px;color:var(--muted)}
.pill-mini{
  background:var(--surface-2);
  border:1px solid var(--line);
  border-radius:999px;
  padding:4px 8px;
  font-size:11px;
  font-weight:600;
  color:#47413b;
  white-space:nowrap;
}
.cart-item,.order-row{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:8px 0;
  font-size:14px;
}
.cart-item + .cart-item,.order-row + .order-row{border-top:1px solid var(--line)}
.cart-name{flex:1}
.cart-name small{display:block;margin-top:2px;color:var(--muted)}
.cart-total{
  margin-top:10px;
  padding-top:10px;
  border-top:1px solid var(--line);
  display:flex;
  flex-direction:column;
  gap:6px;
}
.total-row{
  display:flex;
  justify-content:space-between;
  font-size:13px;
  color:var(--muted);
}
.total-row.grand{font-size:15px;font-weight:700;color:var(--ink)}
.track-steps{
  display:grid;
  gap:8px;
  margin:12px 0;
}
.track-step{
  display:flex;
  gap:10px;
  align-items:flex-start;
  font-size:13px;
  color:#37332e;
}
.track-dot{
  width:10px;
  height:10px;
  border-radius:50%;
  margin-top:5px;
  flex-shrink:0;
  background:#d7d0c5;
}
.track-step.done .track-dot,.track-step.active .track-dot{background:var(--ink)}
.track-step span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
footer{
  position:sticky;
  bottom:0;
  padding:10px 16px calc(16px + env(safe-area-inset-bottom,0px));
  background:var(--bg);
  border-top:1px solid rgba(26,26,26,.06);
}
.composer{
  display:flex;
  align-items:flex-end;
  gap:8px;
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:24px;
  padding:6px;
}
#inp{
  flex:1;
  border:none;
  outline:none;
  background:none;
  resize:none;
  padding:8px 10px;
  font-family:'DM Sans',sans-serif;
  font-size:15px;
  line-height:1.4;
  max-height:120px;
  color:var(--ink);
}
#inp::placeholder{color:#9a948c;font-style:italic}
#snd{
  width:38px;
  height:38px;
  border:none;
  border-radius:50%;
  background:var(--ink);
  color:var(--surface);
  font-size:16px;
  cursor:pointer;
  flex-shrink:0;
}
#snd:disabled{background:#c7c0b7;cursor:default}

/* ── Cart edit controls (demo2) ── */
.cart-controls2{display:none;align-items:center;gap:3px;flex-shrink:0}
.cart-card.editing .cart-controls2{display:flex}
.cart-card.editing .cart-qty2{display:none}
.cbtn{
  width:26px;height:26px;border-radius:8px;
  border:1px solid var(--line);background:var(--surface-2);
  font-size:14px;font-weight:700;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:#47413b;line-height:1;padding:0;
  font-family:'DM Sans',sans-serif;
}
.cbtn.del{background:#fff0f0;border-color:#fecaca;color:#e53e3e;font-size:11px}
.cqty{width:20px;text-align:center;font-size:13px;font-weight:700}
</style>
</head>
<body>
<div class="app">
  <header>
    <span class="logo">Vorel</span>
    <div class="hdr-r">
      <span class="pill">Demo</span>
      <button id="restartBtn">✕ reset</button>
    </div>
  </header>

  <main id="chat"></main>

  <footer>
    <div class="composer">
      <textarea id="inp" rows="1" placeholder="Talk to Vorel"></textarea>
      <button id="snd">↑</button>
    </div>
  </footer>
</div>

<script>
const SID = 's' + Math.random().toString(36).slice(2,9)
const chat = document.getElementById('chat')
const inp = document.getElementById('inp')
const snd = document.getElementById('snd')

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const api = (path, opts) => fetch(path, { ...opts, headers: { 'Content-Type':'application/json', 'x-session-id':SID, ...(opts?.headers||{}) } })

function scrollChatToBottom(target) {
  const sync = () => {
    if (target?.scrollIntoView) target.scrollIntoView({ block: 'start', inline: 'nearest' })
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
  }
  requestAnimationFrame(() => {
    sync()
    setTimeout(sync, 40)
    setTimeout(sync, 140)
  })
}

function bubble(text, cls) {
  const node = document.createElement('div')
  node.className = 'msg ' + cls
  node.textContent = cls === 'typing' ? '•  •  •' : text
  chat.appendChild(node)
  scrollChatToBottom(node)
  return node
}

function appendBlock(node) {
  chat.appendChild(node)
  scrollChatToBottom(node)
  return node
}

function showRecipes(recipes) {
  const stack = document.createElement('div')
  stack.className = 'stack'

  recipes.forEach(recipe => {
    const card = document.createElement('section')
    card.className = 'card recipe-card'
    card.innerHTML = \`
      <div class="recipe-top">
        <div class="recipe-copy">
          <div class="recipe-name">\${esc(recipe.name)}</div>
          <div class="recipe-meta">\${esc(recipe.channel || '')}\${recipe.cook_time_mins ? ' · ' + recipe.cook_time_mins + ' min' : ''}\${recipe.views ? ' · ' + esc(recipe.views) : ''}</div>
          <div class="recipe-reason">\${esc(recipe.reason || '')}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" type="button">Skip</button>
        <button class="btn primary" type="button">Cook this</button>
      </div>
    \`

    const pick = () => {
      if (stack.dataset.done) return
      stack.dataset.done = '1'
      card.classList.add('is-picked')
      stack.querySelectorAll('.recipe-card').forEach(other => {
        if (other !== card) other.classList.add('is-dim')
      })
      send("Let's make " + recipe.name)
    }

    card.querySelector('.btn.primary').addEventListener('click', pick)
    card.querySelector('.btn.secondary').addEventListener('click', () => {
      if (!stack.dataset.done) card.classList.add('is-dim')
    })
    stack.appendChild(card)
  })

  appendBlock(stack)
}

function showCart(card, editMode = false) {
  // Remove any existing cart card and re-render (keeps a single live card)
  document.querySelectorAll('.cart-card').forEach(el => el.remove())

  const count    = card.item_count ?? card.items.length
  const cartType = card.restaurant_name ? 'food' : 'grocery'

  const itemRows = card.items.map(item => {
    const qty     = item.quantity ?? 1
    const subtotal = item.subtotal ?? (item.price * qty)
    const id      = esc(item.id ?? '')
    return \`
      <div class="cart-item" data-id="\${id}">
        <div class="cart-qty2"><small>×\${qty}</small></div>
        <div class="cart-controls2">
          <button class="cbtn minus" type="button">−</button>
          <span class="cqty">\${qty}</span>
          <button class="cbtn plus" type="button">+</button>
          <button class="cbtn del" type="button">✕</button>
        </div>
        <div class="cart-name">\${esc(item.name)}</div>
        <div>₹\${subtotal}</div>
      </div>
    \`
  }).join('')

  const node = document.createElement('section')
  node.className = 'card cart-card' + (editMode ? ' editing' : '')
  node.innerHTML = \`
    <div class="section-title">Cart</div>
    <div class="cart-body">
      <div class="cart-head">
        <div>
          <div class="headline">\${esc(card.restaurant_name || 'Your groceries')}</div>
          <div class="subline">\${count} item\${count !== 1 ? 's' : ''} ready to review</div>
        </div>
      </div>
      \${itemRows}
      <div class="cart-total">
        <div class="total-row"><span>Subtotal</span><span>₹\${card.subtotal}</span></div>
        <div class="total-row"><span>Delivery</span><span>₹\${card.delivery_fee}</span></div>
        <div class="total-row"><span>Taxes</span><span>₹\${card.taxes}</span></div>
        <div class="total-row grand"><span>Total</span><span>₹\${card.total}</span></div>
      </div>
      <div class="actions">
        <button class="btn secondary" type="button">\${editMode ? 'Done' : 'Edit'}</button>
        <button class="btn primary" type="button" \${editMode ? 'disabled' : ''}>Place order</button>
      </div>
    </div>
  \`

  // Edit / Done toggle
  node.querySelector('.btn.secondary').addEventListener('click', () => showCart(card, !editMode))

  // Place order (disabled in edit mode)
  if (!editMode) {
    node.querySelector('.btn.primary').addEventListener('click', e => {
      e.currentTarget.disabled = true
      e.currentTarget.textContent = 'Placing…'
      send('Yes, place the order')
    })
  }

  // Row-level controls
  const apiFetch = (url, opts = {}) =>
    api(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }).then(r => r.json())

  node.querySelectorAll('.cart-item[data-id]').forEach(row => {
    const id   = row.dataset.id
    if (!id) return
    const qtyEl = row.querySelector('.cqty')

    row.querySelector('.cbtn.minus').addEventListener('click', async () => {
      const next = parseInt(qtyEl.textContent) - 1
      const updated = next <= 0
        ? await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'DELETE' })
        : await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: JSON.stringify({ qty: next }) })
      if (updated && !updated.empty && updated.items?.length) showCart(updated, true)
      else document.querySelectorAll('.cart-card').forEach(el => el.remove())
    })

    row.querySelector('.cbtn.plus').addEventListener('click', async () => {
      const next    = parseInt(qtyEl.textContent) + 1
      const updated = await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: JSON.stringify({ qty: next }) })
      if (updated && !updated.empty && updated.items?.length) showCart(updated, true)
    })

    row.querySelector('.cbtn.del').addEventListener('click', async () => {
      row.style.opacity = '0.35'
      const updated = await apiFetch(\`/demo/cart/\${cartType}/item/\${encodeURIComponent(id)}\`, { method: 'DELETE' })
      if (updated && !updated.empty && updated.items?.length) showCart(updated, true)
      else document.querySelectorAll('.cart-card').forEach(el => el.remove())
    })
  })

  appendBlock(node)
}

function showOrder(card) {
  const icon = card.order_type === 'food' ? 'Food order' : 'Grocery order'
  const node = document.createElement('section')
  node.className = 'card'
  node.innerHTML = \`
    <div class="section-title">Order</div>
    <div class="order-body">
      <div class="order-head">
        <div>
          <div class="headline">Order confirmed</div>
          <div class="subline">\${icon}</div>
        </div>
        <div class="pill-mini">\${esc(card.estimated_delivery)}</div>
      </div>
      <div class="order-row"><span>Order ID</span><span>\${esc(card.order_id)}</span></div>
      <div class="order-row"><span>Items</span><span>\${card.item_count}</span></div>
      <div class="order-row"><span>Total</span><span>₹\${card.total}</span></div>
      <div class="actions">
        <button class="btn primary" type="button">Track order</button>
      </div>
    </div>
  \`
  node.querySelector('.btn.primary').addEventListener('click', () => showTracking(card.order_id))
  appendBlock(node)
}

const STAGES = ['placed','confirmed','preparing','out_for_delivery','delivered']
const STAGE_NAMES = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'On the way',
  delivered: 'Delivered'
}

async function showTracking(orderId) {
  const node = document.createElement('section')
  node.className = 'card'
  appendBlock(node)

  const render = data => {
    const steps = STAGES.map(stage => {
      const current = STAGES.indexOf(data.stage)
      const idx = STAGES.indexOf(stage)
      const state = idx < current ? 'done' : idx === current ? 'active' : ''
      return \`
        <div class="track-step \${state}">
          <div class="track-dot"></div>
          <div>\${STAGE_NAMES[stage]}\${idx === current ? \`<span>\${esc(data.message)}</span>\` : ''}</div>
        </div>
      \`
    }).join('')

    node.innerHTML = \`
      <div class="section-title">Tracking</div>
      <div class="track-body">
        <div class="track-head">
          <div>
            <div class="headline">\${STAGE_NAMES[data.stage] || 'Tracking'}</div>
            <div class="subline">Order \${esc(orderId)}</div>
          </div>
          <div class="pill-mini">\${data.eta_mins > 0 ? data.eta_mins + ' min' : 'Done'}</div>
        </div>
        <div class="track-steps">\${steps}</div>
        \${data.rider ? \`<div class="subline">Rider: \${esc(data.rider.name)} · ★ \${data.rider.rating}</div>\` : ''}
      </div>
    \`
    scrollChatToBottom()
  }

  try {
    const data = await api('/demo/track/' + orderId).then(r => r.json())
    if (!data.error) render(data)
  } catch (e) {}
}

async function send(text) {
  text = (text || '').trim()
  if (!text) return

  bubble(text, 'user')
  inp.value = ''
  inp.style.height = 'auto'
  snd.disabled = true
  const typing = bubble('', 'typing')

  try {
    const res = await api('/demo/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text })
    }).then(r => r.json())

    typing.remove()
    const cards = res.cards || []
    const hasStructuredReply = cards.some(card => card.type === 'cart' || card.type === 'order')
    let gotCart = false
    let renderTextReply = !hasStructuredReply

    for (const card of cards) {
      if (card.type === 'recipes') showRecipes(card.recipes)
      if (card.type === 'cart') { showCart(card); gotCart = true }
      if (card.type === 'order') showOrder(card)
    }

    if (!gotCart && res.reply) {
      const low = res.reply.toLowerCase()
      if (low.includes('ready to place') || low.includes("here's your cart") || low.includes('place the order')) {
        const cartData = await api('/demo/cart/grocery').then(r => r.json()).catch(() => null)
        if (cartData && !cartData.empty && !cartData.error && cartData.items?.length) {
          showCart(cartData)
          renderTextReply = false
        }
      }
    }

    if (renderTextReply) bubble(res.reply || res.error || 'Something went wrong.', 'bot')
  } catch (e) {
    typing.remove()
    bubble('Something went wrong. Try again.', 'bot')
  }

  snd.disabled = false
}

inp.addEventListener('input', () => {
  inp.style.height = 'auto'
  inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'
})
snd.addEventListener('click', () => send(inp.value))
inp.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send(inp.value)
  }
})

document.getElementById('restartBtn').addEventListener('click', async () => {
  if (!confirm('Start over?')) return
  await api('/demo/reset', { method: 'POST' })
  chat.innerHTML = ''
  init()
})

async function init() {
  const hist = await api('/demo/history').then(r => r.json())
  if (hist.conversation?.length) {
    hist.conversation.forEach(m => {
      const text = typeof m.content === 'string' ? m.content : m.content?.find?.(b => b.type === 'text')?.text
      if (text) bubble(text, m.role === 'user' ? 'user' : 'bot')
    })
  } else {
    const gr = await api('/demo/chat', { method:'POST', body:JSON.stringify({ message:'__init__' }) }).then(r => r.json())
    if (gr.reply) bubble(gr.reply, 'bot')
  }
}

init()
</script>
</body>
</html>`

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.DEMO_PORT || 3001
const MOCK_MODE = process.env.MOCK_MODE !== 'false'
app.listen(PORT, () => {
  console.log(`Vorel demo → http://localhost:${PORT}/demo`)
  console.log(`Mode: ${MOCK_MODE ? '🟡 mock (no real orders)' : '🟢 live (real orders enabled)'}`)
})
