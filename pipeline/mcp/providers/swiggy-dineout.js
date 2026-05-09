/**
 * swiggy-dineout.js — Swiggy Dineout (table booking + dining offers) provider
 *
 * Wraps the official Swiggy Dineout MCP server (5 tools).
 * MCP endpoint: https://mcp.swiggy.com/dineout/sse  (pending builder access)
 *
 * Status: STUB — replace the _call() shim with real MCP client once
 *         credentials arrive from builders@swiggy.in
 *
 * Swiggy Dineout MCP tools covered:
 *   search_restaurants, get_restaurant_details,
 *   check_availability, book_table, get_booking_status
 */

export class SwiggyDineoutProvider {
  constructor(opts = {}) {
    this.name        = 'swiggy-dineout'
    this.displayName = 'Swiggy Dineout'
    this.available   = false
    this.baseUrl     = opts.baseUrl || process.env.SWIGGY_DINEOUT_MCP_URL || 'https://mcp.swiggy.com/dineout/sse'
    this.apiKey      = opts.apiKey  || process.env.SWIGGY_MCP_KEY || null
  }

  isAvailable() {
    return this.available && Boolean(this.apiKey)
  }

  async _call(tool, params) {
    if (!this.isAvailable()) {
      throw new Error(`${this.name}: provider not yet configured — apply at builders@swiggy.in`)
    }
    throw new Error(`${this.name}: MCP client not implemented yet`)
  }

  // ── Tool implementations ─────────────────────────────────────────────────

  /**
   * search_restaurants({ query, lat, lng, cuisine?, filters? })
   * Finds dine-in restaurants with table booking available.
   * Returns list with ratings, price_for_two, available offers.
   */
  async searchRestaurants({ query, lat, lng, cuisine, filters = {} }) {
    return this._call('search_restaurants', { query, lat, lng, cuisine, filters })
  }

  /**
   * get_restaurant_details({ restaurant_id })
   * Returns full venue info: timings, menu, photos, offers, directions.
   */
  async getRestaurantDetails({ restaurant_id }) {
    return this._call('get_restaurant_details', { restaurant_id })
  }

  /**
   * check_availability({ restaurant_id, date, time, party_size })
   * Returns available time slots for the given party size.
   * date format: YYYY-MM-DD, time format: HH:MM (24h)
   */
  async checkAvailability({ restaurant_id, date, time, party_size }) {
    return this._call('check_availability', { restaurant_id, date, time, party_size })
  }

  /**
   * book_table({ restaurant_id, slot_id, party_size, contact_name, contact_phone })
   * Confirms a table reservation. Returns booking_id and confirmation details.
   */
  async bookTable({ restaurant_id, slot_id, party_size, contact_name, contact_phone }) {
    return this._call('book_table', { restaurant_id, slot_id, party_size, contact_name, contact_phone })
  }

  /**
   * get_booking_status({ booking_id })
   * Returns booking confirmation status and venue contact details.
   */
  async getBookingStatus({ booking_id }) {
    return this._call('get_booking_status', { booking_id })
  }
}
