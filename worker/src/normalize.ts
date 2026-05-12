import type { Tweet, XApiTimelineResponse, XApiTweet, XApiUser } from './types'

// Translate the X API v2 timeline payload into the wire format the g2-app
// consumes. Drops tweets that the e-paper reader can't usefully render:
// media-attached, quote tweets, and anything missing required fields.
//
// The shape mirrors what scraper.py used to produce — see
// scraper/src/scraper/scraper.py:_extract_tweet in the original repo.

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeHtmlEntities(s: string): string {
  // Named entities first, then numeric (&#1234; / &#x4e2d;).
  let out = s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, m => HTML_ENTITIES[m] ?? m)
  out = out.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCodePoint(parseInt(code, 16)),
  )
  return out
}

function expandUrls(
  text: string,
  urls: { url: string; display_url?: string }[] | undefined,
): string {
  if (!urls) return text
  let out = text
  for (const u of urls) {
    if (u.url && u.display_url) {
      out = out.split(u.url).join(u.display_url)
    }
  }
  return out
}

function cleanText(
  raw: string,
  urls: { url: string; display_url?: string }[] | undefined,
): string {
  return decodeHtmlEntities(expandUrls(raw, urls)).trim()
}

function isFilteredTweet(t: XApiTweet): boolean {
  // Media-attached: e-paper can't show images/video. The scraper had the same
  // rule for `entities.media` / `extended_entities.media`.
  if (t.attachments?.media_keys && t.attachments.media_keys.length > 0) return true
  // Quote tweets: same as the original filter (text-only display, quoted body
  // would be lost). RTs and replies are already excluded server-side via the
  // `exclude` query param.
  if (t.referenced_tweets?.some(r => r.type === 'quoted')) return true
  return false
}

export function normalize(payload: XApiTimelineResponse): Tweet[] {
  const tweets = payload.data ?? []
  const users = new Map<string, XApiUser>()
  for (const u of payload.includes?.users ?? []) users.set(u.id, u)

  const out: Tweet[] = []
  for (const t of tweets) {
    if (isFilteredTweet(t)) continue

    // note_tweet (long-form) carries the full text + its own entity_set.
    // Prefer it over the truncated `text` field when present.
    const useNote = t.note_tweet?.text != null && t.note_tweet.text.length > 0
    const rawText = useNote ? t.note_tweet!.text : t.text
    const urls = useNote
      ? t.note_tweet!.entities?.urls
      : t.entities?.urls
    const text = cleanText(rawText, urls)
    if (!text) continue

    const author = t.author_id ? users.get(t.author_id) : undefined
    if (!author) continue
    if (!t.created_at) continue

    out.push({
      posted_at: t.created_at,
      user_id: author.username,
      user_name: author.name,
      text,
      reply_count: String(t.public_metrics?.reply_count ?? 0),
      retweet_count: String(t.public_metrics?.retweet_count ?? 0),
      like_count: String(t.public_metrics?.like_count ?? 0),
    })
  }

  return out
}

// Merge fresh and existing tweet lists, dedup by (user_id, posted_at), sort
// newest-first, and cap at `keep`. Matches the original worker behavior of
// preserving recent history beyond a single scrape.
export function mergeAndCap(
  fresh: Tweet[],
  existing: Tweet[],
  keep = 300,
): Tweet[] {
  const seen = new Set<string>()
  const merged: Tweet[] = []
  for (const t of [...fresh, ...existing]) {
    const k = `${t.user_id}\t${t.posted_at}`
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(t)
  }
  merged.sort((a, b) => (a.posted_at < b.posted_at ? 1 : a.posted_at > b.posted_at ? -1 : 0))
  return merged.slice(0, keep)
}
