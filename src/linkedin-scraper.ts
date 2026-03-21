import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Config } from "./config.js";

export interface LinkedInPost {
  text: string;
  timestamp: Date | null;
  url: string | null;
}

export async function scrapeLinkedInPosts(config: Config): Promise<LinkedInPost[]> {
  const profileUrl = config.linkedin.profileUrl.replace(/\/$/, "");
  const activityUrl = `${profileUrl}/recent-activity/all/`;

  console.log(`Launching browser with profile: ${config.playwrightProfileDir}`);
  console.log(`Navigating to: ${activityUrl}`);

  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(config.playwrightProfileDir, {
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 900 },
    });

    const page = context.pages()[0] || await context.newPage();

    await page.goto(activityUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for the feed to load
    await page.waitForTimeout(3000);

    // Check if we're redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
      console.error("Not logged in to LinkedIn. Please log in using the persistent browser profile first.");
      console.error(`Profile dir: ${config.playwrightProfileDir}`);
      console.error("You can log in by running a Playwright session manually or via Claude's browser.");
      return [];
    }

    // Scroll down a bit to load more posts
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(2000);

    const posts = await extractPosts(page, config.maxPostAgeDays);
    console.log(`Extracted ${posts.length} post(s) from the last ${config.maxPostAgeDays} day(s).`);

    return posts;
  } catch (err) {
    console.error("Error scraping LinkedIn:", err);
    return [];
  } finally {
    if (context) {
      await context.close();
    }
  }
}

async function extractPosts(page: Page, maxAgeDays: number): Promise<LinkedInPost[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  // Try multiple selectors that LinkedIn uses for post containers
  const posts = await page.evaluate((cutoffMs: number) => {
    const results: Array<{ text: string; timestamp: string | null; url: string | null }> = [];

    // LinkedIn uses various selectors for feed posts
    const postContainers = document.querySelectorAll(
      ".feed-shared-update-v2, .profile-creator-shared-feed-update__container, [data-urn*='activity']"
    );

    for (const container of postContainers) {
      // Extract text content from the post
      const textEl = container.querySelector(
        ".feed-shared-update-v2__description, .feed-shared-text, .break-words, .update-components-text, span[dir='ltr']"
      );
      let text = "";
      if (textEl) {
        text = textEl.textContent?.trim() || "";
      }

      if (!text) {
        // Try broader text extraction
        const commentaryEl = container.querySelector(
          ".feed-shared-update-v2__commentary, .update-components-text__text-view"
        );
        text = commentaryEl?.textContent?.trim() || "";
      }

      if (!text) continue;

      // Extract timestamp
      let timestamp: string | null = null;
      const timeEl = container.querySelector("time");
      if (timeEl) {
        timestamp = timeEl.getAttribute("datetime");
      }

      // Extract post URL from the activity URN or share link
      let url: string | null = null;
      const urnAttr = container.getAttribute("data-urn");
      if (urnAttr) {
        const activityMatch = urnAttr.match(/activity:(\d+)/);
        if (activityMatch) {
          url = `https://www.linkedin.com/feed/update/urn:li:activity:${activityMatch[1]}/`;
        }
      }

      // Also check for share links
      if (!url) {
        const shareLink = container.querySelector("a[href*='/feed/update/']");
        if (shareLink) {
          url = (shareLink as HTMLAnchorElement).href;
        }
      }

      results.push({ text, timestamp, url });
    }

    return results;
  }, cutoffDate.getTime());

  // Filter by date and convert
  return posts
    .map((p) => ({
      text: p.text,
      timestamp: p.timestamp ? new Date(p.timestamp) : null,
      url: p.url,
    }))
    .filter((p) => {
      if (!p.timestamp) {
        // If no timestamp, include it (assume recent)
        return true;
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - maxAgeDays);
      return p.timestamp >= cutoff;
    });
}
