import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const publicSourceFiles = [
  "manifest.json",
  "background.js",
  "content/content-script.js",
  "dashboard/dashboard.html",
  "dashboard/dashboard.js",
  "options/options.html",
  "options/options.js"
];

test("public extension requests only local storage plus supported-site access", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(manifest.host_permissions.length > 0);
  assert.ok(manifest.host_permissions.every((pattern) => pattern.startsWith("https://")));
});

test("public extension source contains no private integration or localhost transport", () => {
  const source = publicSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /wiphand/i);
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1/i);
  assert.doesNotMatch(source, /feedbackApiKey|SAVE_LINKEDIN_FEEDBACK/);
});

test("activity deduplication stores a hash instead of readable composer text", () => {
  const source = fs.readFileSync(path.join(projectRoot, "content/content-script.js"), "utf8");
  const fingerprintFunction = source.match(/function buildFingerprint\(intent\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(fingerprintFunction, /hashFingerprint\(content\)/);
  assert.doesNotMatch(fingerprintFunction, /\$\{content\}/);
});

test("Wiplash attribution is present in the dashboard, goals page, and widget", () => {
  const files = [
    "dashboard/dashboard.html",
    "options/options.html",
    "content/content-script.js"
  ];

  files.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    assert.match(source, /Produced by/);
    assert.match(source, /https:\/\/wiplash\.ai\//);
  });
});

test("extension pages link to the public Social-XP product home", () => {
  ["dashboard/dashboard.html", "options/options.html"].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    assert.match(source, /https:\/\/labs\.wiplash\.ai\/social-xp\//);
  });
});

test("every supported network has a deterministic fixture and store screenshot", () => {
  const supportedNetworks = ["x", "linkedin", "threads", "discord", "reddit", "facebook", "bluesky"];

  supportedNetworks.forEach((network) => {
    assert.ok(
      fs.existsSync(path.join(projectRoot, "store-assets", "fixtures", `${network}.html`)),
      `Missing ${network} fixture.`
    );
    assert.ok(
      fs.existsSync(path.join(projectRoot, "store-assets", "screenshots", `${network}-widget.png`)),
      `Missing ${network} screenshot.`
    );
    assert.ok(
      fs.existsSync(path.join(projectRoot, "site", "social-xp", "assets", `${network}-widget.png`)),
      `Missing ${network} product preview.`
    );
  });
});

test("extension theme defaults to dark and exposes only a manual light alternate", () => {
  const files = [
    "background.js",
    "content/content-script.js",
    "dashboard/dashboard.js",
    "options/options.js"
  ];
  const source = files
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8"))
    .join("\n");

  assert.match(source, /themePreference: "dark"/);
  assert.doesNotMatch(source, /themePreference\s*=\s*"system"|getSystemTheme|Auto Dark|Auto Light/);
});
