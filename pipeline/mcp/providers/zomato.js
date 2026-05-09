/**
 * zomato.js — Zomato food ordering + dining provider
 *
 * Zomato has no official MCP yet. This stub mirrors the Swiggy Food interface
 * so the router can swap providers transparently.
 *
 * Status: STUB — wire up once Zomato launches an MCP or partner API.
 *         Track: https://www.zomato.com/developer  (no MCP announced yet)
 *
 * Until then: this provider always returns isAvailable() = false,
 * so the router falls through to Swiggy Food.
 *
 * NOTE: Zomato also covers dine-in (like Dineout) — once live, a single
 *       ZomatoProvider can replace both SwiggyFood + SwiggyDineout for
 *       users who prefer Zomato. The router will handle both use cases.
 */

export class ZomatoProvider {
  constructor(opts = {}) {
    this.name        = 'zomato'
    this.displayName = 'Zomato'
    this.available   = false // no MCP yet
    this.baseUrl     = opts.baseUrl || process.env.ZOMATO_API_URL || null
    this.apiKey      = opts.apiKey  || process.env.ZOMATO_API_KEY || null
  }

  isAvailable() {
    return this.available && Boolean(this.apiKey)
  }

  async _call(tool, params) {
    throw new Error(`${this.name}: not yet available — no official MCP/API from Zomato`)
  }

  // ── Food ordering interface (mirrors SwiggyFoodProvider) ─────────────────

  async searchRestaurants({ query, lat, lng, filters = {} }) {
    return this._call('search_restaurants', { query, lat, lng, filters })
  }

  async getRestaurantMenu({ restaurant_id }) {
    return this._call('get_restaurant_menu', { restaurant_id })
  }

  async addToCart({ restaurant_id, item_id, quantity = 1, customizations = {} }) {
    return this._call('add_to_cart', { restaurant_id, item_id, quantity, customizations })
  }

  async getCart({ session_id } = {}) {
    return this._call('get_cart', { session_id })
  }

  async placeOrder({ address_id, payment_method }) {
    return this._call('place_order', { address_id, payment_method })
  }

  async getOrderStatus({ order_id }) {
    return this._call('get_order_status', { order_id })
  }

  async cancelOrder({ order_id, reason = 'user_requested' }) {
    return this._call('cancel_order', { order_id, reason })
  }

  // ── Dining interface (covers Zomato's dine-in feature too) ───────────────

  async searchDineIn({ query, lat, lng, cuisine, filters = {} }) {
    return this._call('search_dinein', { query, lat, lng, cuisine, filters })
  }

  async checkTableAvailability({ restaurant_id, date, time, party_size }) {
    return this._call('check_table_availability', { restaurant_id, date, time, party_size })
  }

  async bookTable({ restaurant_id, slot_id, party_size, contact_name, contact_phone }) {
    return this._call('book_table', { restaurant_id, slot_id, party_size, contact_name, contact_phone })
  }
}
