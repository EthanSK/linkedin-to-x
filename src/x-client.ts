import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import { execFile } from "child_process";
import { XCredentials, XOAuth2Tokens, loadOAuth2Tokens } from "./config.js";

interface TweetResponse {
  data?: { id: string; text: string };
  errors?: Array<{ message: string; type: string }>;
  detail?: string;
  title?: string;
}

const X_CHAR_LIMIT = 280;
const URL_CHAR_LENGTH = 23; // X counts all URLs as 23 chars

export function formatForX(text: string, linkedinUrl?: string | null): string {
  const suffix = linkedinUrl ? `\n\n${linkedinUrl}` : "";
  const suffixLength = linkedinUrl ? 2 + URL_CHAR_LENGTH : 0;
  const availableChars = X_CHAR_LIMIT - suffixLength;

  if (text.length <= availableChars) {
    return text + suffix;
  }

  // Truncate with ellipsis
  const truncated = text.slice(0, availableChars - 1) + "\u2026";
  return truncated + suffix;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function buildOAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  body?: Record<string, string>
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and body params for signature base
  const allParams: Record<string, string> = { ...oauthParams };
  if (body) {
    Object.assign(allParams, body);
  }

  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ statusCode: res.statusCode || 0, body: data })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function postTweet(
  creds: XCredentials,
  text: string
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  // Check for OAuth 2.0 tokens first (user-authorized flow)
  const oauth2Tokens = loadOAuth2Tokens();
  if (oauth2Tokens) {
    return postTweetOAuth2(oauth2Tokens, text);
  }

  // Fall back to OAuth 1.0a
  return postTweetOAuth1(creds, text);
}

async function postTweetOAuth1(
  creds: XCredentials,
  text: string
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  const url = "https://api.x.com/2/tweets";
  const jsonBody = JSON.stringify({ text });

  const authHeader = buildOAuthHeader("POST", url, creds);

  const parsed = new URL(url);
  const response = await httpsRequest(
    url,
    {
      method: "POST",
      hostname: parsed.hostname,
      path: parsed.pathname,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(jsonBody),
      },
    },
    jsonBody
  );

  const result: TweetResponse = JSON.parse(response.body);

  if (response.statusCode === 201 && result.data) {
    return { success: true, tweetId: result.data.id };
  }

  const errorMsg =
    result.detail ||
    result.errors?.map((e) => e.message).join("; ") ||
    `HTTP ${response.statusCode}: ${response.body}`;
  return { success: false, error: errorMsg };
}

async function postTweetOAuth2(
  tokens: XOAuth2Tokens,
  text: string
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  const url = "https://api.x.com/2/tweets";
  const jsonBody = JSON.stringify({ text });

  const parsed = new URL(url);
  const response = await httpsRequest(
    url,
    {
      method: "POST",
      hostname: parsed.hostname,
      path: parsed.pathname,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(jsonBody),
      },
    },
    jsonBody
  );

  const result: TweetResponse = JSON.parse(response.body);

  if (response.statusCode === 201 && result.data) {
    return { success: true, tweetId: result.data.id };
  }

  const errorMsg =
    result.detail ||
    result.errors?.map((e) => e.message).join("; ") ||
    `HTTP ${response.statusCode}: ${response.body}`;
  return { success: false, error: errorMsg };
}

// --- OAuth 2.0 PKCE Auth Flow ---

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function startOAuth2Flow(clientId: string, clientSecret: string): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = "http://localhost:3333/callback";

  const scopes = ["tweet.read", "tweet.write", "users.read", "offline.access"];

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("\n=== X OAuth 2.0 Authorization ===\n");
  console.log("Open this URL in your browser to authorize:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback on http://localhost:3333/callback ...\n");

  // Try to open the URL automatically
  try {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    execFile(cmd, [authUrl.toString()]);
  } catch {
    // Ignore - user can open manually
  }

  // Start local server to receive the callback
  const code = await waitForCallback(state);

  console.log("Received authorization code. Exchanging for tokens...\n");

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(clientId, clientSecret, code, codeVerifier, redirectUri);

  // Save tokens
  const { saveOAuth2Tokens } = await import("./config.js");
  saveOAuth2Tokens(tokens);

  console.log("Tokens saved to ~/.linkedin-to-x/x-tokens.json");
  console.log("The x-client will now use OAuth 2.0 Bearer tokens for posting.");
  console.log("\nDone! You can now run `linkedin-to-x sync` to cross-post.\n");
}

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", "http://localhost:3333");

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Authorization Failed</h1><p>Error: ${error}</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Authorization Failed</h1><p>State mismatch.</p>`);
          server.close();
          reject(new Error("State mismatch in OAuth callback"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Authorization Failed</h1><p>No code received.</p>`);
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>Authorization Successful!</h1><p>You can close this tab and return to the terminal.</p>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(3333, () => {
      console.log("Local callback server listening on port 3333...");
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback (5 minutes)"));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  }).toString();

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await httpsRequest(
    "https://api.x.com/2/oauth2/token",
    {
      method: "POST",
      hostname: "api.x.com",
      path: "/2/oauth2/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Basic ${basicAuth}`,
      },
    },
    body
  );

  const result = JSON.parse(response.body);

  if (response.statusCode !== 200 || !result.access_token) {
    throw new Error(
      `Token exchange failed: ${result.error_description || result.error || response.body}`
    );
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + (result.expires_in || 7200) * 1000,
  };
}
