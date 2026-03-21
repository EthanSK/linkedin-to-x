import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

dotenv.config();

export interface Config {
  x: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  };
  linkedin: {
    rssUrl: string | null;
  };
  pollIntervalMinutes: number;
  dataDir: string;
  postedFilePath: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error(`Copy .env.example to .env and fill in your credentials.`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): Config {
  const dataDir = path.join(os.homedir(), ".linkedin-to-x");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return {
    x: {
      apiKey: requireEnv("X_API_KEY"),
      apiSecret: requireEnv("X_API_SECRET"),
      accessToken: requireEnv("X_ACCESS_TOKEN"),
      accessTokenSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
    },
    linkedin: {
      rssUrl: process.env.LINKEDIN_RSS_URL || null,
    },
    pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || "15", 10),
    dataDir,
    postedFilePath: path.join(dataDir, "posted.json"),
  };
}

export function loadPostedIds(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return new Set(data);
  } catch {
    return new Set();
  }
}

export function savePostedIds(filePath: string, ids: Set<string>): void {
  fs.writeFileSync(filePath, JSON.stringify([...ids], null, 2));
}
