/**
 * build-db.js — run once to build dishes.db from the YouTube CSV
 *
 * Usage:
 *   node backend/scripts/build-db.js --csv /path/to/YourFoodLab_videos.csv
 *
 * What it does:
 *   1. Reads the CSV
 *   2. Sends titles to Claude in batches of 20 for enrichment
 *      (clean title, ingredients, tags, cook_time_mins)
 *   3. Writes everything to SQLite with an FTS5 index
 *   4. Outputs backend/dishes.db
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
const __rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
dotenv.config({ path: path.join(__rootDir, '.env'), override: true })

import fs from 'fs'
import { parse } from 'csv-parse/sync'
import Database from 'better-sqlite3'
import Anthropic from '@anthropic-ai/sdk'

const csvIdx  = process.argv.indexOf('--csv')
const CSV_PATH = csvIdx !== -1
  ? process.argv[csvIdx + 1]
  : path.join(__rootDir, '../youtube-channel-scraper/YourFoodLab_videos.csv')

const DB_PATH  = path.join(__rootDir, 'backend/dishes.db')
const BATCH_SIZE = 20
const MAX_ROWS   = 50   // set to Infinity for full run

// ── Allowed tags ───────────────────────────────────────────────────────────
const ALLOWED_TAGS = [
  'veg', 'non-veg', 'egg',
  'snacks', 'breakfast', 'lunch', 'dinner', 'dessert',
  'soup', 'drinks', 'street-food',
  'quick',        // ≤ 20 mins
  'rice', 'dal', 'bread', 'biryani', 'pasta', 'salad',
  'italian', 'chinese', 'continental',
  'jain',
  'healthy',
]

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Schema ─────────────────────────────────────────────────────────────────
function setupDb() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  const db = new Database(DB_PATH)

  db.exec(`
    CREATE TABLE dishes (
      id               INTEGER PRIMARY KEY,
      video_id         TEXT UNIQUE NOT NULL,
      video_url        TEXT NOT NULL,
      original_title   TEXT NOT NULL,
      clean_title      TEXT NOT NULL,
      ingredients      TEXT NOT NULL DEFAULT '',
      tags             TEXT NOT NULL DEFAULT '',
      cook_time_mins   INTEGER,
      duration_seconds INTEGER,
      view_count       INTEGER,
      thumbnail_url    TEXT
    );

    CREATE VIRTUAL TABLE dishes_fts USING fts5(
      clean_title,
      ingredients,
      tags,
      content = dishes,
      content_rowid = id
    );

    CREATE TRIGGER dishes_ai AFTER INSERT ON dishes BEGIN
      INSERT INTO dishes_fts(rowid, clean_title, ingredients, tags)
      VALUES (new.id, new.clean_title, new.ingredients, new.tags);
    END;
  `)

  return db
}

// ── Enrich a batch of titles via Claude ───────────────────────────────────
async function enrichBatch(rows) {
  const numbered = rows
    .map((r, i) => `${i + 1}. ${r.title}`)
    .join('\n')

  const prompt = `You are enriching a recipe database from YouTube video titles.

For each title extract:
- clean_title: Short English dish name only. Remove "Recipe", Hindi text, channel name, tips, and filler words. E.g. "Paneer Toast Sandwich", "Aglio e Olio Pasta", "Mutton Korma"
- ingredients: Top 3-6 main ingredients, comma-separated, lowercase English. E.g. "paneer, bread, onion, tomato"
- tags: Pick ALL that apply from this exact list only: ${ALLOWED_TAGS.join(', ')}
  Rules for tags:
  - veg = no meat/egg; non-veg = has meat/seafood; egg = has egg but no meat
  - quick = title says ≤20 mins OR durationSeconds ≤ 900 (15 min video)
  - jain = no onion, garlic, root vegetables
  - snacks = starters, chaat, sandwiches, finger food
  - Only use tags from the allowed list above
- cook_time_mins: number if title mentions time (e.g. "10-MINUTE" → 10), else null

Titles:
${numbered}

Durations in seconds for context:
${rows.map((r, i) => `${i + 1}. ${r.durationSeconds}s`).join('\n')}

Return a JSON array with exactly ${rows.length} objects in order:
[{"clean_title":"...","ingredients":"...","tags":"...","cook_time_mins":null}, ...]
Return JSON only, no explanation.`

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].text.trim()
  // Strip markdown code fences if present
  const json = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(json)
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading CSV: ${CSV_PATH}`)
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const rows = parse(raw, { columns: true, skip_empty_lines: true })
  const allRows = rows.slice(0, MAX_ROWS)
  console.log(`  ${rows.length} videos found, processing first ${allRows.length}`)

  const db = setupDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO dishes
      (video_id, video_url, original_title, clean_title, ingredients, tags, cook_time_mins, duration_seconds, view_count, thumbnail_url)
    VALUES
      (@video_id, @video_url, @original_title, @clean_title, @ingredients, @tags, @cook_time_mins, @duration_seconds, @view_count, @thumbnail_url)
  `)

  let processed = 0
  const total = allRows.length

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE)

    let enriched
    try {
      enriched = await enrichBatch(batch)
    } catch (e) {
      console.error(`  Batch ${i}–${i + batch.length} failed: ${e.message} — skipping`)
      continue
    }

    const insertMany = db.transaction((items) => {
      items.forEach((row, j) => {
        const orig = batch[j]
        const e    = enriched[j] || {}
        insert.run({
          video_id:        orig.videoId,
          video_url:       orig.videoUrl,
          original_title:  orig.title,
          clean_title:     e.clean_title  || orig.title,
          ingredients:     e.ingredients  || '',
          tags:            e.tags         || '',
          cook_time_mins:  e.cook_time_mins ?? null,
          duration_seconds: parseInt(orig.durationSeconds) || null,
          view_count:      parseInt(orig.viewCountApprox)  || null,
          thumbnail_url:   orig.thumbnailUrl || null,
        })
      })
    })

    insertMany(batch)
    processed += batch.length
    console.log(`  ${processed}/${total} enriched`)
  }

  // Verify
  const count = db.prepare('SELECT COUNT(*) as n FROM dishes').get()
  console.log(`\nDone. ${count.n} dishes in ${DB_PATH}`)

  // Sample
  const sample = db.prepare(`
    SELECT clean_title, ingredients, tags, cook_time_mins
    FROM dishes LIMIT 5
  `).all()
  console.log('\nSample rows:')
  sample.forEach(r => console.log(' ', JSON.stringify(r)))

  db.close()
}

main().catch(e => { console.error(e); process.exit(1) })
