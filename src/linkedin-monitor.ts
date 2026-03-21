import RssParser from "rss-parser";
import { Config, loadPostedIds, savePostedIds } from "./config.js";
import { formatForX, postTweet } from "./x-client.js";

interface FeedItem {
  id: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  link?: string;
  pubDate?: string;
}

const parser = new RssParser();

async function fetchLinkedInFeed(rssUrl: string): Promise<FeedItem[]> {
  try {
    const feed = await parser.parseURL(rssUrl);
    return feed.items.map((item) => ({
      id: item.guid || item.link || item.title || "",
      title: item.title,
      contentSnippet: item.contentSnippet,
      content: item.content,
      link: item.link,
      pubDate: item.pubDate,
    }));
  } catch (err) {
    console.error("Failed to fetch RSS feed:", err);
    return [];
  }
}

function extractPostText(item: FeedItem): string {
  // Prefer contentSnippet (plain text), fall back to title
  return item.contentSnippet || item.title || "";
}

async function processItems(config: Config, items: FeedItem[]): Promise<void> {
  const postedIds = loadPostedIds(config.postedFilePath);
  let newCount = 0;

  for (const item of items) {
    if (!item.id || postedIds.has(item.id)) {
      continue;
    }

    const text = extractPostText(item);
    if (!text.trim()) {
      console.log(`Skipping empty post: ${item.id}`);
      postedIds.add(item.id);
      savePostedIds(config.postedFilePath, postedIds);
      continue;
    }

    const tweetText = formatForX(text, item.link);
    console.log(`\nPosting to X: "${tweetText.slice(0, 80)}..."`);

    const result = await postTweet(config.x, tweetText);

    if (result.success) {
      console.log(`Posted tweet ${result.tweetId}`);
      postedIds.add(item.id);
      savePostedIds(config.postedFilePath, postedIds);
      newCount++;
    } else {
      console.error(`Failed to post: ${result.error}`);
      // Don't mark as posted so we retry next time
    }

    // Small delay between posts to avoid rate limits
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (newCount === 0) {
    console.log("No new posts to cross-post.");
  } else {
    console.log(`\nCross-posted ${newCount} new post(s) to X.`);
  }
}

export async function pollOnce(config: Config): Promise<void> {
  if (!config.linkedin.rssUrl) {
    console.error(
      "LINKEDIN_RSS_URL is not set. Set it in .env to use monitor mode."
    );
    process.exit(1);
  }

  console.log(`Fetching LinkedIn RSS feed...`);
  const items = await fetchLinkedInFeed(config.linkedin.rssUrl);
  console.log(`Found ${items.length} item(s) in feed.`);
  await processItems(config, items);
}

export async function startMonitor(config: Config): Promise<void> {
  console.log(
    `Starting LinkedIn monitor (polling every ${config.pollIntervalMinutes} min)...`
  );
  console.log(`Data stored in: ${config.dataDir}`);

  // Initial poll
  await pollOnce(config);

  // Continue polling
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  setInterval(async () => {
    console.log(`\n[${new Date().toISOString()}] Polling...`);
    try {
      await pollOnce(config);
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, intervalMs);
}
