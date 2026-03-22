#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { scrapeLinkedInPosts, LinkedInPost } from "./linkedin-scraper.js";
import { formatForX, postTweet } from "./x-client.js";
import {
  loadTracker,
  addTrackerEntry,
  isAlreadyPosted,
  snippetForTracker,
  normalizeSnippet,
} from "./tracker.js";
import {
  buildSchedule,
  loadSchedule,
  saveSchedule,
  getDuePosts,
  markPosted,
  ScheduleFile,
} from "./scheduler.js";

const program = new Command();

program
  .name("linkedin-to-x")
  .description("Cross-post LinkedIn posts to X/Twitter via Playwright scraping")
  .version("2.0.0");

program
  .command("sync")
  .description("Scrape LinkedIn, find new posts from last 2 days, cross-post to X")
  .option("--dry-run", "Show what would be posted without actually posting")
  .action(async (opts: { dryRun?: boolean }) => {
    const config = loadConfig();
    console.log("=== LinkedIn to X Sync ===\n");

    // 1. Scrape LinkedIn
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

    // 4. Build or load a schedule with gap preservation
    let schedule = loadSchedule(config.dataDir);

    // Check if we need to create a new schedule (new posts detected)
    const scheduledTexts = schedule?.posts.map((p) => normalizeSnippet(p.text)) ?? [];
    const unscheduled = newPosts.filter(
      (p) => !scheduledTexts.includes(normalizeSnippet(p.text))
    );

    if (unscheduled.length > 0) {
      console.log(`Scheduling ${unscheduled.length} new post(s) with gap preservation...`);
      const newScheduledPosts = buildSchedule(unscheduled);

      if (schedule) {
        schedule.posts.push(...newScheduledPosts);
      } else {
        schedule = {
          createdAt: new Date().toISOString(),
          posts: newScheduledPosts,
        };
      }
      saveSchedule(config.dataDir, schedule);

      for (const sp of newScheduledPosts) {
        const preview = sp.text.replace(/\n/g, " ").slice(0, 80);
        console.log(`  Scheduled for ${sp.scheduledFor}: "${preview}..."`);
      }
      console.log();
    }

    // 5. Post any due items from the schedule
    const duePosts = getDuePosts(schedule!);
    if (duePosts.length === 0) {
      const nextUnposted = schedule!.posts.find((p) => !p.posted);
      if (nextUnposted) {
        console.log(`No posts due yet. Next scheduled: ${nextUnposted.scheduledFor}`);
      }
      return;
    }

    let successCount = 0;
    for (const due of duePosts) {
      const tweetText = formatForX(due.text, due.url);
      const preview = tweetText.slice(0, 100).replace(/\n/g, " ");

      if (opts.dryRun) {
        console.log(`[DRY RUN] Would post: "${preview}..."`);
        continue;
      }

      console.log(`Posting to X: "${preview}..."`);

      const result = await postTweet(config.x, tweetText);

      if (result.success && result.tweetId) {
        console.log(`  -> Success! https://x.com/i/status/${result.tweetId}`);

        // Mark as posted in schedule
        const idx = schedule!.posts.indexOf(due);
        markPosted(schedule!, idx);
        saveSchedule(config.dataDir, schedule!);

        addTrackerEntry(config.trackerFilePath, {
          linkedinSnippet: snippetForTracker(due.text),
          datePostedToX: new Date().toISOString(),
          xPostId: result.tweetId,
        });

        successCount++;
      } else {
        console.error(`  -> Failed: ${result.error}`);
      }

      // Small delay between posts
      if (duePosts.indexOf(due) < duePosts.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!opts.dryRun) {
      console.log(`\nDone. Cross-posted ${successCount}/${duePosts.length} due post(s).`);
      console.log(`Tracker: ${config.trackerFilePath}`);
      console.log(`Schedule: ${config.dataDir}/scheduled.json`);
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
        const age = post.timestamp
          ? `${Math.round((Date.now() - post.timestamp.getTime()) / (1000 * 60 * 60))}h ago`
          : "unknown age";
        console.log(`  [${age}] ${snippet}...`);
      }
    }
  });

program.parse();
