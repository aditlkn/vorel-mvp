/**
 * mock/data.js — Realistic mock responses for Swiggy Food + Instamart
 *
 * Used when MOCK_MODE=true (demo / builder application).
 * Data is representative of real Swiggy API shapes.
 */

// ── Recipes ──────────────────────────────────────────────────────────────────
// Each recipe has a structured ingredients list so we can compute fridge diffs.

export const RECIPES = [
  {
    id: 'rec_dal_tadka',
    name: 'Dal Tadka',
    cook_time_mins: 30,
    view_count: 4_200_000,
    channel: 'Kunal Kapur',
    youtube_url: 'https://youtu.be/daltadka_demo',
    tags: ['veg', 'healthy', 'dal', 'quick'],
    description: 'Restaurant-style dal tadka made at home. Rich, smoky, and incredibly comforting.',
    ingredients: [
      { name: 'masoor dal',      qty: 1,   unit: 'cup',  grocery_id: 'groc_masoor_dal_500g' },
      { name: 'onion',           qty: 1,   unit: 'large', grocery_id: 'groc_onion_1kg' },
      { name: 'tomato',          qty: 2,   unit: 'medium', grocery_id: 'groc_tomato_500g' },
      { name: 'garlic',          qty: 4,   unit: 'cloves', grocery_id: 'groc_garlic_100g' },
      { name: 'ginger',          qty: 1,   unit: 'inch',  grocery_id: 'groc_ginger_100g' },
      { name: 'green chilli',    qty: 2,   unit: 'pcs',   grocery_id: 'groc_green_chilli' },
      { name: 'cumin seeds',     qty: 1,   unit: 'tsp',   grocery_id: 'groc_cumin_100g' },
      { name: 'turmeric powder', qty: 0.5, unit: 'tsp',   grocery_id: 'groc_turmeric_100g' },
      { name: 'red chilli powder', qty: 1, unit: 'tsp',   grocery_id: 'groc_red_chilli_100g' },
      { name: 'ghee',            qty: 2,   unit: 'tbsp',  grocery_id: 'groc_ghee_500ml' },
      { name: 'hing',            qty: 1,   unit: 'pinch', grocery_id: 'groc_hing_50g' },
    ],
  },
  {
    id: 'rec_chicken_curry',
    name: 'Dhaba-Style Chicken Curry',
    cook_time_mins: 45,
    view_count: 8_700_000,
    channel: 'Ranveer Brar',
    youtube_url: 'https://youtu.be/chickencurry_demo',
    tags: ['non-veg', 'chicken', 'curry', 'dhaba'],
    description: 'Bold, rustic chicken curry packed with whole spices — just like the highway dhabas.',
    ingredients: [
      { name: 'chicken',         qty: 1,   unit: 'kg',    grocery_id: 'groc_chicken_1kg' },
      { name: 'onion',           qty: 2,   unit: 'large', grocery_id: 'groc_onion_1kg' },
      { name: 'tomato',          qty: 3,   unit: 'medium', grocery_id: 'groc_tomato_500g' },
      { name: 'ginger',          qty: 2,   unit: 'inch',  grocery_id: 'groc_ginger_100g' },
      { name: 'garlic',          qty: 6,   unit: 'cloves', grocery_id: 'groc_garlic_100g' },
      { name: 'green chilli',    qty: 3,   unit: 'pcs',   grocery_id: 'groc_green_chilli' },
      { name: 'turmeric powder', qty: 0.5, unit: 'tsp',   grocery_id: 'groc_turmeric_100g' },
      { name: 'red chilli powder', qty: 2, unit: 'tsp',   grocery_id: 'groc_red_chilli_100g' },
      { name: 'coriander powder', qty: 2,  unit: 'tsp',   grocery_id: 'groc_coriander_100g' },
      { name: 'garam masala',    qty: 1,   unit: 'tsp',   grocery_id: 'groc_garam_masala' },
      { name: 'cumin seeds',     qty: 1,   unit: 'tsp',   grocery_id: 'groc_cumin_100g' },
    ],
  },
  {
    id: 'rec_paneer_butter_masala',
    name: 'Paneer Butter Masala',
    cook_time_mins: 35,
    view_count: 12_100_000,
    channel: 'Chef Sanjyot Keer',
    youtube_url: 'https://youtu.be/pbmasala_demo',
    tags: ['veg', 'paneer', 'curry', 'restaurant-style'],
    description: 'Creamy, rich, mildly spiced paneer curry. A crowd-pleaser every single time.',
    ingredients: [
      { name: 'paneer',          qty: 200, unit: 'g',     grocery_id: 'groc_paneer_200g' },
      { name: 'onion',           qty: 2,   unit: 'medium', grocery_id: 'groc_onion_1kg' },
      { name: 'tomato',          qty: 3,   unit: 'medium', grocery_id: 'groc_tomato_500g' },
      { name: 'butter',          qty: 2,   unit: 'tbsp',  grocery_id: 'groc_butter_100g' },
      { name: 'garlic',          qty: 4,   unit: 'cloves', grocery_id: 'groc_garlic_100g' },
      { name: 'ginger',          qty: 1,   unit: 'inch',  grocery_id: 'groc_ginger_100g' },
      { name: 'red chilli powder', qty: 1, unit: 'tsp',   grocery_id: 'groc_red_chilli_100g' },
      { name: 'garam masala',    qty: 1,   unit: 'tsp',   grocery_id: 'groc_garam_masala' },
      { name: 'turmeric powder', qty: 0.25, unit: 'tsp',  grocery_id: 'groc_turmeric_100g' },
      { name: 'curd',            qty: 3,   unit: 'tbsp',  grocery_id: 'groc_curd_400g' },
    ],
  },
  {
    id: 'rec_aloo_paratha',
    name: 'Aloo Paratha',
    cook_time_mins: 25,
    view_count: 6_300_000,
    channel: 'Hebbars Kitchen',
    youtube_url: 'https://youtu.be/alooparatha_demo',
    tags: ['veg', 'breakfast', 'quick', 'paratha'],
    description: 'Crispy golden parathas stuffed with spiced mashed potato. Perfect weekend breakfast.',
    ingredients: [
      { name: 'potato',          qty: 3,   unit: 'medium', grocery_id: null },
      { name: 'atta',            qty: 2,   unit: 'cups',  grocery_id: 'groc_atta_5kg' },
      { name: 'onion',           qty: 1,   unit: 'small', grocery_id: 'groc_onion_1kg' },
      { name: 'green chilli',    qty: 2,   unit: 'pcs',   grocery_id: 'groc_green_chilli' },
      { name: 'cumin seeds',     qty: 0.5, unit: 'tsp',   grocery_id: 'groc_cumin_100g' },
      { name: 'garam masala',    qty: 0.5, unit: 'tsp',   grocery_id: 'groc_garam_masala' },
      { name: 'butter',          qty: 2,   unit: 'tbsp',  grocery_id: 'groc_butter_100g' },
      { name: 'curd',            qty: 0.5, unit: 'cup',   grocery_id: 'groc_curd_400g' },
    ],
  },
  {
    id: 'rec_egg_bhurji',
    name: 'Egg Bhurji',
    cook_time_mins: 15,
    view_count: 3_800_000,
    channel: 'Kunal Kapur',
    youtube_url: 'https://youtu.be/eggbhurji_demo',
    tags: ['egg', 'quick', 'breakfast', 'easy'],
    description: 'Spicy scrambled eggs Indian-style. Ready in 15 minutes, pairs perfectly with bread or roti.',
    ingredients: [
      { name: 'eggs',            qty: 4,   unit: 'pcs',   grocery_id: null },
      { name: 'onion',           qty: 1,   unit: 'medium', grocery_id: 'groc_onion_1kg' },
      { name: 'tomato',          qty: 1,   unit: 'medium', grocery_id: 'groc_tomato_500g' },
      { name: 'green chilli',    qty: 2,   unit: 'pcs',   grocery_id: 'groc_green_chilli' },
      { name: 'cumin seeds',     qty: 0.5, unit: 'tsp',   grocery_id: 'groc_cumin_100g' },
      { name: 'turmeric powder', qty: 0.25, unit: 'tsp',  grocery_id: 'groc_turmeric_100g' },
      { name: 'butter',          qty: 1,   unit: 'tbsp',  grocery_id: 'groc_butter_100g' },
    ],
  },
]

/**
 * Search recipes by matching fridge ingredients against recipe ingredient lists.
 * Returns up to `limit` recipes, ranked by how many fridge items they use.
 */
export function searchRecipes(fridgeItems, { limit = 4, tags = [], maxTime = null } = {}) {
  const fridge = fridgeItems.map(f => f.toLowerCase().trim())

  let results = RECIPES.map(recipe => {
    const recipeIngNames = recipe.ingredients.map(i => i.name.toLowerCase())
    const matched  = fridge.filter(f => recipeIngNames.some(r => r.includes(f) || f.includes(r)))
    const missing  = recipeIngNames.filter(r => !fridge.some(f => r.includes(f) || f.includes(r)))
    return { ...recipe, matched_count: matched.length, missing_count: missing.length }
  })

  if (tags.length) {
    results = results.filter(r => tags.some(t => r.tags.includes(t)))
  }
  if (maxTime) {
    results = results.filter(r => r.cook_time_mins <= maxTime)
  }

  return results
    .sort((a, b) => b.matched_count - a.matched_count || a.missing_count - b.missing_count)
    .slice(0, limit)
}

/**
 * Compute what's missing from fridge for a given recipe.
 * Returns { have: [...], need: [...] }
 */
export function computeIngredientDiff(recipeId, fridgeItems) {
  const recipe = RECIPES.find(r => r.id === recipeId)
  if (!recipe) return null

  const fridge = fridgeItems.map(f => f.toLowerCase().trim())

  const have = []
  const need = []

  for (const ing of recipe.ingredients) {
    const inFridge = fridge.some(f => ing.name.toLowerCase().includes(f) || f.includes(ing.name.toLowerCase()))
    if (inFridge) {
      have.push(ing)
    } else {
      need.push(ing)
    }
  }

  return { recipe: recipe.name, have, need }
}

// ── Restaurants ──────────────────────────────────────────────────────────────

export const RESTAURANTS = [
  {
    id: 'rst_biryani_blues_001',
    name: 'Biryani Blues',
    cuisine: ['Biryani', 'Mughlai', 'North Indian'],
    rating: 4.3,
    rating_count: 12847,
    price_for_two: 450,
    delivery_time_mins: 32,
    delivery_fee: 29,
    distance_km: 1.4,
    veg_only: false,
    offer: '50% off up to ₹100',
    image_url: 'https://res.cloudinary.com/swiggy/image/upload/biryani-blues.jpg',
    address: 'Shop 4, Koramangala 5th Block, Bengaluru',
  },
  {
    id: 'rst_saravana_bhavan_002',
    name: 'Saravana Bhavan',
    cuisine: ['South Indian', 'Tiffin', 'Vegetarian'],
    rating: 4.5,
    rating_count: 34210,
    price_for_two: 300,
    delivery_time_mins: 25,
    delivery_fee: 0,
    distance_km: 0.8,
    veg_only: true,
    offer: 'Free delivery',
    image_url: 'https://res.cloudinary.com/swiggy/image/upload/saravana-bhavan.jpg',
    address: '11th Main, HSR Layout, Bengaluru',
  },
  {
    id: 'rst_punjab_grill_003',
    name: 'Punjab Grill',
    cuisine: ['North Indian', 'Punjabi', 'Tandoor'],
    rating: 4.1,
    rating_count: 8923,
    price_for_two: 600,
    delivery_time_mins: 35,
    delivery_fee: 49,
    distance_km: 2.1,
    veg_only: false,
    offer: '20% off on orders above ₹400',
    image_url: 'https://res.cloudinary.com/swiggy/image/upload/punjab-grill.jpg',
    address: 'Indiranagar 100 Feet Road, Bengaluru',
  },
  {
    id: 'rst_moti_mahal_004',
    name: 'Moti Mahal Delux',
    cuisine: ['North Indian', 'Mughlai', 'Paneer', 'Curry'],
    rating: 4.4,
    rating_count: 19480,
    price_for_two: 500,
    delivery_time_mins: 28,
    delivery_fee: 29,
    distance_km: 1.2,
    veg_only: false,
    offer: 'Free delivery + 10% off',
    image_url: 'https://res.cloudinary.com/swiggy/image/upload/moti-mahal.jpg',
    address: 'Koramangala 4th Block, Bengaluru',
  },
]

// ── Menus ────────────────────────────────────────────────────────────────────

export const MENUS = {
  rst_biryani_blues_001: {
    restaurant_id: 'rst_biryani_blues_001',
    sections: [
      {
        name: 'Biryani',
        items: [
          { id: 'itm_hyd_chicken_dum', name: 'Hyderabadi Chicken Dum Biryani', price: 299, veg: false, description: 'Slow-cooked dum biryani with tender chicken, saffron & fried onions', rating: 4.5, is_bestseller: true, customizations: [{ name: 'Portion', options: ['Half (serves 1)', 'Full (serves 2)'], default: 'Half (serves 1)' }] },
          { id: 'itm_mutton_biryani',  name: 'Mutton Biryani',                price: 379, veg: false, description: 'Tender mutton pieces slow-cooked with aged basmati', rating: 4.4, is_bestseller: false, customizations: [] },
          { id: 'itm_veg_biryani',     name: 'Veg Dum Biryani',               price: 219, veg: true,  description: 'Fresh vegetables & paneer cooked in aromatic spices', rating: 4.2, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Sides & Extras',
        items: [
          { id: 'itm_raita',      name: 'Burani Raita',  price: 59,  veg: true,  description: 'Garlic-infused yogurt with roasted cumin', rating: 4.3, is_bestseller: false, customizations: [] },
          { id: 'itm_shorba',     name: 'Chicken Shorba', price: 89,  veg: false, description: 'Light aromatic broth, perfect with biryani', rating: 4.1, is_bestseller: false, customizations: [] },
          { id: 'itm_gulab_jamun', name: 'Gulab Jamun',  price: 79,  veg: true,  description: 'Soft milk solids dumplings soaked in rose syrup (2 pcs)', rating: 4.6, is_bestseller: true, customizations: [] },
        ],
      },
    ],
  },

  rst_saravana_bhavan_002: {
    restaurant_id: 'rst_saravana_bhavan_002',
    sections: [
      {
        name: 'Tiffin',
        items: [
          { id: 'itm_masala_dosa',   name: 'Masala Dosa',    price: 89,  veg: true, description: 'Crispy dosa with spiced potato filling, sambar & 3 chutneys', rating: 4.6, is_bestseller: true,  customizations: [] },
          { id: 'itm_idli_sambar',   name: 'Idli (4 pcs)',   price: 79,  veg: true, description: 'Soft steamed rice cakes with sambar & coconut chutney',    rating: 4.5, is_bestseller: false, customizations: [] },
          { id: 'itm_pongal',        name: 'Ven Pongal',     price: 99,  veg: true, description: 'Rice & lentil porridge tempered with ghee, cashews & pepper', rating: 4.4, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Meals',
        items: [
          { id: 'itm_mini_meals',    name: 'Mini Meals',     price: 149, veg: true, description: 'Rice, rasam, sambar, 2 curries, papad & dessert', rating: 4.5, is_bestseller: true,  customizations: [] },
          { id: 'itm_full_meals',    name: 'Full Meals',     price: 199, veg: true, description: 'Unlimited rice, rasam, sambar, 3 curries, papad & dessert',  rating: 4.6, is_bestseller: false, customizations: [] },
        ],
      },
    ],
  },

  rst_punjab_grill_003: {
    restaurant_id: 'rst_punjab_grill_003',
    sections: [
      {
        name: 'Paneer Dishes',
        items: [
          { id: 'itm_pg_pbm',          name: 'Paneer Butter Masala',     price: 289, veg: true,  description: 'Soft paneer in rich tomato-butter-cream gravy, mildly spiced', rating: 4.5, is_bestseller: true,  customizations: [] },
          { id: 'itm_pg_palak_paneer', name: 'Palak Paneer',             price: 269, veg: true,  description: 'Cottage cheese cubes in a smooth, spiced spinach gravy',        rating: 4.3, is_bestseller: false, customizations: [] },
          { id: 'itm_pg_shahi_paneer', name: 'Shahi Paneer',             price: 299, veg: true,  description: 'Paneer in a royal cashew-onion-cream sauce',                    rating: 4.4, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Dal & Classics',
        items: [
          { id: 'itm_pg_dal_makhani',  name: 'Dal Makhani',              price: 249, veg: true,  description: 'Slow-cooked black lentils in butter and cream — 12 hours on dum', rating: 4.6, is_bestseller: true,  customizations: [] },
          { id: 'itm_pg_chole',        name: 'Pindi Chole',              price: 229, veg: true,  description: 'Spiced chickpea curry with a smoky, tangy kick',                 rating: 4.2, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Breads',
        items: [
          { id: 'itm_pg_butter_naan',  name: 'Butter Naan',              price: 59,  veg: true,  description: 'Soft leavened bread baked in tandoor, brushed with butter',      rating: 4.5, is_bestseller: true,  customizations: [] },
          { id: 'itm_pg_tandoori_roti',name: 'Tandoori Roti',            price: 39,  veg: true,  description: 'Whole wheat flatbread baked fresh in tandoor',                   rating: 4.4, is_bestseller: false, customizations: [] },
          { id: 'itm_pg_lachha_paratha',name: 'Lachha Paratha',          price: 69,  veg: true,  description: 'Layered multi-fold paratha, crispy outside, soft inside',         rating: 4.3, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Non-Veg',
        items: [
          { id: 'itm_pg_butter_chicken', name: 'Butter Chicken',         price: 349, veg: false, description: 'Tender chicken in signature tomato-cream-butter gravy',           rating: 4.7, is_bestseller: true,  customizations: [] },
          { id: 'itm_pg_mutton_rogan',   name: 'Mutton Rogan Josh',      price: 399, veg: false, description: 'Slow-cooked mutton in aromatic Kashmiri red curry',               rating: 4.4, is_bestseller: false, customizations: [] },
        ],
      },
    ],
  },

  rst_moti_mahal_004: {
    restaurant_id: 'rst_moti_mahal_004',
    sections: [
      {
        name: 'Signature Dishes',
        items: [
          { id: 'itm_mm_pbm',          name: 'Paneer Butter Masala',     price: 279, veg: true,  description: 'The original Moti Mahal recipe — rich, buttery, perfectly spiced', rating: 4.6, is_bestseller: true,  customizations: [] },
          { id: 'itm_mm_dal_makhani',  name: 'Dal Makhani',              price: 239, veg: true,  description: 'Overnight-cooked black lentils with cream and spices',              rating: 4.7, is_bestseller: true,  customizations: [] },
          { id: 'itm_mm_butter_chicken',name: 'Butter Chicken',          price: 329, veg: false, description: 'Moti Mahal legendary butter chicken — where it all began',          rating: 4.8, is_bestseller: true,  customizations: [] },
        ],
      },
      {
        name: 'Breads & Rice',
        items: [
          { id: 'itm_mm_butter_naan',  name: 'Butter Naan',              price: 55,  veg: true,  description: 'Freshly baked in tandoor, brushed generously with butter',          rating: 4.5, is_bestseller: false, customizations: [] },
          { id: 'itm_mm_roti',         name: 'Tandoori Roti',            price: 35,  veg: true,  description: 'Whole wheat, light and smoky from the tandoor',                     rating: 4.4, is_bestseller: false, customizations: [] },
          { id: 'itm_mm_steamed_rice', name: 'Steamed Basmati Rice',     price: 99,  veg: true,  description: 'Long-grain aged basmati, perfectly cooked',                         rating: 4.3, is_bestseller: false, customizations: [] },
        ],
      },
      {
        name: 'Sides & Desserts',
        items: [
          { id: 'itm_mm_raita',        name: 'Boondi Raita',             price: 69,  veg: true,  description: 'Chilled yogurt with roasted boondi and cumin',                      rating: 4.3, is_bestseller: false, customizations: [] },
          { id: 'itm_mm_gulab_jamun',  name: 'Gulab Jamun (2 pcs)',      price: 79,  veg: true,  description: 'Soft milk-solid dumplings soaked in rose & cardamom syrup',          rating: 4.6, is_bestseller: false, customizations: [] },
        ],
      },
    ],
  },
}

// ── Cart state ───────────────────────────────────────────────────────────────

const _cartStores = new Map()

export function getCartStore(sessionId = 'default') {
  if (!_cartStores.has(sessionId)) {
    _cartStores.set(sessionId, {
      food:    { items: [], restaurant_id: null, restaurant_name: null },
      grocery: { items: [] },
    })
  }
  return _cartStores.get(sessionId)
}

// ── Shared cart summary builder ───────────────────────────────────────────────

export function buildCartSummary(items, { deliveryFee = 0, taxRate = 0.05, restaurantId = null, restaurantName = null } = {}) {
  const subtotal     = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const delivery_fee = typeof deliveryFee === 'function' ? deliveryFee(subtotal) : (subtotal > 0 ? deliveryFee : 0)
  const taxes        = Math.round(subtotal * taxRate)
  return {
    ...(restaurantId != null && { restaurant_id: restaurantId, restaurant_name: restaurantName }),
    items:      items.map(i => ({
      id:       i.item_id ?? i.product_id,   // stable ID for UI cart edits
      name:     i.name,
      quantity: i.quantity,
      price:    i.price,
      subtotal: i.price * i.quantity,
      ...(i.weight != null && { weight: i.weight }),
    })),
    subtotal,
    delivery_fee,
    taxes,
    total:      subtotal + delivery_fee + taxes,
    item_count: items.reduce((s, i) => s + i.quantity, 0),
  }
}

// ── Cart mutation helpers (used by REST edit endpoints) ──────────────────────

export function removeCartItem(sessionId, type, itemId) {
  const cart  = getCartStore(sessionId)[type]
  const idKey = type === 'food' ? 'item_id' : 'product_id'
  cart.items  = cart.items.filter(i => i[idKey] !== itemId)
}

export function updateCartItemQty(sessionId, type, itemId, qty) {
  const cart  = getCartStore(sessionId)[type]
  const idKey = type === 'food' ? 'item_id' : 'product_id'
  if (qty <= 0) {
    cart.items = cart.items.filter(i => i[idKey] !== itemId)
  } else {
    const item = cart.items.find(i => i[idKey] === itemId)
    if (item) item.quantity = qty
  }
}

// ── View count formatter (used by both server and mock helpers) ───────────────

export function fmtViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k views`
  return `${n} views`
}

// ── Grocery products ─────────────────────────────────────────────────────────

export const GROCERY_PRODUCTS = [
  // Vegetables
  { id: 'groc_onion_1kg',       name: 'Fresho Onion',                    brand: 'Fresho',         weight: '1 kg',   price: 39,  unit_price: '₹39/kg',  in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_tomato_500g',     name: 'Fresh Tomato',                    brand: 'Local Farm',     weight: '500 g',  price: 25,  unit_price: '₹50/kg',  in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_spinach_250g',    name: 'Fresh Spinach (Palak)',           brand: 'Fresho',         weight: '250 g',  price: 29,  unit_price: '₹116/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_potato_1kg',      name: 'Fresh Potato',                    brand: 'Local Farm',     weight: '1 kg',   price: 35,  unit_price: '₹35/kg',  in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_capsicum_250g',   name: 'Fresh Capsicum (Bell Pepper)',    brand: 'Fresho',         weight: '250 g',  price: 45,  unit_price: '₹180/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_carrot_500g',     name: 'Fresh Carrot',                    brand: 'Fresho',         weight: '500 g',  price: 32,  unit_price: '₹64/kg',  in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_peas_500g',       name: 'Fresh Green Peas',                brand: 'Local Farm',     weight: '500 g',  price: 55,  unit_price: '₹110/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_coriander_50g',   name: 'Fresh Coriander Leaves (Dhania)',  brand: 'Fresho',        weight: '50 g',   price: 15,  unit_price: '₹300/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_lemon_6pc',       name: 'Fresh Lemon',                     brand: 'Local Farm',     weight: '6 pcs',  price: 25,  unit_price: '₹25/6pc', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_ginger_100g',     name: 'Fresh Ginger',                    brand: 'Fresho',         weight: '100 g',  price: 15,  unit_price: '₹150/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_garlic_100g',     name: 'Fresh Garlic',                    brand: 'Fresho',         weight: '100 g',  price: 18,  unit_price: '₹180/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  { id: 'groc_green_chilli',    name: 'Green Chillies',                  brand: 'Local Farm',     weight: '100 g',  price: 12,  unit_price: '₹120/kg', in_stock: true,  delivery_mins: 15, category: 'Vegetables' },
  // Dal & Lentils
  { id: 'groc_masoor_dal_500g', name: 'Tata Sampann Masoor Dal',         brand: 'Tata Sampann',   weight: '500 g',  price: 65,  unit_price: '₹130/kg', in_stock: true,  delivery_mins: 15, category: 'Dal & Pulses' },
  { id: 'groc_toor_dal_1kg',    name: 'Tata Sampann Toor Dal',           brand: 'Tata Sampann',   weight: '1 kg',   price: 125, unit_price: '₹125/kg', in_stock: true,  delivery_mins: 15, category: 'Dal & Pulses' },
  { id: 'groc_chana_dal_500g',  name: 'Organic Tattva Chana Dal',        brand: 'Organic Tattva', weight: '500 g',  price: 79,  unit_price: '₹158/kg', in_stock: true,  delivery_mins: 15, category: 'Dal & Pulses' },
  // Rice & Grains
  { id: 'groc_basmati_1kg',     name: 'India Gate Classic Basmati Rice', brand: 'India Gate',     weight: '1 kg',   price: 129, unit_price: '₹129/kg', in_stock: true,  delivery_mins: 15, category: 'Rice & Grains' },
  { id: 'groc_atta_5kg',        name: 'Aashirvaad Whole Wheat Atta',     brand: 'Aashirvaad',     weight: '5 kg',   price: 279, unit_price: '₹56/kg',  in_stock: true,  delivery_mins: 15, category: 'Atta & Flours' },
  // Spices & Masalas
  { id: 'groc_turmeric_100g',   name: 'Everest Turmeric Powder',         brand: 'Everest',        weight: '100 g',  price: 42,  unit_price: '₹420/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_cumin_100g',      name: 'Everest Jeera (Cumin Seeds)',     brand: 'Everest',        weight: '100 g',  price: 38,  unit_price: '₹380/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_hing_50g',        name: 'LG Hing (Asafoetida)',            brand: 'LG',             weight: '50 g',   price: 55,  unit_price: '₹1100/kg',in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_mustard_100g',    name: 'Everest Mustard Seeds',           brand: 'Everest',        weight: '100 g',  price: 22,  unit_price: '₹220/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_red_chilli_100g', name: 'Everest Red Chilli Powder',       brand: 'Everest',        weight: '100 g',  price: 45,  unit_price: '₹450/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_coriander_100g',  name: 'Everest Coriander Powder',        brand: 'Everest',        weight: '100 g',  price: 35,  unit_price: '₹350/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_garam_masala',    name: 'MDH Garam Masala',                brand: 'MDH',            weight: '100 g',  price: 62,  unit_price: '₹620/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_ginger_garlic',   name: 'Fresho Ginger-Garlic Paste',      brand: 'Fresho',         weight: '200 g',  price: 35,  unit_price: '₹175/kg', in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  // Dairy & Eggs
  { id: 'groc_paneer_200g',     name: 'Amul Fresh Paneer',               brand: 'Amul',           weight: '200 g',  price: 89,  unit_price: '₹445/kg', in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_ghee_500ml',      name: 'Amul Pure Ghee',                  brand: 'Amul',           weight: '500 ml', price: 299, unit_price: '₹598/L',  in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_butter_100g',     name: 'Amul Butter',                     brand: 'Amul',           weight: '100 g',  price: 55,  unit_price: '₹550/kg', in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_curd_400g',       name: 'Amul Masti Dahi',                 brand: 'Amul',           weight: '400 g',  price: 45,  unit_price: '₹112/kg', in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_cream_200ml',     name: 'Amul Fresh Cream',                brand: 'Amul',           weight: '200 ml', price: 55,  unit_price: '₹275/L',  in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_milk_1l',         name: 'Amul Taaza Toned Milk',           brand: 'Amul',           weight: '1 L',    price: 30,  unit_price: '₹30/L',   in_stock: true,  delivery_mins: 15, category: 'Dairy' },
  { id: 'groc_eggs_6pc',        name: 'Country Eggs',                    brand: 'Licious',        weight: '6 pcs',  price: 75,  unit_price: '₹75/6pc', in_stock: true,  delivery_mins: 20, category: 'Eggs' },
  // Meat
  { id: 'groc_chicken_1kg',     name: 'Licious Fresh Chicken Curry Cut', brand: 'Licious',        weight: '1 kg',   price: 239, unit_price: '₹239/kg', in_stock: true,  delivery_mins: 25, category: 'Meat & Seafood' },
  // Packaged
  { id: 'groc_coconut_milk',    name: 'Dabur Homemade Coconut Milk',     brand: 'Dabur',          weight: '200 ml', price: 49,  unit_price: '₹49/pc',  in_stock: true,  delivery_mins: 15, category: 'Canned & Packaged' },
  { id: 'groc_oil_1l',          name: 'Fortune Sunflower Refined Oil',   brand: 'Fortune',        weight: '1 L',    price: 145, unit_price: '₹145/L',  in_stock: true,  delivery_mins: 15, category: 'Oils & Ghee' },
  { id: 'groc_salt_1kg',        name: 'Tata Rock Salt',                  brand: 'Tata',           weight: '1 kg',   price: 25,  unit_price: '₹25/kg',  in_stock: true,  delivery_mins: 15, category: 'Masalas & Spices' },
  { id: 'groc_sugar_1kg',       name: 'Nature Fresh Sugar',              brand: 'Nature Fresh',   weight: '1 kg',   price: 48,  unit_price: '₹48/kg',  in_stock: true,  delivery_mins: 15, category: 'Sugar & Sweeteners' },
  { id: 'groc_bread_400g',      name: 'Britannia Brown Bread',           brand: 'Britannia',      weight: '400 g',  price: 45,  unit_price: '₹45/pc',  in_stock: true,  delivery_mins: 15, category: 'Bakery' },
  { id: 'groc_cheese_200g',     name: 'Amul Processed Cheese',           brand: 'Amul',           weight: '200 g',  price: 99,  unit_price: '₹495/kg', in_stock: true,  delivery_mins: 15, category: 'Dairy' },
]

// ── Orders ───────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = {
  food: [
    { stage: 'placed',           label: 'Order Placed',         message: 'Your order has been placed and is awaiting confirmation.' },
    { stage: 'confirmed',        label: 'Restaurant Confirmed',  message: 'Biryani Blues has confirmed your order and started preparing it.' },
    { stage: 'preparing',        label: 'Being Prepared',        message: 'Your Hyderabadi Chicken Dum Biryani is being freshly prepared.' },
    { stage: 'out_for_delivery', label: 'Out for Delivery',      message: 'Rahul is on the way with your order. ETA: 8 minutes.' },
    { stage: 'delivered',        label: 'Delivered',             message: 'Order delivered. Enjoy your meal! 🍛' },
  ],
}

// Simulated order tracker — cycles through stages for demo
export const activeOrders = {}

export function createMockOrder(type = 'food') {
  const orderId = `ORD${Date.now().toString().slice(-8)}`
  activeOrders[orderId] = {
    type,
    created_at: Date.now(),
    stage_idx: 0,
  }
  return orderId
}

export function getMockOrderStatus(orderId) {
  const order = activeOrders[orderId]
  if (!order) return null

  // Advance stage every ~20 seconds for demo
  const elapsed = (Date.now() - order.created_at) / 1000
  const stage_idx = Math.min(Math.floor(elapsed / 20), ORDER_STATUSES.food.length - 1)
  order.stage_idx = stage_idx

  const status = ORDER_STATUSES.food[stage_idx]
  return {
    order_id: orderId,
    ...status,
    eta_mins: Math.max(0, 32 - Math.floor(elapsed / 60)),
    rider: stage_idx >= 3 ? { name: 'Rahul K.', phone: '+91-98XXXXXX12', rating: 4.7 } : null,
  }
}
