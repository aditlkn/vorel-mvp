/**
 * test.js — Standalone smoke tests for the ingredient matcher
 *
 * Run: node pipeline/utils/ingredient-matcher/test.js
 *
 * No test framework needed — just prints PASS/FAIL per case.
 */

import { parseItem, parseList, resolveItem } from './index.js'
import { normalize }                         from './normalize.js'

let passed = 0
let failed = 0

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
    || (typeof expected === 'function' && expected(actual))
  if (ok) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    console.log(`     expected: ${JSON.stringify(expected)}`)
    console.log(`     got:      ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── normalize ────────────────────────────────────────────────────────────────
console.log('\n── normalize ──')

// normalize handles units + fractions + spelling; depluralize is in sanitize.js
assert('lowercase + units',
  normalize('2 Kgs Onions'),
  v => v.includes('2 kg') && v.includes('onion')
)

assert('fraction word',
  normalize('half kg tomatoes'),
  v => v.startsWith('0.5 kg')
)

assert('spelling variant — cilantro',
  normalize('cilantro'),
  'coriander'
)

assert('spelling variant — chili',
  normalize('chili powder'),
  'chilli powder'
)

assert('unit — grams',
  normalize('200 grams rice'),
  '200 g rice'
)

// ── parseItem — Hindi aliases ────────────────────────────────────────────────
console.log('\n── parseItem: Hindi aliases ──')

assert('dhania → coriander fresh-leaves',
  [parseItem('dhania').canonical, parseItem('dhania').form],
  ['coriander', 'fresh-leaves']
)

assert('shimla mirch → capsicum fresh',
  [parseItem('shimla mirch').canonical, parseItem('shimla mirch').form],
  ['capsicum', 'fresh']
)

assert('haldi → turmeric powder',
  [parseItem('haldi').canonical, parseItem('haldi').form],
  ['turmeric', 'powder']
)

assert('kasuri methi → kasuri methi dried-leaves',
  [parseItem('kasuri methi').canonical, parseItem('kasuri methi').form],
  ['kasuri methi', 'dried-leaves']
)

assert('methi → fenugreek fresh-leaves (not dried)',
  [parseItem('methi').canonical, parseItem('methi').form],
  ['fenugreek', 'fresh-leaves']
)

assert('jeera → cumin seeds (not powder)',
  [parseItem('jeera').canonical, parseItem('jeera').form],
  ['cumin', 'seeds']
)

// ── parseItem — quantity + unit ──────────────────────────────────────────────
console.log('\n── parseItem: quantity extraction ──')

assert('2 kg onions → qty=2 unit=kg',
  (() => { const p = parseItem('2 kg onions'); return [p.qty, p.unit] })(),
  [2, 'kg']
)

assert('half kg tomatoes → qty=0.5',
  parseItem('half kg tomatoes').qty,
  0.5
)

assert('1 bunch coriander → qty=1 unit=bunch',
  (() => { const p = parseItem('1 bunch coriander'); return [p.qty, p.unit] })(),
  [1, 'bunch']
)

// ── parseItem — form hints ───────────────────────────────────────────────────
console.log('\n── parseItem: form hints from user ──')

assert('fresh coriander → formHints includes fresh',
  parseItem('fresh coriander').formHints.includes('fresh'),
  true
)

assert('coriander powder → formHints includes powder',
  parseItem('coriander powder').formHints.includes('powder'),
  true
)

// ── parseList ────────────────────────────────────────────────────────────────
console.log('\n── parseList: shopping list parsing ──')

const { items: list, info: listInfo } = parseList('coriander, 2 kg onions, shimla mirch, kasuri methi')
assert('list has 4 items', list.length, 4)
assert('list info is null (comma-separated)', listInfo, null)
assert('first item is coriander', list[0].canonical, 'coriander')
assert('second item qty=2', list[1].qty, 2)
assert('third item is capsicum', list[2].canonical, 'capsicum')
assert('fourth item is kasuri methi dried', list[3].form, 'dried-leaves')

// ── resolveItem — scoring ────────────────────────────────────────────────────
console.log('\n── resolveItem: scoring ──')

const MOCK_PRODUCTS = [
  { id: 'a', name: 'Fresh Coriander Leaves (Dhania)', category: 'Vegetables',        price: 15, weight: '50 g',  in_stock: true },
  { id: 'b', name: 'Everest Coriander Powder',        category: 'Masalas & Spices',  price: 35, weight: '100 g', in_stock: true },
  { id: 'c', name: 'Coriander Seeds (Whole)',         category: 'Masalas & Spices',  price: 22, weight: '100 g', in_stock: true },
]

const corianderResolved = parseItem('coriander')
const result = resolveItem(corianderResolved, MOCK_PRODUCTS)
assert('coriander → fresh leaves wins (not powder)',
  result.match.id,
  'a'
)
assert('confidence > 0.5 (clear winner)',
  result.confidence > 0.5,
  true
)

const TOMATO_PRODUCTS = [
  { id: 'a', name: 'Fresh Tomato',                    category: 'Vegetables',       price: 25, weight: '500 g', in_stock: true },
  { id: 'b', name: 'Cherry Tomatoes',                 category: 'Vegetables',       price: 89, weight: '250 g', in_stock: true },
  { id: 'c', name: 'Tomato Puree',                    category: 'Canned & Packaged',price: 45, weight: '200 g', in_stock: true },
]
const tomatoResolved = parseItem('tomatoes')
const tResult = resolveItem(tomatoResolved, TOMATO_PRODUCTS)
assert('tomatoes → fresh tomato wins (not cherry, not puree)',
  tResult.match.id,
  'a'
)

// ── stripConversationalPrefix ────────────────────────────────────────────────
console.log('\n── stripConversationalPrefix ──')
import { stripConversationalPrefix, applyGenericNormalization } from './sanitize.js'

assert('usual ones like papaya → papaya',
  stripConversationalPrefix('usual ones like papaya'), 'papaya')

assert('the usual ones like → empty (vague)',
  stripConversationalPrefix('the usual ones like'), '')

assert('things like mango → mango',
  stripConversationalPrefix('things like mango'), 'mango')

assert('stuff like onion → onion',
  stripConversationalPrefix('stuff like onion'), 'onion')

assert('some chocolates → chocolates',
  stripConversationalPrefix('some chocolates'), 'chocolates')

assert('just milk → milk',
  stripConversationalPrefix('just milk'), 'milk')

assert('the regular ones → empty (vague)',
  stripConversationalPrefix('the regular ones'), '')

assert('maybe butter → butter',
  stripConversationalPrefix('maybe butter'), 'butter')

assert('restock rice → rice',
  stripConversationalPrefix('restock rice'), 'rice')

assert('plain name untouched — paneer',
  stripConversationalPrefix('paneer'), 'paneer')

// ── applyGenericNormalization ────────────────────────────────────────────────
console.log('\n── applyGenericNormalization ──')

assert('chocolates → milk chocolate',
  applyGenericNormalization('chocolates'), 'milk chocolate')

assert('cold drinks → cola soft drink',
  applyGenericNormalization('cold drinks'), 'cola soft drink')

assert('chips → potato chips',
  applyGenericNormalization('chips'), 'potato chips')

assert('regular chips → salted potato chips',
  applyGenericNormalization('regular chips'), 'salted potato chips')

assert('noodles → instant noodles',
  applyGenericNormalization('noodles'), 'instant noodles')

assert('bread → white sandwich bread',
  applyGenericNormalization('bread'), 'white sandwich bread')

assert('specific item untouched — basmati rice',
  applyGenericNormalization('basmati rice'), 'basmati rice')

// ── Full pipeline: prefix + normalization end-to-end ─────────────────────────
console.log('\n── End-to-end: prefix + normalization ──')

assert('some chocolates → parseItem → milk chocolate',
  parseItem('some chocolates').name, 'milk chocolate')

assert('usual ones like papaya → parseItem → papaya',
  parseItem('usual ones like papaya').name, 'papaya')

assert('the regular ones like cold drinks → cola soft drink',
  parseItem('the regular ones like cold drinks').name, 'cola soft drink')

assert('stuff like chips → potato chips',
  parseItem('stuff like chips').name, 'potato chips')

// ── parseList: auto-split behaviour ─────────────────────────────────────────
console.log('\n── parseList: auto-split ──')

assert('comma list — info is null',
  parseList('milk, eggs, butter').info, null)

assert('single word — info is null',
  parseList('paneer').info, null)

assert('two words — treated as one product, info is null',
  parseList('potato chips').info, null)

assert('two words — yields 1 item',
  parseList('potato chips').items.length, 1)

assert('newline-separated — info is null',
  parseList('milk\neggs\nbutter').info, null)

assert('comma list — correct item count',
  parseList('milk, eggs, butter').items.length, 3)

assert('3 words no delimiter — auto-splits to 3 items',
  parseList('milk eggs butter').items.length, 3)

assert('4 words no delimiter — auto-splits to 4 items',
  parseList('onion tomato ginger garlic').items.length, 4)

assert('space list — info message mentions item count',
  parseList('milk eggs butter').info, 'Treated as 3 separate items: milk, eggs, butter')

assert('space list — first item is milk',
  parseList('milk eggs butter').items[0].name, 'milk')

assert('compound protected across auto-split — ginger garlic paste stays whole',
  parseList('milk ginger garlic paste butter').items.some(i => i.name === 'ginger garlic paste'),
  true)

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`)
if (failed > 0) process.exit(1)
