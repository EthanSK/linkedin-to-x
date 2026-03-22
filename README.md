# linkedin-to-x

Automatically cross-post your LinkedIn posts to X (Twitter). Scrapes your LinkedIn activity feed using Playwright with a persistent browser session, then posts to X via the official API --- preserving the original timing gaps between posts.

## Features

- **Playwright-based scraping** --- uses a persistent browser profile so you stay logged into LinkedIn
- **Gap preservation** --- when multiple posts are queued, they're scheduled with the same time gaps as the originals (minimum 5-minute spacing)
- **Duplicate detection** --- tracks what's already been posted so nothing gets cross-posted twice
- **Cron-friendly** --- run `sync` on a schedule with built-in random delay support; only posts that are "due" get sent
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
- **LinkedIn profile URL** --- e.g. `https://www.linkedin.com/in/ethansk`
- **Playwright profile dir** --- path to a Chromium profile that's logged into LinkedIn (defaults to `~/.claude/playwright-profile/`)

### 3. Log into LinkedIn in Playwright

The scraper needs an authenticated browser session. Open the persistent profile once:

```bash
npx playwright open --user-data-dir=~/.claude/playwright-profile https://www.linkedin.com/login
```

Log in manually, then close the browser. The session cookies persist in the profile directory.

### 4. Set up cron (optional)

```bash
# Every 30 minutes, check for due posts
*/30 * * * * cd /path/to/linkedin-to-x && npx tsx src/index.ts sync >> ~/.linkedin-to-x/cron.log 2>&1
```

## Usage

### List pending and posted

```bash
npx tsx src/index.ts list
```

Shows already-posted entries from the tracker, scrapes LinkedIn for recent posts, and displays what's pending.

### Sync (cross-post)

```bash
npx tsx src/index.ts sync
```

Scrapes LinkedIn, builds a schedule preserving timing gaps, and posts anything that's due to X.

### Dry run

```bash
npx tsx src/index.ts sync --dry-run
```

Shows what would be posted without actually sending anything.

## How it works

1. **Scrape** --- Playwright opens your LinkedIn `/recent-activity/all/` page in headless mode using a persistent browser profile with saved cookies.
2. **Extract** --- DOM selectors pull post text, timestamps, and activity URLs from the feed.
3. **Deduplicate** --- each post's text is normalized and compared against `~/.linkedin-to-x/posted.md` (a markdown table of everything already cross-posted).
4. **Schedule** --- new posts are written to `~/.linkedin-to-x/scheduled.json` with timestamps that preserve the original gaps between LinkedIn posts (minimum 5 minutes apart).
5. **Post** --- on each `sync` run, any scheduled posts whose time has arrived are sent to X via OAuth 1.0a, then marked as posted in both the schedule and tracker.

## Data files

All state is stored in `~/.linkedin-to-x/`:

| File | Purpose |
|---|---|
| `posted.md` | Markdown table tracking all cross-posted items |
| `scheduled.json` | Pending post schedule with gap-preserved timestamps |

## License

MIT
