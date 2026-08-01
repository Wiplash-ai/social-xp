import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "dist", "chrome");

const FILES_TO_COPY = [
  "assets/brand-mark.png",
  "assets/icons",
  "assets/page-bootstrap.js",
  "background.js",
  "content",
  "dashboard",
  "options"
];

await buildChromeExtension();

async function buildChromeExtension() {
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "manifest.json"), "utf8")
  );

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
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  process.stdout.write(`Chrome build created at ${outputRoot}\n`);
}
