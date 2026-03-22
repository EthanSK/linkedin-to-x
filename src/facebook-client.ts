import * as https from "https";

export interface FacebookConfig {
  pageId: string;
  accessToken: string;
}

interface FacebookPostResponse {
  id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
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

/**
 * Post a message to a Facebook Page using the Graph API.
 *
 * Endpoint: POST https://graph.facebook.com/v21.0/{page-id}/feed
 * Requires a Page Access Token with pages_manage_posts permission.
 */
export async function postToFacebook(
  config: FacebookConfig,
  message: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const url = `https://graph.facebook.com/v21.0/${config.pageId}/feed`;

  const body = new URLSearchParams({
    message,
    access_token: config.accessToken,
  }).toString();

  const parsed = new URL(url);

  try {
    const response = await httpsRequest(
      url,
      {
        method: "POST",
        hostname: parsed.hostname,
        path: parsed.pathname,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      body
    );

    const result: FacebookPostResponse = JSON.parse(response.body);

    if (response.statusCode === 200 && result.id) {
      return { success: true, postId: result.id };
    }

    const errorMsg =
      result.error?.message ||
      `HTTP ${response.statusCode}: ${response.body}`;
    return { success: false, error: errorMsg };
  } catch (err) {
    return {
      success: false,
      error: `Facebook API request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Post a message with a link to a Facebook Page.
 * The link parameter makes Facebook generate a link preview.
 */
export async function postToFacebookWithLink(
  config: FacebookConfig,
  message: string,
  link: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const url = `https://graph.facebook.com/v21.0/${config.pageId}/feed`;

  const body = new URLSearchParams({
    message,
    link,
    access_token: config.accessToken,
  }).toString();

  const parsed = new URL(url);

  try {
    const response = await httpsRequest(
      url,
      {
        method: "POST",
        hostname: parsed.hostname,
        path: parsed.pathname,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      body
    );

    const result: FacebookPostResponse = JSON.parse(response.body);

    if (response.statusCode === 200 && result.id) {
      return { success: true, postId: result.id };
    }

    const errorMsg =
      result.error?.message ||
      `HTTP ${response.statusCode}: ${response.body}`;
    return { success: false, error: errorMsg };
  } catch (err) {
    return {
      success: false,
      error: `Facebook API request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
