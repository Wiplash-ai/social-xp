import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "dist", "firefox");

const FILES_TO_COPY = [
  "assets",
  "background.js",
  "content",
  "dashboard",
  "options",
  "README.md"
];

const FIREFOX_EXTENSION_ID = "{f1144441-2d88-4daf-9e17-bf5c69a2e111}";

await buildFirefoxExtension();

async function buildFirefoxExtension() {
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "manifest.json"), "utf8")
  );

  const firefoxManifest = {
    ...manifest,
    background: {
      scripts: ["background.js"]
    },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: "121.0",
        data_collection_permissions: {
          required: ["none"]
        }
      }
    }
  };

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  await Promise.all(
    FILES_TO_COPY.map(async (relativePath) => {
      await cp(
        path.join(projectRoot, relativePath),
        path.join(outputRoot, relativePath),
        { recursive: true }
      );
    })
  );

  await writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(firefoxManifest, null, 2)}\n`,
    "utf8"
  );

  process.stdout.write(`Firefox build created at ${outputRoot}\n`);
}
