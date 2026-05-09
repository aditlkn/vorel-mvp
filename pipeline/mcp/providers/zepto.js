/**
 * zepto.js — Zepto quick commerce grocery provider
 *
 * Zepto has no official MCP yet. This stub mirrors the Swiggy Instamart
 * interface so the router can swap providers transparently.
 *
 * Status: STUB — wire up once Zepto launches an MCP or partner API.
 *         Track: https://www.zepto.com/developers (not live yet)
 *
 * Until then: this provider always returns isAvailable() = false,
 * so the router falls through to Swiggy Instamart.
 */

export class ZeptoProvider {
  constructor(opts = {}) {
    this.name        = 'zepto'
    this.displayName = 'Zepto'
    this.available   = false // no MCP yet
    this.baseUrl     = opts.baseUrl || process.env.ZEPTO_API_URL || null
    this.apiKey      = opts.apiKey  || process.env.ZEPTO_API_KEY || null
  }

  isAvailable() {
    return this.available && Boolean(this.apiKey)
  }

  async _call(tool, params) {
    throw new Error(`${this.name}: not yet available — no official MCP/API from Zepto`)
  }

  // ── Interface mirrors SwiggyInstamartProvider ────────────────────────────
  // Keep method signatures identical so router.withFallback() works cleanly.

  async searchProducts({ query, lat, lng, category, filters = {} }) {
    return this._call('search_products', { query, lat, lng, category, filters })
  }

  async getProductDetails({ product_id }) {
    return this._call('get_product_details', { product_id })
  }

  async addToCart({ product_id, quantity = 1 }) {
    return this._call('add_to_cart', { product_id, quantity })
  }

  async getCart() {
    return this._call('get_cart', {})
  }

  async placeOrder({ address_id, slot_id, payment_method }) {
    return this._call('place_order', { address_id, slot_id, payment_method })
  }

  async getOrderStatus({ order_id }) {
    return this._call('get_order_status', { order_id })
  }
}
