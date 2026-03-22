import { chromium, type BrowserContext, type Page } from "playwright";
import { Config } from "./config.js";

export interface LinkedInPost {
  text: string;
  url: string | null;
}

const MAX_POSTS = 10;

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

    const posts = await extractPosts(page);
    console.log(`Extracted ${posts.length} post(s) (max ${MAX_POSTS}).`);

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

async function extractPosts(page: Page): Promise<LinkedInPost[]> {
  const posts = await page.evaluate((maxPosts: number) => {
    const results: Array<{ text: string; url: string | null }> = [];

    // LinkedIn post containers
    const postContainers = document.querySelectorAll(".feed-shared-update-v2");

    for (const container of postContainers) {
      if (results.length >= maxPosts) break;

      // Skip reposts/shares — look for "reposted this" indicator
      const headerText = container.querySelector(".update-components-header")?.textContent || "";
      const socialActionText = container.querySelector(".feed-shared-header")?.textContent || "";
      const fullHeaderArea = container.querySelector(".update-components-actor")?.textContent || "";
      const containerText = container.textContent || "";

      // Check for repost indicators
      const isRepost =
        headerText.toLowerCase().includes("reposted") ||
        socialActionText.toLowerCase().includes("reposted") ||
        // Check for "reposted this" anywhere near the top of the post
        containerText.slice(0, 300).toLowerCase().includes("reposted this") ||
        containerText.slice(0, 300).toLowerCase().includes("reposted");

      // Also check if the author is not Ethan (the profile owner)
      const actorName = container.querySelector(".update-components-actor__name")?.textContent?.trim() || "";
      const isNotOwner = actorName &&
        !actorName.toLowerCase().includes("ethan") &&
        !actorName.toLowerCase().includes("sarif-kattan") &&
        !actorName.toLowerCase().includes("ethansk");

      if (isRepost || isNotOwner) {
        continue;
      }

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
          // Use innerText to preserve line breaks from <br> tags
          const content = (span as HTMLElement).innerText?.trim() || "";
          if (content.length > 20) {
            parts.push(content);
          }
        }
        if (parts.length > 0) {
          text = parts.join("\n").trim();
        }
      }

      // Extract external links (GitHub, etc.) from the post — keep them in the text
      const linkElements = container.querySelectorAll(
        ".feed-shared-inline-show-more-text a[href], .feed-shared-update-v2__commentary a[href], .update-components-text a[href]"
      );
      for (const link of linkElements) {
        const href = (link as HTMLAnchorElement).href;
        const linkText = link.textContent?.trim() || "";
        // If the link text is a shortened URL (like lnkd.in or bit.ly), replace with the actual href
        if (linkText && href && !href.includes("linkedin.com") && !text.includes(href)) {
          // Replace shortened link text with the full URL if it looks like a shortened link
          if (linkText.match(/^https?:\/\//) || linkText.match(/\.\.\./)) {
            text = text.replace(linkText, href);
          }
        }
      }

      if (!text) continue;

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

      results.push({ text, url });
    }

    return results;
  }, MAX_POSTS);

  return posts;
}
