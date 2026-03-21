#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { formatForX, postTweet } from "./x-client.js";
import { startMonitor } from "./linkedin-monitor.js";

const program = new Command();

program
  .name("linkedin-to-x")
  .description("Cross-post LinkedIn posts to X/Twitter")
  .version("1.0.0");

program
  .command("post <text>")
  .description("Post text to X/Twitter")
  .option("-l, --linkedin-url <url>", "Link back to original LinkedIn post")
  .action(async (text: string, opts: { linkedinUrl?: string }) => {
    const config = loadConfig();
    const tweetText = formatForX(text, opts.linkedinUrl);

    console.log(`Posting to X (${tweetText.length} chars):`);
    console.log(`"${tweetText}"\n`);

    const result = await postTweet(config.x, tweetText);

    if (result.success) {
      console.log(`Tweet posted successfully!`);
      console.log(`https://x.com/i/status/${result.tweetId}`);
    } else {
      console.error(`Failed to post: ${result.error}`);
      process.exit(1);
    }
  });

program
  .command("monitor")
  .description("Poll LinkedIn RSS feed and auto-post new items to X")
  .action(async () => {
    const config = loadConfig();
    await startMonitor(config);
  });

program.parse();
