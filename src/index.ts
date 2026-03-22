#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { scrapeLinkedInPosts, LinkedInPost } from "./linkedin-scraper.js";
import { formatForX, postTweet, startOAuth2Flow } from "./x-client.js";
import {
  postToFacebook,
  postToFacebookWithLink,
} from "./facebook-client.js";
import {
  loadTracker,
  addTrackerEntry,
  isAlreadyPosted,
  snippetForTracker,
  loadFbTracker,
  addFbTrackerEntry,
  isAlreadyPostedToFb,
} from "./tracker.js";

const program = new Command();

program
  .name("linkedin-to-x")
  .description("Cross-post LinkedIn posts to X/Twitter and Facebook via Playwright scraping")
  .version("2.1.0");

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
  .description("Scrape LinkedIn, find new posts, cross-post to X and optionally Facebook")
  .option("--dry-run", "Show what would be posted without actually posting")
  .option("--facebook-only", "Only post to Facebook (skip X)")
  .option("--x-only", "Only post to X (skip Facebook even if enabled)")
  .action(async (opts: { dryRun?: boolean; facebookOnly?: boolean; xOnly?: boolean }) => {
    const config = loadConfig();
    console.log("=== LinkedIn to X Sync ===\n");

    const postToX = !opts.facebookOnly;
    const postToFb = config.facebookEnabled && !opts.xOnly;

    if (postToFb) {
      console.log("Facebook posting: ENABLED");
    }

    // 1. Scrape LinkedIn (last 10 posts max)
    const posts = await scrapeLinkedInPosts(config);
    if (posts.length === 0) {
      console.log("No posts found on LinkedIn (or not logged in).");
      return;
    }

    // 2. Load trackers
    const trackerEntries = loadTracker(config.trackerFilePath);
    const fbTrackerEntries = postToFb ? loadFbTracker(config.trackerFilePath) : [];
    console.log(`X tracker has ${trackerEntries.length} existing entries.`);
    if (postToFb) {
      console.log(`Facebook tracker has ${fbTrackerEntries.length} existing entries.`);
    }

    // 3. Filter out already-posted items (consider a post "new" if it hasn't been posted to at least one target platform)
    let newPostsForX: LinkedInPost[] = [];
    let newPostsForFb: LinkedInPost[] = [];

    if (postToX) {
      newPostsForX = posts.filter((p) => !isAlreadyPosted(trackerEntries, p.text));
      console.log(`Found ${newPostsForX.length} new post(s) for X.`);
    }
    if (postToFb) {
      newPostsForFb = posts.filter((p) => !isAlreadyPostedToFb(fbTrackerEntries, p.text));
      console.log(`Found ${newPostsForFb.length} new post(s) for Facebook.`);
    }

    const hasWork = newPostsForX.length > 0 || newPostsForFb.length > 0;
    if (!hasWork) {
      console.log("\nNothing new to post. All caught up!");
      return;
    }

    console.log();

    // 4. Build a combined set of posts to process (union of X and FB new posts)
    const allNewPostTexts = new Set<string>();
    for (const p of [...newPostsForX, ...newPostsForFb]) {
      allNewPostTexts.add(p.text);
    }
    const allNewPosts = posts.filter((p) => allNewPostTexts.has(p.text));

    // Post oldest first (reverse since LinkedIn shows newest first)
    const postsToSend = [...allNewPosts].reverse();

    let xSuccessCount = 0;
    let fbSuccessCount = 0;

    for (let i = 0; i < postsToSend.length; i++) {
      const post = postsToSend[i];
      const preview = post.text.slice(0, 100).replace(/\n/g, " ");

      const shouldPostToX = postToX && newPostsForX.some((p) => p.text === post.text);
      const shouldPostToFb = postToFb && newPostsForFb.some((p) => p.text === post.text);

      // --- Post to X ---
      if (shouldPostToX) {
        const tweetText = formatForX(post.text);

        if (opts.dryRun) {
          console.log(`[DRY RUN] Would post to X: "${preview}..."`);
        } else {
          console.log(`Posting to X: "${preview}..."`);

          const result = await postTweet(config.x, tweetText);

          if (result.success && result.tweetId) {
            console.log(`  -> X: Success! https://x.com/i/status/${result.tweetId}`);

            addTrackerEntry(config.trackerFilePath, {
              linkedinSnippet: snippetForTracker(post.text),
              datePostedToX: new Date().toISOString(),
              xPostId: result.tweetId,
            });

            xSuccessCount++;
          } else {
            console.error(`  -> X: Failed: ${result.error}`);
          }
        }
      }

      // --- Post to Facebook ---
      if (shouldPostToFb && config.facebook) {
        if (opts.dryRun) {
          console.log(`[DRY RUN] Would post to Facebook: "${preview}..."`);
        } else {
          console.log(`Posting to Facebook: "${preview}..."`);

          const fbResult = post.url
            ? await postToFacebookWithLink(config.facebook, post.text, post.url)
            : await postToFacebook(config.facebook, post.text);

          if (fbResult.success && fbResult.postId) {
            console.log(`  -> Facebook: Success! Post ID: ${fbResult.postId}`);

            addFbTrackerEntry(config.trackerFilePath, {
              linkedinSnippet: snippetForTracker(post.text),
              datePostedToFb: new Date().toISOString(),
              fbPostId: fbResult.postId,
            });

            fbSuccessCount++;
          } else {
            console.error(`  -> Facebook: Failed: ${fbResult.error}`);
          }
        }
      }

      // 5 second delay between posts
      if (i < postsToSend.length - 1) {
        console.log("  Waiting 60 seconds...");
        await new Promise((r) => setTimeout(r, 60000));
      }
    }

    if (!opts.dryRun) {
      const parts: string[] = [];
      if (postToX) parts.push(`X: ${xSuccessCount}/${newPostsForX.length}`);
      if (postToFb) parts.push(`Facebook: ${fbSuccessCount}/${newPostsForFb.length}`);
      console.log(`\nDone. Cross-posted ${parts.join(", ")}.`);
      console.log(`Tracker: ${config.trackerFilePath}`);
    }
  });

program
  .command("list")
  .description("Show what has been posted and what is pending")
  .action(async () => {
    const config = loadConfig();
    console.log("=== LinkedIn to X Status ===\n");

    // Load trackers
    const trackerEntries = loadTracker(config.trackerFilePath);
    const fbTrackerEntries = config.facebookEnabled
      ? loadFbTracker(config.trackerFilePath)
      : [];

    console.log(`--- Already Posted to X (${trackerEntries.length} entries) ---`);
    if (trackerEntries.length === 0) {
      console.log("  (none)\n");
    } else {
      for (const entry of trackerEntries) {
        console.log(`  [${entry.datePostedToX}] ${entry.linkedinSnippet}`);
        console.log(`    -> https://x.com/i/status/${entry.xPostId}`);
      }
      console.log();
    }

    if (config.facebookEnabled) {
      console.log(`--- Already Posted to Facebook (${fbTrackerEntries.length} entries) ---`);
      if (fbTrackerEntries.length === 0) {
        console.log("  (none)\n");
      } else {
        for (const entry of fbTrackerEntries) {
          console.log(`  [${entry.datePostedToFb}] ${entry.linkedinSnippet}`);
          console.log(`    -> FB Post ID: ${entry.fbPostId}`);
        }
        console.log();
      }
    }

    // Scrape LinkedIn for current posts
    console.log("Scraping LinkedIn for recent posts...\n");
    const posts = await scrapeLinkedInPosts(config);

    if (posts.length === 0) {
      console.log("No posts found on LinkedIn (or not logged in).");
      return;
    }

    const pendingX = posts.filter((p) => !isAlreadyPosted(trackerEntries, p.text));
    const pendingFb = config.facebookEnabled
      ? posts.filter((p) => !isAlreadyPostedToFb(fbTrackerEntries, p.text))
      : [];

    console.log(`--- Pending for X (${pendingX.length} posts) ---`);
    if (pendingX.length === 0) {
      console.log("  All caught up! Nothing to post to X.");
    } else {
      for (const post of pendingX) {
        const snippet = post.text.replace(/\n/g, " ").slice(0, 100);
        console.log(`  ${snippet}...`);
      }
    }

    if (config.facebookEnabled) {
      console.log(`\n--- Pending for Facebook (${pendingFb.length} posts) ---`);
      if (pendingFb.length === 0) {
        console.log("  All caught up! Nothing to post to Facebook.");
      } else {
        for (const post of pendingFb) {
          const snippet = post.text.replace(/\n/g, " ").slice(0, 100);
          console.log(`  ${snippet}...`);
        }
      }
    }
  });

program.parse();
