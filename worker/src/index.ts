import { fetchHomeTimeline } from './x-api-client'
import { mergeAndCap, normalize } from './normalize'
import type { Tweet, TweetsMeta } from './types'

export interface Env {
  TWEETS_KV: KVNamespace
  X_BEARER_TOKEN: string
  X_USER_ID: string
}

// SECURITY: Worker URL acts as the only access-control boundary — there is no
// Authorization check and CORS is fully open so the g2-app (running in the
// Even Hub WebView) can read it from any origin. Treat the URL as a secret:
// don't share or commit it. If you want a stronger guarantee, gate /tweets,
// /tweets/refresh, and /tweets/status on a pre-shared bearer set via
// `wrangler secret put ACCESS_TOKEN` and an `Authorization` header from
// g2-app. See README → Deploy.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Each X API call costs money on the pay-per-use plan. Debounce client-side
// refreshes so a flurry of pull-to-refresh / foreground-enter triggers
// collapses to one API hit.
const REFRESH_DEBOUNCE_MS = 30_000
// Maximum time a refresh may stay in 'running' before we consider the lock
// stale (Worker died mid-fetch, etc.). Slightly above the X API fetch
// timeout (25s) so a clean abort always writes the terminal state first.
const REFRESH_RUNNING_LOCK_MS = 30_000

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  })
}

async function readMeta(env: Env): Promise<TweetsMeta | null> {
  const raw = await env.TWEETS_KV.get('tweets_meta')
  if (!raw) return null
  try {
    return JSON.parse(raw) as TweetsMeta
  } catch {
    return null
  }
}

async function readTweets(env: Env): Promise<Tweet[]> {
  const raw = await env.TWEETS_KV.get('tweets')
  if (!raw) return []
  try {
    return JSON.parse(raw) as Tweet[]
  } catch {
    return []
  }
}

// Do the X API fetch synchronously, merge with KV, write KV. Returns the
// freshly-merged list so the caller can decide whether to inline it in the
// response. Assumes the caller has already written the {state: 'running'}
// meta — only the terminal state is written here.
async function doRefresh(env: Env, requestId: string, startedAtIso: string): Promise<Tweet[]> {
  if (!env.X_BEARER_TOKEN || !env.X_USER_ID) {
    throw new Error('X_BEARER_TOKEN / X_USER_ID secret not configured')
  }

  const resp = await fetchHomeTimeline(env.X_USER_ID, env.X_BEARER_TOKEN)
  const fresh = normalize(resp)
  const existing = await readTweets(env)
  const merged = mergeAndCap(fresh, existing)

  const nowIso = new Date().toISOString()
  await env.TWEETS_KV.put('tweets', JSON.stringify(merged))
  const meta: TweetsMeta = {
    state: 'idle',
    last_handled_request_id: requestId,
    last_scraped_at: nowIso,
    started_at: startedAtIso,
  }
  await env.TWEETS_KV.put('tweets_meta', JSON.stringify(meta))
  return merged
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)
    const { pathname } = url

    if (pathname === '/tweets' && request.method === 'GET') {
      const tweets = await readTweets(env)
      if (tweets.length === 0) {
        return json({ error: 'No data available' }, 404)
      }
      return json(tweets)
    }

    if (pathname === '/tweets/refresh' && request.method === 'POST') {
      const now = Date.now()
      const meta = await readMeta(env)

      // In-flight lock: if an earlier invocation is still mid-fetch (state ===
      // 'running' and started_at within the lock window), return its
      // request_id with debounced: true so the client polls the same
      // operation instead of starting a parallel X API call.
      if (
        meta?.state === 'running' &&
        meta.last_handled_request_id &&
        meta.started_at
      ) {
        const age = now - Date.parse(meta.started_at)
        if (Number.isFinite(age) && age >= 0 && age < REFRESH_RUNNING_LOCK_MS) {
          return json({
            request_id: meta.last_handled_request_id,
            debounced: true,
          })
        }
        // Stale running lock (Worker died mid-fetch) — fall through to start
        // a fresh refresh.
      }

      // Success-only debounce: reuse a recent *successful* request_id so the
      // client's polling loop terminates immediately without burning another
      // X API read. Error states explicitly do NOT debounce — we want manual
      // retry after failure to fire a fresh call.
      if (
        meta?.state === 'idle' &&
        meta.last_scraped_at &&
        meta.last_handled_request_id
      ) {
        const age = now - Date.parse(meta.last_scraped_at)
        if (Number.isFinite(age) && age >= 0 && age < REFRESH_DEBOUNCE_MS) {
          return json({
            request_id: meta.last_handled_request_id,
            debounced: true,
          })
        }
      }

      const requestId = crypto.randomUUID()
      const startedAtIso = new Date(now).toISOString()
      // Claim the in-flight slot before we await the X API. Without this,
      // two concurrent /tweets/refresh requests both pass the debounce check
      // and each fire their own X API call, doubling cost.
      const runningMeta: TweetsMeta = {
        state: 'running',
        last_handled_request_id: requestId,
        last_scraped_at: meta?.last_scraped_at,
        started_at: startedAtIso,
      }
      await env.TWEETS_KV.put('tweets_meta', JSON.stringify(runningMeta))

      try {
        await doRefresh(env, requestId, startedAtIso)
        return json({ request_id: requestId, debounced: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Preserve last_scraped_at from the previous successful run — error
        // path must not extend the success cooldown window (otherwise a
        // failure debounces subsequent retries for 30s; see #4).
        const errMeta: TweetsMeta = {
          state: 'error',
          last_handled_request_id: requestId,
          last_scraped_at: meta?.last_scraped_at,
          started_at: startedAtIso,
          error: message,
        }
        await env.TWEETS_KV.put('tweets_meta', JSON.stringify(errMeta))
        return json({ request_id: requestId, error: message }, 502)
      }
    }

    if (pathname === '/tweets/status' && request.method === 'GET') {
      const meta = await readMeta(env)
      if (!meta) return json({ state: 'idle' } satisfies TweetsMeta)
      return json(meta)
    }

    return json({ status: 'ok' })
  },
}
