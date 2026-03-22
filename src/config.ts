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

export interface XOAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export interface FacebookCredentials {
  pageId: string;
  accessToken: string;
}

export interface Config {
  x: XCredentials;
  xOAuth2?: XOAuth2Tokens;
  xClientId?: string;
  xClientSecret?: string;
  linkedin: {
    profileUrl: string;
  };
  facebook?: FacebookCredentials;
  facebookEnabled: boolean;
  playwrightProfileDir: string;
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

function getTokensPath(): string {
  return path.join(os.homedir(), ".linkedin-to-x", "x-tokens.json");
}

export function loadOAuth2Tokens(): XOAuth2Tokens | null {
  const tokensPath = getTokensPath();
  if (!fs.existsSync(tokensPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
  } catch {
    return null;
  }
}

export function saveOAuth2Tokens(tokens: XOAuth2Tokens): void {
  const tokensPath = getTokensPath();
  const dir = path.dirname(tokensPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf-8");
}

export function loadConfig(): Config {
  const dataDir = path.join(os.homedir(), ".linkedin-to-x");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const defaultPlaywrightDir = path.join(os.homedir(), ".claude", "playwright-profile");

  const oauth2Tokens = loadOAuth2Tokens();

  const facebookEnabled = process.env.FACEBOOK_ENABLED === "true";
  let facebook: FacebookCredentials | undefined;

  if (facebookEnabled) {
    const fbPageId = process.env.FB_PAGE_ID;
    const fbAccessToken = process.env.FB_ACCESS_TOKEN;
    if (!fbPageId || !fbAccessToken) {
      console.error(
        "FACEBOOK_ENABLED is true but FB_PAGE_ID or FB_ACCESS_TOKEN is missing."
      );
      console.error("Set these in your .env file or disable Facebook posting.");
      process.exit(1);
    }
    facebook = { pageId: fbPageId, accessToken: fbAccessToken };
  }

  return {
    x: {
      apiKey: requireEnv("X_API_KEY"),
      apiSecret: requireEnv("X_API_SECRET"),
      accessToken: requireEnv("X_ACCESS_TOKEN"),
      accessTokenSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
    },
    xOAuth2: oauth2Tokens ?? undefined,
    xClientId: process.env.X_CLIENT_ID,
    xClientSecret: process.env.X_CLIENT_SECRET,
    linkedin: {
      profileUrl: requireEnv("LINKEDIN_PROFILE_URL"),
    },
    facebook,
    facebookEnabled,
    playwrightProfileDir: process.env.PLAYWRIGHT_PROFILE_DIR || defaultPlaywrightDir,
    dataDir,
    trackerFilePath: path.join(dataDir, "posted.md"),
  };
}
