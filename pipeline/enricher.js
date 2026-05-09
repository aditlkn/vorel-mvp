/**
 * enricher.js — Cron 2: YouTube metadata + transcript fetcher + quality filter
 *
 * Usage:  node pipeline/enricher.js
 *         node pipeline/enricher.js --limit 200   (override batch size for one-off runs)
 *
 * What it does:
 *   1. Fetches recipes where status='raw' from Supabase (in batches of 50)
 *   2. Calls YouTube Data API v3 videos.list for full metadata
 *   3. Fetches transcripts via youtube-transcript (unofficial, free, no quota)
 *   4. Applies quality filter (view_count, duration, availability)
 *   5. Updates status='enriched' or status='rejected'
 *   6. Inserts enriched recipes into pipeline_queue for tagging
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(__rootDir, '.env'), override: true })

import { createClient } from '@supabase/supabase-js'
import { YoutubeTranscript } from 'youtube-transcript'
import { makeKeyPool } from './key_pool.js'

// ── Config ─────────────────────────────────────────────────────────────────
const BATCH_SIZE         = 50    // YouTube API max IDs per request
const TRANSCRIPT_DELAY   = 500   // ms between transcript fetches (rate limiting)
const MAX_RETRIES        = 2
const QUALITY_MIN_VIEWS  = 10_000
const QUALITY_MIN_SECS   = 120   // 2 minutes
const QUALITY_MAX_SECS   = 1_800 // 30 minutes

// Parse --limit arg for one-off override
const limitArg = process.argv.indexOf('--limit')
const RUN_LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : Infinity

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse ISO 8601 duration → seconds.  e.g. "PT4M13S" → 253 */
function parseDuration(iso) {
  if (!iso) return null
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return null
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0)
}

/** Sleep for ms milliseconds. */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Fetch YouTube video details for up to 50 IDs. Rotates keys on quota error. */
async function fetchYouTubeVideos(videoIds, keyPool) {
  let lastError
  while (keyPool.hasAvailable()) {
    const key = keyPool.get()
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos')
      url.searchParams.set('part', 'snippet,contentDetails,statistics,status')
      url.searchParams.set('id', videoIds.join(','))
      url.searchParams.set('key', key)

      const res = await fetch(url.toString())
      const data = await res.json()

      if (!res.ok) {
        const reason = data?.error?.errors?.[0]?.reason
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
          keyPool.markExhausted(key)
          continue
        }
        throw new Error(`YouTube API ${res.status}: ${data?.error?.message || res.statusText}`)
      }

      return data.items || []
    } catch (e) {
      lastError = e
      if (e.message.includes('quotaExceeded') || e.message.includes('dailyLimitExceeded')) {
        keyPool.markExhausted(key)
        continue
      }
      throw e
    }
  }
  throw lastError || new Error('All YouTube API keys exhausted')
}

/** Fetch transcript text for a video. Returns null if unavailable. */
async function fetchTranscript(videoId) {
  // Try languages in priority order
  const langGroups = [
    ['en'],
    ['hi'],
    ['en-IN', 'en-US', 'en-GB'],
  ]

  for (const langs of langGroups) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, { languages: langs })
      if (segments?.length) {
        return segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim()
      }
    } catch {
      // Try next language group
    }
  }

  // Last resort: no language preference
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    if (segments?.length) {
      return segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim()
    }
  } catch {
    // Transcript genuinely unavailable
  }

  return null
}

/** Compute view velocity (views per day since publish date). */
function viewsPerDay(viewCount, publishedAt) {
  if (!viewCount || !publishedAt) return null
  const days = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000
  return Math.round((viewCount / Math.max(days, 1)) * 100) / 100
}

/** Quality filter — returns null if passes, or a rejection reason string. */
function qualityReject(item) {
  const stats    = item.statistics || {}
  const details  = item.contentDetails || {}
  const snippet  = item.snippet || {}
  const status   = item.status || {}

  // Unavailable / private
  if (status.privacyStatus === 'private') return 'private'
  if (status.uploadStatus   !== 'processed') return 'unavailable'

  // View count
  const views = parseInt(stats.viewCount || 0)
  if (views < QUALITY_MIN_VIEWS) return `low_view_count:${views}`

  // Duration
  const secs = parseDuration(details.duration)
  if (secs === null) return 'no_duration'
  if (secs < QUALITY_MIN_SECS) return `duration_too_short:${secs}s`
  if (secs > QUALITY_MAX_SECS) return `duration_too_long:${secs}s`

  // Livestream / premiere
  if (snippet.liveBroadcastContent === 'live') return 'is_live'

  return null // passes
}

// ── Main enrichment loop ────────────────────────────────────────────────────

async function enrichBatch(rawRecipes, keyPool) {
  const videoIds = rawRecipes.map(r => r.youtube_id)

  // Step 1: Fetch YouTube metadata for all videos in one API call
  let ytItems = []
  try {
    ytItems = await fetchYouTubeVideos(videoIds, keyPool)
  } catch (e) {
    console.error(`  YouTube API error: ${e.message}`)
    return { enriched: 0, rejected: 0, errors: rawRecipes.length }
  }

  const ytMap = new Map(ytItems.map(item => [item.id, item]))

  let enriched = 0, rejected = 0, errors = 0

  for (const recipe of rawRecipes) {
    const item = ytMap.get(recipe.youtube_id)

    // Video not found in response = deleted, private, or unavailable
    if (!item) {
      await supabase.from('recipes').update({
        status:            'rejected',
        stale_reason:      'unavailable',
        enrichment_attempts: (recipe.enrichment_attempts || 0) + 1,
        updated_at:        new Date().toISOString(),
      }).eq('id', recipe.id)
      rejected++
      process.stdout.write('✗')
      continue
    }

    // Quality filter
    const rejectReason = qualityReject(item)
    if (rejectReason) {
      await supabase.from('recipes').update({
        status:            'rejected',
        stale_reason:      rejectReason,
        enrichment_attempts: (recipe.enrichment_attempts || 0) + 1,
        view_count:        parseInt(item.statistics?.viewCount || 0),
        duration_seconds:  parseDuration(item.contentDetails?.duration),
        updated_at:        new Date().toISOString(),
      }).eq('id', recipe.id)
      rejected++
      process.stdout.write('✗')
      continue
    }

    // Fetch transcript (rate-limited)
    await sleep(TRANSCRIPT_DELAY)
    const transcript = await fetchTranscript(recipe.youtube_id)

    // Build update payload
    const snippet   = item.snippet || {}
    const stats     = item.statistics || {}
    const details   = item.contentDetails || {}
    const views     = parseInt(stats.viewCount || 0)
    const publishedAt = snippet.publishedAt || null
    const secs      = parseDuration(details.duration)

    const update = {
      status:              'enriched',
      channel_name:        snippet.channelTitle || recipe.channel_name,
      channel_subs:        parseInt(stats.subscriberCount || 0) || null,
      view_count:          views,
      like_count:          parseInt(stats.likeCount || 0) || null,
      duration_seconds:    secs,
      published_at:        publishedAt,
      thumbnail_url:       snippet.thumbnails?.maxres?.url
                           || snippet.thumbnails?.high?.url
                           || snippet.thumbnails?.default?.url
                           || null,
      description:         (snippet.description || '').slice(0, 5000), // cap size
      transcript:          transcript,
      language:            snippet.defaultAudioLanguage
                           || snippet.defaultLanguage
                           || recipe.language
                           || 'hi',
      views_per_day:       viewsPerDay(views, publishedAt),
      enrichment_attempts: (recipe.enrichment_attempts || 0) + 1,
      last_enriched_at:    new Date().toISOString(),
      updated_at:          new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from('recipes')
      .update(update)
      .eq('id', recipe.id)

    if (updateErr) {
      console.error(`\n  DB update error for ${recipe.youtube_id}: ${updateErr.message}`)
      errors++
      process.stdout.write('E')
      continue
    }

    // Queue for tagging
    await supabase.from('pipeline_queue').insert({
      recipe_id:    recipe.id,
      job_type:     'tag',
      priority:     recipe.channel_subs > 500_000 ? 8 : 5,
      status:       'pending',
      scheduled_at: new Date().toISOString(),
    }).select() // ignore duplicate errors silently

    enriched++
    process.stdout.write(transcript ? '✓' : '~') // ~ = enriched but no transcript
  }

  return { enriched, rejected, errors }
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Vorel Enricher')
  console.log('═══════════════════════════════════════════')

  const keyPool = makeKeyPool()
  let totalEnriched = 0, totalRejected = 0, totalErrors = 0
  let processed = 0
  let page = 0

  while (processed < RUN_LIMIT) {
    // Fetch next batch of raw recipes
    const batchSize = Math.min(BATCH_SIZE, RUN_LIMIT - processed)
    const { data: batch, error } = await supabase
      .from('recipes')
      .select('id, youtube_id, youtube_url, channel_id, channel_subs, name, language, enrichment_attempts')
      .eq('status', 'raw')
      .lt('enrichment_attempts', MAX_RETRIES)
      .order('channel_id', { ascending: true }) // group by channel to help caching
      .range(0, batchSize - 1)

    if (error) {
      console.error('Supabase fetch error:', error.message)
      process.exit(1)
    }
    if (!batch || batch.length === 0) {
      console.log('\n  No more raw recipes to enrich.')
      break
    }

    page++
    process.stdout.write(`\nBatch ${page} (${batch.length} recipes): `)

    if (!keyPool.hasAvailable()) {
      console.log('\n  All YouTube API keys exhausted. Run again tomorrow.')
      break
    }

    const { enriched, rejected, errors } = await enrichBatch(batch, keyPool)
    totalEnriched += enriched
    totalRejected += rejected
    totalErrors   += errors
    processed     += batch.length

    // Brief pause between batches
    if (batch.length === batchSize) await sleep(1000)
  }

  console.log(`\n\n═══════════════════════════════════════════`)
  console.log(`  Done. ${processed} recipes processed.`)
  console.log(`  ✓ Enriched: ${totalEnriched}`)
  console.log(`  ✗ Rejected: ${totalRejected}`)
  console.log(`  E Errors:   ${totalErrors}`)
  console.log(`═══════════════════════════════════════════`)
}

main().catch(e => { console.error(e); process.exit(1) })
