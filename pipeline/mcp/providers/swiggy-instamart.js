/**
 * swiggy-instamart.js — Swiggy Instamart grocery delivery provider
 *
 * Wraps the official Swiggy Instamart MCP server (6 tools).
 * MCP endpoint: https://mcp.swiggy.com/instamart/sse  (pending builder access)
 *
 * Modes:
 *   MOCK_MODE=true   → returns realistic mock data (demo / builder application)
 *   live             → calls real Swiggy MCP SSE endpoint (requires SWIGGY_MCP_KEY)
 */

import {
  GROCERY_PRODUCTS,
  buildCartSummary,
  getCartStore,
  createMockOrder,
  getMockOrderStatus,
} from '../mock/data.js'

export class SwiggyInstamartProvider {
  constructor(opts = {}) {
    this.name        = 'swiggy-instamart'
    this.displayName = 'Swiggy Instamart'
    this.baseUrl     = opts.baseUrl || process.env.SWIGGY_INSTAMART_MCP_URL || 'https://mcp.swiggy.com/instamart/sse'
    this.apiKey      = opts.apiKey  || process.env.SWIGGY_MCP_KEY || null
  }

  get _mock() { return process.env.MOCK_MODE === 'true' }

  isAvailable() {
    return this._mock || Boolean(this.apiKey)
  }

  async _call(tool, params) {
    throw new Error(`${this.name}: live MCP client not implemented — set MOCK_MODE=true for demo`)
  }

  // ── Tool implementations ─────────────────────────────────────────────────

  async searchProducts({ query, lat, lng, category, filters = {} }) {
    if (this._mock) {
      const q = query.toLowerCase()
      let results = GROCERY_PRODUCTS.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
      if (!results.length) results = GROCERY_PRODUCTS.slice(0, 5)
      if (category) results = results.filter(p => p.category.toLowerCase().includes(category.toLowerCase()))
      return { products: results, total: results.length, delivery_message: '🟢 Delivery in 10-15 mins' }
    }
    return this._call('search_products', { query, lat, lng, category, filters })
  }

  async getProductDetails({ product_id }) {
    if (this._mock) {
      const product = GROCERY_PRODUCTS.find(p => p.id === product_id)
      if (!product) return { error: true, message: 'Product not found' }
      return { ...product, images: [], substitutes: [] }
    }
    return this._call('get_product_details', { product_id })
  }

  async addToCart({ product_id, quantity = 1, sessionId = 'default' }) {
    if (this._mock) {
      const product = GROCERY_PRODUCTS.find(p => p.id === product_id)
      if (!product) return { error: true, message: 'Product not found' }

      const cart = getCartStore(sessionId).grocery
      const existing = cart.items.find(i => i.product_id === product_id)
      if (existing) existing.quantity += quantity
      else cart.items.push({ product_id, name: product.name, price: product.price, weight: product.weight, quantity })

      return _groceryCartSummary(cart)
    }
    return this._call('add_to_cart', { product_id, quantity })
  }

  async getCart({ sessionId = 'default' } = {}) {
    if (this._mock) return _groceryCartSummary(getCartStore(sessionId).grocery)
    return this._call('get_cart', {})
  }

  async placeOrder({ address_id, slot_id, payment_method, sessionId = 'default' }) {
    if (this._mock) {
      const cart = getCartStore(sessionId).grocery
      if (!cart.items.length) return { error: true, message: 'Cart is empty' }
      const orderId = createMockOrder('grocery')
      const summary = _groceryCartSummary(cart)
      cart.items = []
      return {
        order_id:           orderId,
        status:             'placed',
        total:              summary.total,
        item_count:         summary.item_count,
        delivery_address:   'Your saved address',
        payment_method,
        estimated_delivery: '10-15 mins',
        message:            `Grocery order placed! 🛒 ${summary.item_count} items arriving in ~10-15 mins.`,
      }
    }
    return this._call('place_order', { address_id, slot_id, payment_method })
  }

  async getOrderStatus({ order_id }) {
    if (this._mock) {
      const status = getMockOrderStatus(order_id)
      if (!status) return { error: true, message: 'Order not found' }
      return status
    }
    return this._call('get_order_status', { order_id })
  }
}

// ── Cart helper ──────────────────────────────────────────────────────────────

function _groceryCartSummary({ items }) {
  const subtotal     = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const delivery_fee = subtotal > 0 && subtotal < 199 ? 25 : 0
  return {
    ...buildCartSummary(items, { deliveryFee: delivery_fee, taxRate: 0.03 }),
    delivery_message: delivery_fee ? `Add ₹${199 - subtotal} more for free delivery` : 'Free delivery',
  }
}
