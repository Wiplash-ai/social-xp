import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(projectRoot, "dist", "chrome");
const userDataPath = path.join(projectRoot, ".wip", "playwright-demo-profile");
const demos = {
  x: { url: "https://x.com/home", fixture: "x.html", patterns: ["https://x.com/*"] },
  linkedin: { url: "https://www.linkedin.com/feed/", fixture: "linkedin.html", patterns: ["https://www.linkedin.com/*"] },
  threads: { url: "https://www.threads.net/", fixture: "threads.html", patterns: ["https://www.threads.net/*"] },
  discord: { url: "https://discord.com/channels/@me", fixture: "discord.html", patterns: ["https://discord.com/*"] },
  reddit: { url: "https://www.reddit.com/", fixture: "reddit.html", patterns: ["https://www.reddit.com/*"] },
  facebook: { url: "https://www.facebook.com/", fixture: "facebook.html", patterns: ["https://www.facebook.com/*"] },
  bluesky: { url: "https://bsky.app/", fixture: "bluesky.html", patterns: ["https://bsky.app/*"] }
};

const site = String(process.argv[2] || "x").toLowerCase();
const demo = demos[site];
const headless = process.env.SOCIAL_XP_DEMO_HEADLESS === "1";
const autoCloseMs = Number(process.env.SOCIAL_XP_DEMO_AUTO_CLOSE_MS || 0);

if (!demo) {
  throw new Error(`Unknown demo "${site}". Choose one of: ${Object.keys(demos).join(", ")}.`);
}

await mkdir(userDataPath, { recursive: true });

const context = await chromium.launchPersistentContext(userDataPath, {
  headless,
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--disable-default-apps"
  ]
});

const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
const page = context.pages()[0] || await context.newPage();
const html = await readFile(path.join(projectRoot, "store-assets", "fixtures", demo.fixture), "utf8");
const origin = new URL(demo.url).origin;

await page.route(`${origin}/**`, async (route) => {
  const request = route.request();
  const requestUrl = new URL(request.url());

  if (requestUrl.pathname.includes("/assets/")) {
    const assetName = path.basename(requestUrl.pathname);
    const assetPath = path.join(projectRoot, "store-assets", "fixtures", "assets", assetName);
    const extension = path.extname(assetName).toLowerCase();
    const contentType = extension === ".svg" ? "image/svg+xml" : "image/png";
    await route.fulfill({
      status: 200,
      contentType,
      headers: { "cache-control": "no-store" },
      body: await readFile(assetPath)
    });
    return;
  }

  if (request.resourceType() === "document") {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "cache-control": "no-store" },
      body: html
    });
    return;
  }

  await route.abort();
});

const now = Date.now();
const events = Object.keys(demos).flatMap((network, networkIndex) => Array.from({ length: 4 }, (_, index) => ({
  id: `${network}-demo-${index}`,
  site: network,
  siteLabel: network === "x" ? "X" : `${network[0].toUpperCase()}${network.slice(1)}`,
  activityType: index === 0 ? "post" : "reply",
  source: "store-demo",
  fingerprint: `${network}-demo-${index}`,
  xp: index === 0 ? 20 : 8,
  timestamp: now - (networkIndex * 4 + index) * 12 * 60 * 1000
})));

await worker.evaluate(async ({ events }) => {
  await chrome.storage.local.set({
    socialXpEvents: events,
    socialXpRewardEvents: [],
    socialXpGoals: {
      daily: { post: 8, reply: 20 },
      weekly: { post: 32, reply: 84 },
      monthly: { post: 120, reply: 320 },
      yearly: { post: 1440, reply: 3840 }
    },
    socialXpSettings: { toastEnabled: true, themePreference: "dark" }
  });
}, { events });

await page.goto(demo.url);
await page.waitForTimeout(900);

await worker.evaluate(async ({ patterns }) => {
  const tabs = await chrome.tabs.query({ url: patterns });
  if (!tabs[0]?.id) {
    throw new Error("The demo tab was not found.");
  }
  await chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_WIDGET" });
}, { patterns: demo.patterns });

console.log(`Social-XP ${site} demo is open. Close the Chromium window to stop.`);

if (autoCloseMs > 0) {
  setTimeout(() => context.close(), autoCloseMs);
}

await new Promise((resolve) => context.once("close", resolve));
