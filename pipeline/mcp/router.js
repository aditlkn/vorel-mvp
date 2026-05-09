/**
 * router.js — Unified MCP tool interface for Vorel
 *
 * Exposes a single set of VOREL_TOOLS to Claude (tool_use).
 * Internally routes each tool call to the right provider (Swiggy/Zepto/Zomato)
 * with automatic fallback when a provider is unavailable.
 *
 * Usage:
 *   import { VOREL_TOOLS, executeTool } from './pipeline/mcp/router.js'
 *
 *   // In your Claude messages call:
 *   tools: VOREL_TOOLS
 *
 *   // In your tool_use response handler:
 *   const result = await executeTool(toolName, toolInput, { userId, lat, lng })
 */

import { SwiggyFoodProvider }      from './providers/swiggy-food.js'
import { SwiggyInstamartProvider } from './providers/swiggy-instamart.js'
import { SwiggyDineoutProvider }   from './providers/swiggy-dineout.js'
import { ZeptoProvider }           from './providers/zepto.js'
import { ZomatoProvider }          from './providers/zomato.js'
import { parseItem, resolveItem }  from '../utils/ingredient-matcher/index.js'
import {
  mergeProviderAddresses, getAddresses, getDefault,
  setDefault, hasAddresses, resolveProviderAddressId,
} from '../utils/address-store.js'

// ── Provider registry ────────────────────────────────────────────────────────

// providerKey: the key used in address.providerIds — stable across restarts,
// shared between providers that belong to the same account (e.g. SwiggyFood
// and SwiggyInstamart are both the Swiggy account → same address namespace).
const swiggyFood     = Object.assign(new SwiggyFoodProvider(),      { providerKey: 'swiggy' })
const swiggyInstamart= Object.assign(new SwiggyInstamartProvider(), { providerKey: 'swiggy' })
const swiggyDineout  = Object.assign(new SwiggyDineoutProvider(),   { providerKey: 'swiggy' })
const zepto          = Object.assign(new ZeptoProvider(),           { providerKey: 'zepto'  })
const zomato         = Object.assign(new ZomatoProvider(),          { providerKey: 'zomato' })

const providers = {
  food:    { primary: swiggyFood,      fallbacks: [zomato]  },
  grocery: { primary: swiggyInstamart, fallbacks: [zepto]   },
  dineout: { primary: swiggyDineout,   fallbacks: [zomato]  },
}

// Deduplicated list of every provider that supports address lookup.
// Used by list_addresses to fetch from all providers, not just the winning one.
const ADDRESS_PROVIDERS = [
  { provider: swiggyFood,  label: 'Swiggy' },   // represents the whole Swiggy account
  { provider: zepto,       label: 'Zepto'  },
  { provider: zomato,      label: 'Zomato' },
]

/**
 * withFallback(category, fn)
 * Tries primary provider first, then each fallback in order.
 * Throws only if ALL providers fail or are unavailable.
 *
 * @param {'food'|'grocery'|'dineout'} category
 * @param {(provider) => Promise<any>} fn  — receives the provider instance
 */
async function withFallback(category, fn) {
  const { primary, fallbacks } = providers[category]
  const chain = [primary, ...fallbacks]
  const errors = []

  for (const provider of chain) {
    if (!provider.isAvailable()) {
      errors.push(`${provider.name}: not available`)
      continue
    }
    try {
      const result = await fn(provider)
      return { provider: provider.displayName, ...result }
    } catch (e) {
      errors.push(`${provider.name}: ${e.message}`)
    }
  }

  // All providers failed — return a graceful error object (not a throw)
  // so Claude can relay it naturally to the user
  return {
    error: true,
    message: `Sorry, food services are temporarily unavailable. Please try again shortly.`,
    details: errors,
  }
}

// ── VOREL_TOOLS — the tool list Claude receives ──────────────────────────────
// Keep descriptions user-intent focused, not provider-specific.
// Claude should call these; the router decides which provider handles it.

export const VOREL_TOOLS = [
  {
    name: 'search_restaurants',
    description: 'Search for restaurants nearby that deliver food. Use when the user wants to order food from a restaurant.',
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string',  description: 'Cuisine type, dish name, or restaurant name' },
        lat:        { type: 'number',  description: 'User latitude' },
        lng:        { type: 'number',  description: 'User longitude' },
        filters:    { type: 'object',  description: 'Optional filters: veg_only, max_delivery_time, min_rating', additionalProperties: true },
      },
      required: ['query', 'lat', 'lng'],
    },
  },
  {
    name: 'search_groceries',
    description: 'Search for grocery items, ingredients, or household products for quick delivery. Use when the user needs to buy ingredients or groceries.',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string',  description: 'Product name, ingredient, or category (e.g. "onions", "basmati rice", "coconut milk")' },
        lat:      { type: 'number',  description: 'User latitude' },
        lng:      { type: 'number',  description: 'User longitude' },
        category: { type: 'string',  description: 'Optional product category to narrow results' },
        quantity: { type: 'number',  description: 'Approximate quantity needed (helps rank results by pack size)' },
        unit:     { type: 'string',  description: 'Unit for quantity (kg, g, L, ml, pcs)' },
      },
      required: ['query', 'lat', 'lng'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add a food item or grocery product to the active cart.',
    input_schema: {
      type: 'object',
      properties: {
        type:            { type: 'string', enum: ['food', 'grocery'], description: 'Whether this is a restaurant food item or a grocery product' },
        item_id:         { type: 'string', description: 'Item/product ID from a previous search result' },
        restaurant_id:   { type: 'string', description: 'Required if type=food: the restaurant this item belongs to' },
        quantity:        { type: 'number', description: 'Quantity to add (default 1)' },
        customizations:  { type: 'object', description: 'Optional: spice level, size, add-ons, etc.', additionalProperties: true },
      },
      required: ['type', 'item_id'],
    },
  },
  {
    name: 'get_cart',
    description: 'Retrieve the current cart contents and order summary.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['food', 'grocery'], description: 'Which cart to view' },
      },
      required: ['type'],
    },
  },
  {
    name: 'place_order',
    description: 'Place the order for the current cart. Only call this after explicit user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        type:           { type: 'string', enum: ['food', 'grocery'], description: 'Which cart to place' },
        address_id:     { type: 'string', description: 'Saved delivery address ID' },
        payment_method: { type: 'string', description: 'Payment method: upi, card, cod, wallet' },
        slot_id:        { type: 'string', description: 'Delivery slot ID (required for grocery orders)' },
      },
      required: ['type', 'address_id', 'payment_method'],
    },
  },
  {
    name: 'track_order',
    description: 'Get live tracking status for a placed order.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID returned when the order was placed' },
        type:     { type: 'string', enum: ['food', 'grocery'], description: 'Order type' },
      },
      required: ['order_id', 'type'],
    },
  },
  {
    name: 'order_ingredients',
    description: 'Search for and add multiple grocery ingredients to cart in one call. Use this instead of calling search_groceries + add_to_cart per item — pass all missing ingredients as an array.',
    input_schema: {
      type: 'object',
      properties: {
        ingredients: {
          type: 'array',
          description: 'All ingredients to search for and add to cart',
          items: {
            type: 'object',
            properties: {
              name:       { type: 'string', description: 'Ingredient name to search for' },
              grocery_id: { type: 'string', description: 'Optional hint product ID from get_ingredient_diff' },
            },
            required: ['name'],
          },
        },
        lat: { type: 'number', description: 'User latitude' },
        lng: { type: 'number', description: 'User longitude' },
      },
      required: ['ingredients'],
    },
  },
  {
    name: 'search_dineout',
    description: 'Search for restaurants available for table booking / dine-in.',
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string', description: 'Cuisine or restaurant name' },
        lat:        { type: 'number', description: 'User latitude' },
        lng:        { type: 'number', description: 'User longitude' },
        date:       { type: 'string', description: 'Date for booking YYYY-MM-DD' },
        time:       { type: 'string', description: 'Preferred time HH:MM (24h)' },
        party_size: { type: 'number', description: 'Number of guests' },
      },
      required: ['query', 'lat', 'lng'],
    },
  },
  {
    name: 'book_table',
    description: 'Book a table at a restaurant. Only call after explicit user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        restaurant_id:  { type: 'string', description: 'Restaurant ID from search_dineout result' },
        slot_id:        { type: 'string', description: 'Slot ID from check_availability result' },
        party_size:     { type: 'number', description: 'Number of guests' },
        contact_name:   { type: 'string', description: 'Name for the reservation' },
        contact_phone:  { type: 'string', description: 'Contact number for the reservation' },
      },
      required: ['restaurant_id', 'slot_id', 'party_size', 'contact_name', 'contact_phone'],
    },
  },
  {
    name: 'list_addresses',
    description: 'Fetch and cache the user\'s saved delivery addresses. Call this before place_order when no default address is available, or when the user asks to see or change their address.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_default_address',
    description: 'Mark one of the user\'s saved addresses as their default for future orders. Call after list_addresses when the user indicates which address to use.',
    input_schema: {
      type: 'object',
      properties: {
        address_id: { type: 'string', description: 'ID of the address to set as default (from list_addresses result)' },
      },
      required: ['address_id'],
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────────────────────

/**
 * executeTool(toolName, input, context)
 * Called from the chat handler when Claude returns a tool_use block.
 *
 * @param {string} toolName   — one of the VOREL_TOOLS names
 * @param {object} input      — Claude's tool input
 * @param {object} context    — { userId, lat, lng } from session
 * @returns {Promise<object>} — result object to send back as tool_result
 */
export async function executeTool(toolName, input, context = {}) {
  const { userId = 'default', lat, lng, sessionId = 'default' } = context
  const loc = { lat: input.lat ?? lat, lng: input.lng ?? lng }

  switch (toolName) {

    case 'search_restaurants':
      return withFallback('food', p =>
        p.searchRestaurants({ ...input, ...loc })
      )

    case 'search_groceries': {
      // Run query through matcher to clean input and narrow category before hitting provider
      const parsed   = parseItem(input.query)
      const query    = parsed.canonical               // e.g. "dhania" → "coriander"
      const category = input.category ?? parsed.category  // caller can still override
      const result   = await withFallback('grocery', p =>
        p.searchProducts({ query, ...loc, category, filters: input.filters })
      )
      // Re-rank results using preference scoring so best product comes first
      if (result.products?.length) {
        const ranked = result.products
          .map(p => ({ p, score: resolveItem(parsed, [p]).confidence }))
          .sort((a, b) => b.score - a.score)
          .map(x => x.p)
        return { ...result, products: ranked }
      }
      return result
    }

    case 'add_to_cart': {
      const category = input.type === 'grocery' ? 'grocery' : 'food'
      return withFallback(category, p => {
        if (category === 'grocery') {
          return p.addToCart({ product_id: input.item_id, quantity: input.quantity ?? 1, sessionId })
        } else {
          return p.addToCart({
            restaurant_id:  input.restaurant_id,
            item_id:        input.item_id,
            quantity:       input.quantity ?? 1,
            customizations: input.customizations ?? {},
            sessionId,
          })
        }
      })
    }

    case 'get_cart': {
      const category = input.type === 'grocery' ? 'grocery' : 'food'
      return withFallback(category, p => p.getCart({ sessionId }))
    }

    case 'place_order': {
      const category = input.type === 'grocery' ? 'grocery' : 'food'

      // Resolve canonical address — explicit ID takes priority over default
      const canonicalAddr = input.address_id
        ? getAddresses(userId).find(a => a.id === input.address_id)
        : getDefault(userId)

      if (!canonicalAddr) {
        return {
          error:   true,
          code:    'NO_ADDRESS',
          message: 'No delivery address on file. Call list_addresses first so the user can pick one.',
        }
      }

      // Each provider picks its own address ID from the canonical record.
      // Zepto fallback uses coordinates when its address ID isn't mapped.
      // If neither ID nor coords exist (Swiggy-only address, Zepto never synced),
      // that provider is skipped and withFallback moves to the next one.
      return withFallback(category, p => {
        const providerAddrId = canonicalAddr.providerIds?.[p.providerKey] ?? null
        const hasCoords      = canonicalAddr.lat && canonicalAddr.lng

        if (!providerAddrId && !hasCoords) {
          throw new Error(`No address mapping for provider ${p.providerKey} and no coordinates available`)
        }

        return p.placeOrder({
          ...(providerAddrId
            ? { address_id:  providerAddrId }
            : { address_lat: canonicalAddr.lat, address_lng: canonicalAddr.lng }),
          payment_method: input.payment_method,
          slot_id:        input.slot_id,
          sessionId,
        })
      })
    }

    case 'order_ingredients': {
      // Run every ingredient through the matcher in parallel, then search
      const searches = await Promise.all(
        input.ingredients.map(async ing => {
          const parsed = parseItem(ing.name)

          // Fast path: grocery_id hint → direct lookup, skip text search
          if (ing.grocery_id) {
            const r = await withFallback('grocery', p =>
              p.searchProducts({ query: ing.grocery_id, ...loc })
            )
            const product = r.products?.[0] ?? null
            return { ing, parsed, product, confidence: product ? 1.0 : 0 }
          }

          // Normal path: search by canonical name + category from matcher
          const r = await withFallback('grocery', p =>
            p.searchProducts({ query: parsed.canonical, ...loc, category: parsed.category })
          )
          const { match, confidence } = resolveItem(parsed, r.products ?? [])
          return { ing, parsed, product: match, confidence }
        })
      )

      // Add matched products to cart in parallel (no dependency between adds)
      const added = [], unavailable = [], low_confidence = []
      await Promise.all(
        searches.map(async ({ ing, parsed, product, confidence }) => {
          if (!product || product.in_stock === false) {
            unavailable.push(ing.name)
            return
          }
          if (confidence < 0.6) {
            // Still add it, but flag so Claude can surface a confirmation to user
            low_confidence.push({ name: ing.name, matched_to: product.name, confidence })
          }
          const qty = parsed.qty ?? 1
          await withFallback('grocery', p =>
            p.addToCart({ product_id: product.id, quantity: qty, sessionId })
          )
          added.push({ name: ing.name, product_name: product.name, price: product.price, confidence })
        })
      )

      const cart = await withFallback('grocery', p => p.getCart({ sessionId }))
      return { added, unavailable, low_confidence, ...cart }
    }

    case 'track_order': {
      const category = input.type === 'grocery' ? 'grocery' : 'food'
      return withFallback(category, p => p.getOrderStatus({ order_id: input.order_id }))
    }

    case 'search_dineout':
      return withFallback('dineout', p =>
        p.searchRestaurants({ ...input, ...loc })
      )

    case 'book_table':
      return withFallback('dineout', p => p.bookTable(input))

    case 'list_addresses': {
      // Return cache if already synced; pass force:true to re-fetch
      if (hasAddresses(userId) && !input.force) {
        const addresses   = getAddresses(userId)
        const defaultAddr = getDefault(userId)
        return { addresses, default_address_id: defaultAddr?.id ?? null }
      }

      // Fetch from every provider directly — NOT through withFallback.
      // withFallback stops at the first success; here we want all providers
      // so each canonical address accumulates its own ID for each provider.
      const fetches = ADDRESS_PROVIDERS.map(({ provider, label }) =>
        Promise.resolve()
          .then(() => provider.isAvailable() ? provider.getAddresses() : null)
          .then(r  => r ? { providerKey: provider.providerKey, addresses: r.addresses ?? [] } : null)
          .catch(() => null)   // provider failed — skip, don't block the others
      )

      const results = (await Promise.all(fetches)).filter(Boolean)

      // Merge into canonical store — addresses within 50 m unified into one record
      for (const { providerKey, addresses } of results) {
        mergeProviderAddresses(userId, providerKey, addresses)
      }

      const addresses   = getAddresses(userId)
      const defaultAddr = getDefault(userId)
      return { addresses, default_address_id: defaultAddr?.id ?? null }
    }

    case 'set_default_address': {
      if (!hasAddresses(userId)) {
        return {
          error:   true,
          code:    'NO_ADDRESSES_FETCHED',
          message: 'Call list_addresses first to load your saved addresses.',
        }
      }
      const ok = setDefault(userId, input.address_id)
      if (!ok) {
        return {
          error:   true,
          message: `Address "${input.address_id}" not found. Call list_addresses to see valid options.`,
        }
      }
      return { success: true, default_address: getDefault(userId) }
    }

    default:
      return { error: true, message: `Unknown tool: ${toolName}` }
  }
}

/**
 * syncAddresses(userId)
 *
 * Fetches addresses from all providers in parallel and merges them into the
 * canonical store. Call this at session start — fire-and-forget is fine.
 * By the time the user asks to order, addresses are already cached.
 *
 *   // In your session/chat handler:
 *   syncAddresses(session.userId)   // no await — runs in background
 */
export async function syncAddresses(userId) {
  if (hasAddresses(userId)) return   // already warm

  const fetches = ADDRESS_PROVIDERS.map(({ provider }) =>
    Promise.resolve()
      .then(() => provider.isAvailable() ? provider.getAddresses() : null)
      .then(r  => r ? { providerKey: provider.providerKey, addresses: r.addresses ?? [] } : null)
      .catch(() => null)
  )

  const results = (await Promise.all(fetches)).filter(Boolean)
  for (const { providerKey, addresses } of results) {
    mergeProviderAddresses(userId, providerKey, addresses)
  }
}

/**
 * providerStatus()
 * Returns availability state of all configured providers.
 * Useful for a /status endpoint or startup diagnostics.
 */
export function providerStatus() {
  return Object.entries(providers).reduce((acc, [category, { primary, fallbacks }]) => {
    acc[category] = {
      primary:   { name: primary.name,   available: primary.isAvailable() },
      fallbacks: fallbacks.map(p => ({ name: p.name, available: p.isAvailable() })),
    }
    return acc
  }, {})
}
