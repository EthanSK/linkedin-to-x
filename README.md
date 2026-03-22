# linkedin-to-x

Automatically cross-post your LinkedIn posts to X (Twitter). Scrapes your LinkedIn activity feed using Playwright with a persistent browser session, then posts to X via the official API.

## Features

- **Playwright-based scraping** --- uses a persistent browser profile so you stay logged into LinkedIn
- **Count-based deduplication** --- looks at the last 10 LinkedIn posts and compares against a tracker file (first 100 chars) to find what hasn't been posted yet
- **Immediate posting** --- new posts are sent to X right away (5-second delay between multiple posts)
- **OAuth 2.0 PKCE auth** --- authorize a different X account to post on behalf of via `linkedin-to-x auth`
- **Dry run** --- preview what would be posted without actually tweeting
- **280-char formatting** --- automatically truncates long posts and appends the LinkedIn source link

## Setup

### 1. Clone and install

```bash
git clone https://github.com/EthanSK/linkedin-to-x.git
cd linkedin-to-x
npm install
npm run build
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with:
- **X API credentials** --- create an app at [developer.x.com](https://developer.x.com) with OAuth 1.0a Read+Write
- **X OAuth 2.0 credentials** --- `X_CLIENT_ID` and `X_CLIENT_SECRET` from your X developer app (needed for `auth` command)
- **LinkedIn profile URL** --- e.g. `https://www.linkedin.com/in/ethansk`
- **Playwright profile dir** --- path to a Chromium profile that's logged into LinkedIn (defaults to `~/.claude/playwright-profile/`)

### 3. Log into LinkedIn in Playwright

The scraper needs an authenticated browser session. Open the persistent profile once:

```bash
npx playwright open --user-data-dir=~/.claude/playwright-profile https://www.linkedin.com/login
```

Log in manually, then close the browser. The session cookies persist in the profile directory.

### 4. Authorize a different X account (optional)

If you want to post to an X account different from the app owner, run the OAuth 2.0 flow:

```bash
npx tsx src/index.ts auth
```

This will:
1. Open your browser to X's authorization page
2. Start a local server on port 3333 for the callback
3. Exchange the authorization code for access + refresh tokens
4. Save tokens to `~/.linkedin-to-x/x-tokens.json`

When OAuth 2.0 tokens are present, the tool uses them (Bearer token) instead of OAuth 1.0a.

**Important:** You must add `http://localhost:3333/callback` as a callback URL in your X developer app settings.

### 5. Set up cron (optional)

```bash
# Every 30 minutes, check for new posts
*/30 * * * * cd /path/to/linkedin-to-x && npx tsx src/index.ts sync >> ~/.linkedin-to-x/cron.log 2>&1
```

## Usage

### Authorize a different X account

```bash
npx tsx src/index.ts auth
```

### List pending and posted

```bash
npx tsx src/index.ts list
```

Shows already-posted entries from the tracker, scrapes LinkedIn for recent posts, and displays what's pending.

### Sync (cross-post)

```bash
npx tsx src/index.ts sync
```

Scrapes LinkedIn (last 10 posts), finds any not yet posted to X, and posts them immediately with a 5-second delay between each.

### Dry run

```bash
npx tsx src/index.ts sync --dry-run
```

Shows what would be posted without actually sending anything.

## How it works

1. **Scrape** --- Playwright opens your LinkedIn `/recent-activity/all/` page in headless mode using a persistent browser profile with saved cookies.
2. **Extract** --- DOM selectors pull post text and activity URLs from the last 10 posts in the feed.
3. **Deduplicate** --- each post's text (first 100 chars, normalized) is compared against `~/.linkedin-to-x/posted.md` (a markdown table of everything already cross-posted).
4. **Post** --- new posts are sent to X immediately via the API (OAuth 2.0 Bearer if authorized, otherwise OAuth 1.0a), with a 5-second delay between each post.

## Data files

All state is stored in `~/.linkedin-to-x/`:

| File | Purpose |
|---|---|
| `posted.md` | Markdown table tracking all cross-posted items (snippet + X post ID) |
| `x-tokens.json` | OAuth 2.0 access + refresh tokens (created by `auth` command) |

## License

MIT
