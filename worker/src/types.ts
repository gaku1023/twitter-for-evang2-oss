// Wire format returned to the g2-app frontend. Keep field names / string
// types compatible with g2-app/src/types.ts — the app expects counts as
// strings, not numbers.
export interface Tweet {
  posted_at: string
  user_id: string
  user_name: string
  text: string
  reply_count: string
  retweet_count: string
  like_count: string
}

export interface TweetsMeta {
  state: 'idle' | 'running' | 'error'
  last_handled_request_id?: string
  last_scraped_at?: string
  // Wall-clock start of the most recent refresh. Set when state transitions
  // to 'running'; used to expire stuck in-flight locks if a Worker dies mid-
  // request and the 'idle'/'error' write never lands.
  started_at?: string
  error?: string
}

// X API v2 response shapes (only the fields we consume).
export interface XApiTweet {
  id: string
  text: string
  created_at?: string
  author_id?: string
  attachments?: { media_keys?: string[] }
  entities?: {
    urls?: { url: string; expanded_url?: string; display_url?: string; start?: number; end?: number }[]
  }
  referenced_tweets?: { type: 'retweeted' | 'quoted' | 'replied_to'; id: string }[]
  public_metrics?: {
    reply_count: number
    retweet_count: number
    like_count: number
    quote_count?: number
  }
  note_tweet?: {
    text: string
    entities?: {
      urls?: { url: string; expanded_url?: string; display_url?: string; start?: number; end?: number }[]
    }
  }
}

export interface XApiUser {
  id: string
  name: string
  username: string
}

export interface XApiTimelineResponse {
  data?: XApiTweet[]
  includes?: { users?: XApiUser[] }
  meta?: { result_count: number; next_token?: string }
  errors?: { title: string; detail?: string }[]
}
