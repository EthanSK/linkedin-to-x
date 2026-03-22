#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { scrapeLinkedInPosts, LinkedInPost } from "./linkedin-scraper.js";
import { formatForX, postTweet, startOAuth2Flow } from "./x-client.js";
import {
  loadTracker,
  addTrackerEntry,
  isAlreadyPosted,
  snippetForTracker,
} from "./tracker.js";

const program = new Command();

program
  .name("linkedin-to-x")
  .description("Cross-post LinkedIn posts to X/Twitter via Playwright scraping")
  .version("2.0.0");

program
  .command("auth")
  .description("Authorize a different X account via OAuth 2.0 PKCE flow")
  .action(async () => {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("Missing X_CLIENT_ID or X_CLIENT_SECRET in environment.");
      console.error("Set these in your .env file.");
      process.exit(1);
    }

    await startOAuth2Flow(clientId, clientSecret);
  });

program
  .command("sync")
  .description("Scrape LinkedIn, find new posts, cross-post to X immediately")
  .option("--dry-run", "Show what would be posted without actually posting")
  .action(async (opts: { dryRun?: boolean }) => {
    const config = loadConfig();
    console.log("=== LinkedIn to X Sync ===\n");

    // 1. Scrape LinkedIn (last 10 posts max)
    const posts = await scrapeLinkedInPosts(config);
    if (posts.length === 0) {
      console.log("No posts found on LinkedIn (or not logged in).");
      return;
    }

    // 2. Load tracker to see what's already been posted
    const trackerEntries = loadTracker(config.trackerFilePath);
    console.log(`Tracker has ${trackerEntries.length} existing entries.`);

    // 3. Filter out already-posted items
    const newPosts = posts.filter((p) => !isAlreadyPosted(trackerEntries, p.text));
    console.log(`Found ${newPosts.length} new post(s) to cross-post.\n`);

    if (newPosts.length === 0) {
      console.log("Nothing new to post. All caught up!");
      return;
    }

    // 4. Post immediately, one at a time with 5s delay
    let successCount = 0;
    // Post oldest first (reverse since LinkedIn shows newest first)
    const postsToSend = [...newPosts].reverse();

    for (let i = 0; i < postsToSend.length; i++) {
      const post = postsToSend[i];
      const tweetText = formatForX(post.text, post.url);
      const preview = tweetText.slice(0, 100).replace(/\n/g, " ");

      if (opts.dryRun) {
        console.log(`[DRY RUN] Would post: "${preview}..."`);
        continue;
      }

      console.log(`Posting to X: "${preview}..."`);

      const result = await postTweet(config.x, tweetText);

      if (result.success && result.tweetId) {
        console.log(`  -> Success! https://x.com/i/status/${result.tweetId}`);

        addTrackerEntry(config.trackerFilePath, {
          linkedinSnippet: snippetForTracker(post.text),
          datePostedToX: new Date().toISOString(),
          xPostId: result.tweetId,
        });

        successCount++;
      } else {
        console.error(`  -> Failed: ${result.error}`);
      }

      // 5 second delay between posts
      if (i < postsToSend.length - 1) {
        console.log("  Waiting 5 seconds...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    if (!opts.dryRun) {
      console.log(`\nDone. Cross-posted ${successCount}/${postsToSend.length} post(s).`);
      console.log(`Tracker: ${config.trackerFilePath}`);
    }
  });

program
  .command("list")
  .description("Show what has been posted and what is pending")
  .action(async () => {
    const config = loadConfig();
    console.log("=== LinkedIn to X Status ===\n");

    // Load tracker
    const trackerEntries = loadTracker(config.trackerFilePath);

    console.log(`--- Already Posted (${trackerEntries.length} entries) ---`);
    if (trackerEntries.length === 0) {
      console.log("  (none)\n");
    } else {
      for (const entry of trackerEntries) {
        console.log(`  [${entry.datePostedToX}] ${entry.linkedinSnippet}`);
        console.log(`    -> https://x.com/i/status/${entry.xPostId}`);
      }
      console.log();
    }

    // Scrape LinkedIn for current posts
    console.log("Scraping LinkedIn for recent posts...\n");
    const posts = await scrapeLinkedInPosts(config);

    if (posts.length === 0) {
      console.log("No posts found on LinkedIn (or not logged in).");
      return;
    }

    const pending = posts.filter((p) => !isAlreadyPosted(trackerEntries, p.text));

    console.log(`--- Pending (${pending.length} posts) ---`);
    if (pending.length === 0) {
      console.log("  All caught up! Nothing to post.");
    } else {
      for (const post of pending) {
        const snippet = post.text.replace(/\n/g, " ").slice(0, 100);
        console.log(`  ${snippet}...`);
      }
    }
  });

program.parse();
