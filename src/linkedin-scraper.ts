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

    // LinkedIn post containers
    const postContainers = document.querySelectorAll(".feed-shared-update-v2");

    for (const container of postContainers) {
      // Extract text content — try multiple selectors, filter for spans with real content
      let text = "";

      const textSelectors = [
        ".feed-shared-inline-show-more-text span[dir='ltr']",
        ".feed-shared-update-v2__commentary span[dir='ltr']",
        ".update-components-text span[dir='ltr']",
      ];

      for (const selector of textSelectors) {
        if (text) break;
        const spans = container.querySelectorAll(selector);
        const parts: string[] = [];
        for (const span of spans) {
          const content = span.textContent?.trim() || "";
          if (content.length > 20) {
            parts.push(content);
          }
        }
        if (parts.length > 0) {
          text = parts.join("\n").trim();
        }
      }

      if (!text) continue;

      // Extract timestamp — try aria-hidden span first, then <time> element
      let timestamp: string | null = null;
      const timeSpan = container.querySelector(
        ".feed-shared-actor__sub-description span[aria-hidden='true']"
      );
      if (timeSpan) {
        // Parse relative time strings like "2h", "1d", "3w"
        const relText = timeSpan.textContent?.trim() || "";
        const relMatch = relText.match(/(\d+)\s*(m|h|d|w|mo|y)/);
        if (relMatch) {
          const num = parseInt(relMatch[1], 10);
          const unit = relMatch[2];
          const now = Date.now();
          const ms: Record<string, number> = {
            m: 60_000,
            h: 3_600_000,
            d: 86_400_000,
            w: 604_800_000,
            mo: 2_592_000_000,
            y: 31_536_000_000,
          };
          if (ms[unit]) {
            timestamp = new Date(now - num * ms[unit]).toISOString();
          }
        }
      }
      if (!timestamp) {
        const timeEl = container.querySelector("time");
        if (timeEl) {
          timestamp = timeEl.getAttribute("datetime");
        }
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
