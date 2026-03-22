const https = require("https");
const fs = require("fs");

const tokens = JSON.parse(
  fs.readFileSync("/Users/ethansk/.ai-huebot/tokens.json", "utf8")
);
const ACCESS_TOKEN = tokens.access_token;
const BASE_URL = "https://api.meethue.com/route/api/0/lights";

function hueRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method,
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Convert hex to CIE xy (approximate via sRGB -> XYZ -> xy)
function hexToXY(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return [0.33, 0.33];
  return [X / sum, Y / sum];
}

const PALETTES = [
  { name: "Deep Ocean Blue", hex: "#0033CC" },
  { name: "Electric Cyan", hex: "#00FFFF" },
  { name: "Vivid Purple", hex: "#9933FF" },
  { name: "Hot Pink", hex: "#FF0066" },
  { name: "Emerald Green", hex: "#00CC66" },
  { name: "Sunset Orange", hex: "#FF6633" },
  { name: "Royal Blue", hex: "#4169E1" },
  { name: "Magenta", hex: "#FF00FF" },
  { name: "Teal", hex: "#008080" },
  { name: "Golden Amber", hex: "#FFB300" },
];

const DURATION_MS = 20 * 60 * 1000; // 20 minutes
const INTERVAL_MS = 30 * 1000; // 30 seconds

async function main() {
  // List all lights
  console.log("Listing all lights...");
  const lights = await hueRequest("GET", "", null);

  let bathroomId = null;
  for (const [id, light] of Object.entries(lights)) {
    console.log(`  Light ${id}: "${light.name}"`);
    if (light.name && (light.name.toLowerCase().includes("bathroom") || light.name.toLowerCase().includes("bthrm"))) {
      bathroomId = id;
    }
  }

  if (!bathroomId) {
    console.error("Could not find bathroom light!");
    process.exit(1);
  }

  console.log(`\nFound bathroom light: ID ${bathroomId} ("${lights[bathroomId].name}")`);
  console.log(`Starting 20-minute color animation with 30s transitions...\n`);

  // Turn on and set brightness to 80% (204 out of 254)
  const bri = Math.round(254 * 0.8);
  let colorIndex = 0;
  const startTime = Date.now();

  // Set first color immediately
  async function setColor() {
    const elapsed = Date.now() - startTime;
    if (elapsed >= DURATION_MS) return false;

    const palette = PALETTES[colorIndex % PALETTES.length];
    const [x, y] = hexToXY(palette.hex);
    const minutesLeft = ((DURATION_MS - elapsed) / 60000).toFixed(1);

    console.log(
      `[${new Date().toLocaleTimeString()}] Setting: ${palette.name} (${palette.hex}) | xy: [${x.toFixed(4)}, ${y.toFixed(4)}] | ${minutesLeft} min remaining`
    );

    await hueRequest("PUT", `/${bathroomId}/state`, {
      on: true,
      bri,
      xy: [x, y],
      transitiontime: 20, // 2 seconds
    });

    colorIndex++;
    return true;
  }

  // Set first color
  await setColor();

  // Set up interval
  const interval = setInterval(async () => {
    const shouldContinue = await setColor();
    if (!shouldContinue) {
      clearInterval(interval);
    }
  }, INTERVAL_MS);

  // Set up timeout to stop after 20 minutes
  setTimeout(async () => {
    clearInterval(interval);
    console.log("\n20 minutes elapsed. Resetting to warm white...");

    await hueRequest("PUT", `/${bathroomId}/state`, {
      on: true,
      bri: Math.round(254 * 0.6), // 60%
      xy: [0.4476, 0.4075],
      transitiontime: 20,
    });

    console.log("Done! Light reset to warm white (60% brightness).");
    process.exit(0);
  }, DURATION_MS);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
