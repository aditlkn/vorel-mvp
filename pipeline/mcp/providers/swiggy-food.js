/**
 * swiggy-food.js — Swiggy Food ordering provider
 *
 * Wraps the official Swiggy Food MCP server (7 tools).
 * MCP endpoint: https://mcp.swiggy.com/food/sse  (pending builder access)
 *
 * Modes:
 *   MOCK_MODE=true   → returns realistic mock data (demo / builder application)
 *   live             → calls real Swiggy MCP SSE endpoint (requires SWIGGY_MCP_KEY)
 */

import {
  RESTAURANTS,
  MENUS,
  buildCartSummary,
  getCartStore,
  createMockOrder,
  getMockOrderStatus,
} from '../mock/data.js'

export class SwiggyFoodProvider {
  constructor(opts = {}) {
    this.name        = 'swiggy-food'
    this.displayName = 'Swiggy'
    this.baseUrl     = opts.baseUrl || process.env.SWIGGY_MCP_URL || 'https://mcp.swiggy.com/food/sse'
    this.apiKey      = opts.apiKey  || process.env.SWIGGY_MCP_KEY || null
  }

  // Read lazily so MOCK_MODE set after import still works
  get _mock() { return process.env.MOCK_MODE === 'true' }

  isAvailable() {
    return this._mock || Boolean(this.apiKey)
  }

  // ── Internal MCP call (live) ─────────────────────────────────────────────

  async _call(tool, params) {
    // TODO: replace with real @modelcontextprotocol/sdk client
    // const client = new MCPClient({ url: this.baseUrl, apiKey: this.apiKey })
    // return client.call(tool, params)
    throw new Error(`${this.name}: live MCP client not implemented — set MOCK_MODE=true for demo`)
  }

  // ── Tool implementations ─────────────────────────────────────────────────

  async searchRestaurants({ query, lat, lng, filters = {} }) {
    if (this._mock) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

      // Dish-to-cuisine mapping so "paneer butter masala" finds North Indian places
      const DISH_CUISINE_MAP = {
        paneer: ['North Indian', 'Punjabi', 'Mughlai'],
        butter: ['North Indian', 'Punjabi', 'Mughlai'],
        masala: ['North Indian', 'Mughlai'],
        roti:   ['North Indian', 'Punjabi'],
        naan:   ['North Indian', 'Punjabi'],
        dal:    ['North Indian', 'Punjabi'],
        biryani:['Biryani', 'Mughlai'],
        dosa:   ['South Indian'],
        idli:   ['South Indian'],
        chicken:['North Indian', 'Mughlai', 'Biryani'],
        mutton: ['North Indian', 'Mughlai'],
      }
      const impliedCuisines = new Set(terms.flatMap(t => DISH_CUISINE_MAP[t] ?? []))

      let results = RESTAURANTS.filter(r => {
        const rName    = r.name.toLowerCase()
        const rCuisine = r.cuisine.map(c => c.toLowerCase())
        return (
          terms.some(t => rName.includes(t)) ||
          terms.some(t => rCuisine.some(c => c.includes(t))) ||
          (impliedCuisines.size > 0 && r.cuisine.some(c => impliedCuisines.has(c)))
        )
      })

      if (!results.length) results = RESTAURANTS // return all if no match, for demo
      if (filters.veg_only) results = results.filter(r => r.veg_only)

      // Sort by rating desc for best-first
      results = [...results].sort((a, b) => b.rating - a.rating)
      return { restaurants: results, total: results.length }
    }
    return this._call('search_restaurants', { query, lat, lng, filters })
  }

  async getRestaurantMenu({ restaurant_id }) {
    if (this._mock) {
      const menu = MENUS[restaurant_id]
      if (!menu) return { error: true, message: 'Restaurant not found' }
      return menu
    }
    return this._call('get_restaurant_menu', { restaurant_id })
  }

  async addToCart({ restaurant_id, item_id, quantity = 1, customizations = {}, sessionId = 'default' }) {
    if (this._mock) {
      const menu = MENUS[restaurant_id]
      if (!menu) return { error: true, message: 'Restaurant not found' }

      const item = menu.sections.flatMap(s => s.items).find(i => i.id === item_id)
      if (!item) return { error: true, message: 'Item not found' }

      const cart = getCartStore(sessionId).food
      if (cart.restaurant_id && cart.restaurant_id !== restaurant_id) cart.items = []

      cart.restaurant_id   = restaurant_id
      cart.restaurant_name = RESTAURANTS.find(r => r.id === restaurant_id)?.name

      const existing = cart.items.find(i => i.item_id === item_id)
      if (existing) existing.quantity += quantity
      else cart.items.push({ item_id, name: item.name, price: item.price, quantity, customizations })

      return _cartSummary(cart)
    }
    return this._call('add_to_cart', { restaurant_id, item_id, quantity, customizations })
  }

  async getCart({ sessionId = 'default' } = {}) {
    if (this._mock) return _cartSummary(getCartStore(sessionId).food)
    return this._call('get_cart', {})
  }

  async placeOrder({ address_id, payment_method, sessionId = 'default' }) {
    if (this._mock) {
      const cart = getCartStore(sessionId).food
      if (!cart.items.length) return { error: true, message: 'Cart is empty' }
      const orderId  = createMockOrder('food')
      const summary  = _cartSummary(cart)
      cart.items         = []
      cart.restaurant_id = null
      return {
        order_id:           orderId,
        status:             'placed',
        restaurant:         summary.restaurant_name,
        total:              summary.total,
        delivery_address:   'Your saved address',
        payment_method,
        estimated_delivery: '30-35 mins',
        message:            `Order placed! 🎉 Your food from ${summary.restaurant_name} will arrive in ~30-35 mins.`,
      }
    }
    return this._call('place_order', { address_id, payment_method })
  }

  async getOrderStatus({ order_id }) {
    if (this._mock) {
      const status = getMockOrderStatus(order_id)
      if (!status) return { error: true, message: 'Order not found' }
      return status
    }
    return this._call('get_order_status', { order_id })
  }

  async cancelOrder({ order_id, reason = 'user_requested' }) {
    if (this._mock) {
      return {
        order_id,
        status:  'cancelled',
        refund:  'Refund of ₹328 will be processed in 5-7 business days.',
        message: 'Your order has been cancelled.',
      }
    }
    return this._call('cancel_order', { order_id, reason })
  }
}

// ── Cart helper ──────────────────────────────────────────────────────────────

function _cartSummary({ items, restaurant_id, restaurant_name }) {
  return buildCartSummary(items, {
    deliveryFee:    29,
    taxRate:        0.05,
    restaurantId:   restaurant_id,
    restaurantName: restaurant_name,
  })
}
