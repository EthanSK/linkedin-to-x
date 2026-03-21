# linkedin-to-x

Cross-post LinkedIn posts to X/Twitter. Supports manual posting via CLI and automatic polling via RSS feed.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get X/Twitter API credentials

1. Go to [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Create a project and app (Free tier works)
3. Enable **OAuth 1.0a** with **Read and Write** permissions
4. Generate an access token and secret

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your X API credentials
```

### 4. (Optional) Set up LinkedIn RSS feed

LinkedIn doesn't offer a public RSS feed, so you need a third-party service:

- [rss.app](https://rss.app/) - Create a feed from any LinkedIn profile URL
- [Feedfry](https://feedfry.com/) or similar

Set `LINKEDIN_RSS_URL` in your `.env` file to the generated feed URL.

## Usage

### Manual posting

```bash
# Post text directly to X
npx tsx src/index.ts post "Hello from LinkedIn!"

# Post with a link back to the original LinkedIn post
npx tsx src/index.ts post "My latest thoughts on AI" --linkedin-url "https://linkedin.com/posts/..."
```

### Monitor mode (auto cross-post)

```bash
# Poll RSS feed for new LinkedIn posts and auto-post to X
npx tsx src/index.ts monitor
```

This will poll the configured RSS feed every 15 minutes (configurable via `POLL_INTERVAL_MINUTES`) and cross-post new items to X.

### After building

```bash
npm run build
linkedin-to-x post "Hello world"
linkedin-to-x monitor
```

## How it works

- **Manual mode**: You paste your LinkedIn post text and it gets formatted and posted to X via the API v2.
- **Monitor mode**: Polls an RSS feed for new LinkedIn posts. New items are formatted (truncated to 280 chars if needed, with a link back to the original) and posted to X.
- **Duplicate prevention**: Posted item IDs are stored in `~/.linkedin-to-x/posted.json` so the same post is never cross-posted twice.
- **Character limits**: Posts longer than 280 characters are truncated with an ellipsis, and a link to the original LinkedIn post is appended.

## Run as a cron job

```bash
# Build first
npm run build

# Add to crontab (every 15 minutes)
crontab -e
# */15 * * * * cd /path/to/linkedin-to-x && node dist/index.js monitor
```

## License

MIT
