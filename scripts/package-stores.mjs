import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const artifactRoot = path.join(projectRoot, "artifacts");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const version = manifest.version;

assertPublicManifest(manifest);
await execFileAsync(process.execPath, [path.join(__dirname, "build-chrome.mjs")], { cwd: projectRoot });
await execFileAsync(process.execPath, [path.join(__dirname, "build-firefox.mjs")], { cwd: projectRoot });

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

await createZip(
  path.join(projectRoot, "dist", "chrome"),
  path.join(artifactRoot, `social-xp-chrome-edge-opera-v${version}.zip`)
);
await createZip(
  path.join(projectRoot, "dist", "firefox"),
  path.join(artifactRoot, `social-xp-firefox-v${version}.zip`)
);

process.stdout.write(`Store packages created in ${artifactRoot}\n`);

function assertPublicManifest(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = ["wiphand", "localhost", "127.0.0.1", "api key"];

  forbidden.forEach((token) => {
    if (serialized.includes(token)) {
      throw new Error(`Public manifest contains forbidden integration token: ${token}`);
    }
  });

  if (value.manifest_version !== 3) {
    throw new Error("Store package must use Manifest V3.");
  }

  if (!Array.isArray(value.permissions) || value.permissions.some((permission) => permission !== "storage")) {
    throw new Error("Public package may request only the storage extension permission.");
  }
}

async function createZip(sourceDirectory, outputPath) {
  await execFileAsync("zip", ["-q", "-r", outputPath, "."], { cwd: sourceDirectory });
}
