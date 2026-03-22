import * as fs from "fs";
import * as path from "path";
import { LinkedInPost } from "./linkedin-scraper.js";

const MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes minimum between posts

export interface ScheduledPost {
  text: string;
  url: string | null;
  linkedinTimestamp: string | null;
  scheduledFor: string; // ISO timestamp
  posted: boolean;
}

export interface ScheduleFile {
  createdAt: string;
  posts: ScheduledPost[];
}

function getSchedulePath(dataDir: string): string {
  return path.join(dataDir, "scheduled.json");
}

export function loadSchedule(dataDir: string): ScheduleFile | null {
  const filePath = getSchedulePath(dataDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function saveSchedule(dataDir: string, schedule: ScheduleFile): void {
  const filePath = getSchedulePath(dataDir);
  fs.writeFileSync(filePath, JSON.stringify(schedule, null, 2), "utf-8");
}

/**
 * Creates a posting schedule that preserves the time gaps between LinkedIn posts.
 * Posts are ordered oldest-first. The first post is scheduled for `now`, and
 * subsequent posts are spaced with the same gaps as on LinkedIn (minimum 5 min).
 */
export function buildSchedule(posts: LinkedInPost[]): ScheduledPost[] {
  if (posts.length === 0) return [];

  // Sort oldest first
  const sorted = [...posts].sort((a, b) => {
    const ta = a.timestamp?.getTime() ?? 0;
    const tb = b.timestamp?.getTime() ?? 0;
    return ta - tb;
  });

  const now = Date.now();
  const scheduled: ScheduledPost[] = [];

  for (let i = 0; i < sorted.length; i++) {
    let scheduledTime: number;

    if (i === 0) {
      scheduledTime = now;
    } else {
      const prevLinkedinTime = sorted[i - 1].timestamp?.getTime();
      const currLinkedinTime = sorted[i].timestamp?.getTime();

      if (prevLinkedinTime && currLinkedinTime) {
        // Preserve the original gap, but enforce minimum
        const gap = Math.max(currLinkedinTime - prevLinkedinTime, MIN_GAP_MS);
        const prevScheduled = new Date(scheduled[i - 1].scheduledFor).getTime();
        scheduledTime = prevScheduled + gap;
      } else {
        // No timestamps available — use minimum gap
        const prevScheduled = new Date(scheduled[i - 1].scheduledFor).getTime();
        scheduledTime = prevScheduled + MIN_GAP_MS;
      }
    }

    scheduled.push({
      text: sorted[i].text,
      url: sorted[i].url,
      linkedinTimestamp: sorted[i].timestamp?.toISOString() ?? null,
      scheduledFor: new Date(scheduledTime).toISOString(),
      posted: false,
    });
  }

  return scheduled;
}

/**
 * Returns posts from the schedule that are due (scheduledFor <= now and not yet posted).
 */
export function getDuePosts(schedule: ScheduleFile): ScheduledPost[] {
  const now = Date.now();
  return schedule.posts.filter(
    (p) => !p.posted && new Date(p.scheduledFor).getTime() <= now
  );
}

/**
 * Marks a post as posted in the schedule.
 */
export function markPosted(schedule: ScheduleFile, index: number): void {
  if (index >= 0 && index < schedule.posts.length) {
    schedule.posts[index].posted = true;
  }
}
