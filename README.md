# Twitter for evanG2 (OSS)

> ⚠️ **Status: unverified / experimental.** This fork was migrated from a working private edition (Playwright scraper) to the X API v2, but the end-to-end flow against the live X API has not been tested yet. The original private edition is in production daily; this OSS variant is the design only. Verify against your own account before relying on it, and please open an issue if anything fails. PRs welcome.

A text-only Twitter / X timeline reader for the [Even Realities G2](https://evenrealities.com/) e-paper smart glasses. Strips out images, videos, retweets, and replies — just the text of your home timeline, rendered on the 576×288 / 16-grayscale e-paper display.

This is a public-API fork of the original [private edition](https://github.com/your-org/Twitter-for-evanG2). Instead of Playwright scraping, this version reads via the official **X API v2 reverse-chronological home timeline** endpoint, so:

- ✅ No home PC required (no scraper daemon)
- ✅ No browser cookies — uses official OAuth bearer token
- ✅ Compliant with X's developer terms
- ⚠️ **You pay X's pay-per-use API rates yourself** (see [Cost](#cost) below)

## Architecture

```
┌──────────────┐    HTTPS    ┌──────────────────┐   HTTPS   ┌──────────┐
│  G2 glasses  │ ──────────▶ │ Cloudflare       │ ────────▶ │  X API   │
│  Even Hub    │             │ Worker (yours)   │ ◀──────── │  v2      │
│  app         │ ◀────────── │ + KV cache       │           └──────────┘
└──────────────┘    JSON     └──────────────────┘
```

- **Worker** — A Cloudflare Worker you deploy under your account. Calls X API on each refresh, normalizes & filters the result, caches in Workers KV.
- **g2-app** — The Even Hub app that runs in the Even Realities phone app and renders to your G2 glasses. You sideload it to your own Even Hub via the Developer Portal.

The Worker exposes three endpoints consumed by `g2-app`:

| Endpoint | Purpose |
| --- | --- |
| `GET /tweets` | Latest cached timeline |
| `POST /tweets/refresh` | Trigger an X API fetch (synchronous, debounced 30s) |
| `GET /tweets/status` | Returns the last-completed `request_id` so the app can confirm completion |

## Cost

X retired the $100/$200/month tiers for new signups in February 2026. New developers default to **pay-per-use**:

- **$0.005 per post read**, capped at 2M reads/month
- Same post fetched twice within 24h UTC counts as one read (deduplication applies)

Rough estimate based on usage patterns:

| User type | New tweets/month (post-dedup) | Estimated cost |
| --- | --- | --- |
| Light (open the app a few times a day) | ~5,000 | **~$25/month** |
| Heavy (always-on, frequent refresh) | ~20,000 | **~$100/month** |

> Numbers are indicative only. Check your X Developer Portal dashboard for actual usage. There is currently no free tier that supports the home timeline endpoint.

## Prerequisites

- A **Cloudflare** account (Workers + KV — free tier is sufficient)
- An **X (Twitter) Developer** account with pay-per-use enabled
- An **Even Realities Hub** developer account (free) for sideloading the app
- Node.js 20+ and `npm`

## Setup

### 1. Get an X API bearer token (OAuth 2.0 User Context)

The reverse-chronological home timeline endpoint requires a **User Context** OAuth 2.0 access token — an app-only bearer cannot read someone's home feed.

1. Sign up at https://developer.x.com and enable pay-per-use.
2. Create a new project + app. Set the user-authentication settings to allow OAuth 2.0, request the `tweet.read` and `users.read` scopes (offline.access if you want refresh tokens).
3. Run a one-time OAuth 2.0 PKCE flow against your own X account to obtain an access token. Any of the standard tools work — for example:
   - The [twurl](https://github.com/twitterdev/twurl) CLI
   - Postman's built-in OAuth 2.0 helper
   - A few lines of Python with [`tweepy`](https://docs.tweepy.org/) or [`requests-oauthlib`](https://requests-oauthlib.readthedocs.io/)
4. Note your numeric **X user ID** (not your `@handle`). You can look this up at https://tweeterid.com or by calling `GET /2/users/me` with your token.

> ⚠️ The bearer token grants read access to your timeline. Store it only in Wrangler secrets (next step) — never commit it.

### 2. Deploy the Worker

```bash
cd worker
npm install

# Authenticate wrangler against your Cloudflare account
npx wrangler login

# Create a KV namespace and copy the printed ID into wrangler.toml
npx wrangler kv:namespace create TWEETS_KV

# Copy the example config and edit it
cp wrangler.example.toml wrangler.toml
# → fill in account_id and the kv_namespaces id

# Set secrets (you'll be prompted to paste the values)
npx wrangler secret put X_BEARER_TOKEN
npx wrangler secret put X_USER_ID

# Deploy
npx wrangler deploy
```

Verify with `curl`:

```bash
curl -X POST https://twitter-for-evang2.<your-subdomain>.workers.dev/tweets/refresh
curl https://twitter-for-evang2.<your-subdomain>.workers.dev/tweets | jq '. | length'
```

### 3. Build & sideload the g2-app

```bash
cd ../g2-app
npm install

# Configure your worker URL
cp .env.example .env
# → set VITE_WORKER_BASE_URL to your deployed worker URL

# Configure your Even Hub app metadata
cp app.example.json app.json
# → set package_id (must be globally unique, e.g. com.yourname.twitterforg2)
# → set the network whitelist URL to match VITE_WORKER_BASE_URL exactly

# Build the .ehpk
npm run build
npx evenhub pack app.json dist
```

Then upload `out.ehpk` to https://hub.evenrealities.com as a **Test App** under your developer account. Install it from the Even Hub phone app onto your G2 glasses.

### 4. Local development

```bash
# Terminal 1: Vite dev server
cd g2-app
npm run dev

# Terminal 2: QR code for the Even Hub phone app to scan
npx evenhub qr --port 5173

# Or, run the desktop simulator
npm run sim
```

## Operation

When you launch the app on your G2:

1. **Mode select screen** appears. Pick "Auto" (10-second auto-advance) or "Manual" (ring-controlled paging only).
2. The app fetches your timeline from your Worker, which calls the X API.
3. Scroll/tap with the Even R1 ring to page through tweets. Pull-up at the very top to refresh.

Filters applied server-side and in the Worker (matching the original scraper's behavior):

- Retweets & replies — excluded at the X API query level
- Quote tweets — dropped during normalization (text-only display loses the quoted body)
- Media-attached tweets — dropped (e-paper can't show images / video)

The Worker keeps up to 300 most-recent tweets in KV, deduplicated by `(user_id, posted_at)`.

## Limitations

- **7-day window**: X API only serves tweets posted within the last 7 days.
- **No streaming**: Updates are pull-based, triggered by the app (launch / foreground-enter / pull-to-refresh / AUTO precharge). There's no live push.
- **Schema drift**: If X changes its API response shape, you'll need to update `worker/src/normalize.ts`. PRs welcome.
- **Single user**: Each Worker reads one X account's home timeline (defined by `X_USER_ID`). To share the app between multiple people, each person deploys their own Worker.

## Project layout

```
Twitter-for-evanG2-oss/
├── worker/                       # Cloudflare Worker (X API client + KV)
│   ├── src/
│   │   ├── index.ts              # HTTP endpoints
│   │   ├── x-api-client.ts       # X API v2 reverse_chronological fetch
│   │   ├── normalize.ts          # Filter, expand t.co, merge & cap
│   │   └── types.ts              # Wire format shared with g2-app
│   ├── wrangler.example.toml
│   ├── package.json
│   └── tsconfig.json
│
├── g2-app/                       # Even Hub SDK app (renders on G2)
│   ├── src/
│   │   ├── main.ts               # Layout, render loop, event handling
│   │   ├── api.ts                # Worker client (reads VITE_WORKER_BASE_URL)
│   │   ├── refresh.ts            # Refresh/diff/prepend pipeline
│   │   └── …
│   ├── app.example.json
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── docs/
│   └── refresh-triggers.md       # Refresh trigger reference (Japanese)
│
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

Derived from the private Twitter-for-evanG2 project. The g2-app rendering code, refresh state machine, and AUTO precharge logic are unchanged; only the data-source layer (scraper → X API) and the Worker have been rewritten.
