import * as crypto from "crypto";
import * as https from "https";

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

interface TweetResponse {
  data?: { id: string; text: string };
  errors?: Array<{ message: string; type: string }>;
  detail?: string;
  title?: string;
}

const X_CHAR_LIMIT = 280;
const URL_CHAR_LENGTH = 23; // X counts all URLs as 23 chars

export function formatForX(text: string, linkedinUrl?: string): string {
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
