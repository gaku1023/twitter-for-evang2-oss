import type { Tweet } from './types'

// Set VITE_WORKER_BASE_URL in g2-app/.env to point at your deployed Cloudflare
// Worker (e.g. https://twitter-for-evang2.<your-subdomain>.workers.dev). The
// same URL must also be listed in app.json's `network` permission whitelist —
// the Even Hub runtime blocks fetches to any other origin.
const envBase = import.meta.env.VITE_WORKER_BASE_URL as string | undefined
if (!envBase) {
  throw new Error(
    'VITE_WORKER_BASE_URL is not set. Copy g2-app/.env.example to .env and fill it in.',
  )
}
export const WORKER_BASE_URL = envBase

export interface TweetsMeta {
  state: 'idle' | 'running' | 'error'
  last_handled_request_id?: string
  last_scraped_at?: string
  error?: string
}

// The OSS worker fetches synchronously from the X API on /tweets/refresh, so
// `fresh` is currently a no-op — kept in the signature to preserve the
// caller's contract.
export async function fetchTweets(_opts: { fresh?: boolean } = {}): Promise<Tweet[]> {
  const params = new URLSearchParams({ t: String(Date.now()) })
  const res = await fetch(`${WORKER_BASE_URL}/tweets?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  return res.json() as Promise<Tweet[]>
}

export async function requestRefresh(): Promise<{ request_id: string; debounced: boolean }> {
  const res = await fetch(`${WORKER_BASE_URL}/tweets/refresh?t=${Date.now()}`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
  return res.json() as Promise<{ request_id: string; debounced: boolean }>
}

export async function fetchStatus(): Promise<TweetsMeta> {
  const res = await fetch(`${WORKER_BASE_URL}/tweets/status?t=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`status failed: ${res.status}`)
  return res.json() as Promise<TweetsMeta>
}
