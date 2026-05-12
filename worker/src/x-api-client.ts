import type { XApiTimelineResponse } from './types'

// Reverse-chronological home timeline of the authenticated user.
//
// Docs: https://docs.x.com/x-api/users/user-home-timeline-by-user-id
//
// `userId` must be the *numeric* X user ID (not @handle). The bearer token
// must be a User Context OAuth 2.0 access token for that same user — an App-
// only bearer cannot read someone's home timeline.
//
// `exclude=retweets,replies` keeps the call cheap (we drop them anyway).
// Quotes are excluded post-hoc via referenced_tweets since the API doesn't
// support excluding them at query time.
export async function fetchHomeTimeline(
  userId: string,
  bearerToken: string,
  maxResults = 100,
): Promise<XApiTimelineResponse> {
  const params = new URLSearchParams({
    max_results: String(maxResults),
    exclude: 'retweets,replies',
    'tweet.fields': [
      'created_at',
      'author_id',
      'entities',
      'attachments',
      'referenced_tweets',
      'public_metrics',
      'note_tweet',
    ].join(','),
    expansions: 'author_id',
    'user.fields': 'name,username',
  })

  const url = `https://api.x.com/2/users/${encodeURIComponent(userId)}/timelines/reverse_chronological?${params.toString()}`

  // Explicit 25s timeout — below Cloudflare's 30s request CPU limit so we
  // surface an AbortError to the error path before the platform kills the
  // Worker invocation.
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'User-Agent': 'twitter-for-evanG2-oss',
    },
    signal: AbortSignal.timeout(25_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`X API ${res.status}: ${body.slice(0, 300)}`)
  }

  return (await res.json()) as XApiTimelineResponse
}
