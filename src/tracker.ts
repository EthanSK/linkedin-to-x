import * as fs from "fs";

export interface TrackerEntry {
  linkedinSnippet: string;
  datePostedToX: string;
  xPostId: string;
}

const HEADER = `# LinkedIn to X - Posted Tracker

This file tracks posts that have been cross-posted from LinkedIn to X.
Do not delete this file — if deleted, only posts from the last 2 days will be considered.

| LinkedIn Post Snippet | Date Posted to X | X Post ID |
|---|---|---|`;

export function loadTracker(filePath: string): TrackerEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const entries: TrackerEntry[] = [];

    for (const line of lines) {
      // Match table rows: | snippet | date | id |
      const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (match && match[1] !== "LinkedIn Post Snippet" && match[1] !== "---") {
        entries.push({
          linkedinSnippet: match[1],
          datePostedToX: match[2],
          xPostId: match[3],
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export function saveTracker(filePath: string, entries: TrackerEntry[]): void {
  const rows = entries.map(
    (e) => `| ${e.linkedinSnippet} | ${e.datePostedToX} | ${e.xPostId} |`
  );
  const content = HEADER + "\n" + rows.join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}

export function addTrackerEntry(
  filePath: string,
  entry: TrackerEntry
): void {
  const entries = loadTracker(filePath);
  entries.push(entry);
  saveTracker(filePath, entries);
}

export function isAlreadyPosted(
  entries: TrackerEntry[],
  postSnippet: string
): boolean {
  // Compare by normalized snippet (first 80 chars)
  const needle = normalizeSnippet(postSnippet);
  return entries.some((e) => normalizeSnippet(e.linkedinSnippet) === needle);
}

export function normalizeSnippet(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .toLowerCase();
}

export function snippetForTracker(text: string): string {
  // Escape pipes for markdown table, truncate to 80 chars
  const clean = text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  if (clean.length > 80) {
    return clean.slice(0, 77) + "...";
  }
  return clean;
}
