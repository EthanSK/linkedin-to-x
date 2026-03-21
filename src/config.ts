import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

dotenv.config();

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface Config {
  x: XCredentials;
  linkedin: {
    profileUrl: string;
  };
  playwrightProfileDir: string;
  maxPostAgeDays: number;
  dataDir: string;
  trackerFilePath: string;
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

  const defaultPlaywrightDir = path.join(os.homedir(), ".claude", "playwright-profile");

  return {
    x: {
      apiKey: requireEnv("X_API_KEY"),
      apiSecret: requireEnv("X_API_SECRET"),
      accessToken: requireEnv("X_ACCESS_TOKEN"),
      accessTokenSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
    },
    linkedin: {
      profileUrl: requireEnv("LINKEDIN_PROFILE_URL"),
    },
    playwrightProfileDir: process.env.PLAYWRIGHT_PROFILE_DIR || defaultPlaywrightDir,
    maxPostAgeDays: parseInt(process.env.MAX_POST_AGE_DAYS || "2", 10),
    dataDir,
    trackerFilePath: path.join(dataDir, "posted.md"),
  };
}
