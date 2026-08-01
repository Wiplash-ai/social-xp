import { chromium } from "playwright";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(projectRoot, "dist", "chrome");
const screenshotPath = path.join(projectRoot, "store-assets", "screenshots");
const userDataPath = path.join(projectRoot, ".wip", "playwright-store-profile");

await mkdir(screenshotPath, { recursive: true });
await rm(userDataPath, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(userDataPath, {
  headless: process.env.SOCIAL_XP_HEADLESS !== "0",
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--disable-default-apps"
  ]
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_DASHBOARD_DATA" }, () => resolve());
  }));
  const now = Date.now();
  const events = [
    ...makeEvents("x", "X", 3, 7, now),
    ...makeEvents("linkedin", "LinkedIn", 2, 5, now - 35 * 60 * 1000),
    ...makeEvents("threads", "Threads", 2, 4, now - 55 * 60 * 1000),
    ...makeEvents("discord", "Discord", 1, 6, now - 75 * 60 * 1000),
    ...makeEvents("reddit", "Reddit", 1, 3, now - 2 * 60 * 60 * 1000),
    ...makeEvents("facebook", "Facebook", 2, 3, now - 3 * 60 * 60 * 1000),
    ...makeEvents("bluesky", "Bluesky", 2, 4, now - 4 * 60 * 60 * 1000)
  ];

  let seededEventCount = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    seededEventCount = await worker.evaluate(async ({ events }) => {
      const values = {
        socialXpEvents: events,
        socialXpRewardEvents: [],
        socialXpGoals: {
          daily: { post: 8, reply: 20 },
          weekly: { post: 32, reply: 84 },
          monthly: { post: 120, reply: 320 },
          yearly: { post: 1440, reply: 3840 }
        },
        socialXpSettings: { toastEnabled: true, themePreference: "dark" }
      };

      await new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      return new Promise((resolve, reject) => {
        chrome.storage.local.get(["socialXpEvents"], (stored) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(Array.isArray(stored.socialXpEvents) ? stored.socialXpEvents.length : 0);
        });
      });
    }, { events });

    if (seededEventCount === events.length) {
      break;
    }
  }

  if (seededEventCount !== events.length) {
    throw new Error(`Expected ${events.length} seeded events, found ${seededEventCount}.`);
  }

  await captureNetwork("x", "https://x.com/home", "x.html", "x-widget.png", worker);
  await captureNetwork("linkedin", "https://www.linkedin.com/feed/", "linkedin.html", "linkedin-widget.png", worker);
  await captureNetwork("threads", "https://www.threads.net/", "threads.html", "threads-widget.png", worker);
  await captureNetwork("discord", "https://discord.com/channels/@me", "discord.html", "discord-widget.png", worker);
  await captureNetwork("reddit", "https://www.reddit.com/", "reddit.html", "reddit-widget.png", worker);
  await captureNetwork("facebook", "https://www.facebook.com/", "facebook.html", "facebook-widget.png", worker);
  await captureNetwork("bluesky", "https://bsky.app/", "bluesky.html", "bluesky-widget.png", worker);

  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard/dashboard.html`);
  await dashboard.waitForSelector("#trendChart svg, #trendChart path, #trendChart polyline", { timeout: 10000 }).catch(() => {});
  await dashboard.waitForTimeout(900);
  await dashboard.screenshot({ path: path.join(screenshotPath, "dashboard.png") });
  await dashboard.close();

  const goals = await context.newPage();
  await goals.goto(`chrome-extension://${extensionId}/options/options.html`);
  await goals.waitForTimeout(700);
  await goals.screenshot({ path: path.join(screenshotPath, "goals.png") });
  await goals.close();

  const promo = await context.newPage();
  await promo.goto(`file://${path.join(projectRoot, "store-assets", "fixtures", "promo.html")}`);
  await promo.locator(".promo.small").screenshot({ path: path.join(screenshotPath, "promo-small-440x280.png") });
  await promo.locator(".promo.marquee").screenshot({ path: path.join(screenshotPath, "promo-marquee-1400x560.png") });
  await promo.close();
} finally {
  await context.close();
}

async function captureNetwork(site, url, fixtureName, outputName, worker) {
  const html = await readFile(path.join(projectRoot, "store-assets", "fixtures", fixtureName), "utf8");
  const page = await context.newPage();
  await installFixtureRoutes(page, url, html);
  await page.goto(url);
  await page.waitForTimeout(800);

  await worker.evaluate(async ({ site }) => {
    const patternsBySite = {
      x: ["https://x.com/*"],
      linkedin: ["https://www.linkedin.com/*"],
      threads: ["https://www.threads.net/*"],
      discord: ["https://discord.com/*"],
      reddit: ["https://www.reddit.com/*"],
      facebook: ["https://www.facebook.com/*"],
      bluesky: ["https://bsky.app/*"]
    };
    const patterns = patternsBySite[site];
    if (!patterns) {
      throw new Error(`No tab query pattern is configured for ${site}.`);
    }
    const tabs = await chrome.tabs.query({ url: patterns });
    if (!tabs[0] || !tabs[0].id) {
      throw new Error(`No ${site} fixture tab was found.`);
    }
    await chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_WIDGET" });
  }, { site });

  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(screenshotPath, outputName) });
  await page.close();
}

async function installFixtureRoutes(page, url, html) {
  const origin = new URL(url).origin;
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());

    if (requestUrl.pathname.includes("/assets/")) {
      const assetName = path.basename(requestUrl.pathname);
      const assetPath = path.join(projectRoot, "store-assets", "fixtures", "assets", assetName);
      const extension = path.extname(assetName).toLowerCase();
      const contentTypes = {
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      const body = await readFile(assetPath);
      await route.fulfill({
        status: 200,
        contentType: contentTypes[extension] || "application/octet-stream",
        headers: { "cache-control": "no-store" },
        body
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
}

function makeEvents(site, siteLabel, posts, replies, anchor) {
  const events = [];
  for (let index = 0; index < posts + replies; index += 1) {
    const activityType = index < posts ? "post" : "reply";
    events.push({
      id: `${site}-${index}`,
      site,
      siteLabel,
      activityType,
      source: "store-fixture",
      fingerprint: `${site}-${activityType}-${index}`,
      xp: activityType === "post" ? 20 : 8,
      timestamp: anchor - index * 18 * 60 * 1000
    });
  }
  return events;
}
