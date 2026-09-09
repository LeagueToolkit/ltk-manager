// Hand the release's source maps to the diagnostics vendor, then take them out
// of `dist` so the bundle that ships carries none.
//
// Runs between the frontend build and the Tauri bundle, which is the only
// window where the maps exist and the installer does not. Both ways of getting
// that wrong are silent: an upload before the build has nothing to send, and one
// after the bundle ships the maps to every user.
//
// A build with no credentials still deletes the maps, so a fork and a local
// release build behave the same as a release minus the upload.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

/** What the vendor files an upload under, matching the app's own name. */
const RELEASE_NAME = "ltk-manager";

/** Every source map under `dir`, however deeply nested. */
function sourceMaps(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceMaps(full);
    return entry.name.endsWith(".map") ? [full] : [];
  });
}

/**
 * The version the shipped events will carry.
 *
 * Read from the manifest the Rust side compiles `app_version` out of, not from
 * `package.json`. An upload filed under a version no event carries uploads
 * successfully and resolves nothing, which is this step's usual way of failing.
 */
function releaseVersion() {
  const manifest = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
  const version = /^version\s*=\s*"([^"]+)"/m.exec(manifest);
  if (!version) throw new Error("src-tauri/Cargo.toml names no version");

  return version[1];
}

function posthog(args) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["--yes", "@posthog/cli", ...args], { stdio: "inherit", cwd: root });
}

function upload() {
  if (!process.env.POSTHOG_CLI_API_KEY || !process.env.POSTHOG_CLI_PROJECT_ID) {
    console.log("No diagnostics credentials, so the source maps are dropped rather than uploaded.");
    return;
  }

  const version = releaseVersion();
  console.log(`Uploading source maps for ${RELEASE_NAME} ${version}`);
  posthog(["sourcemap", "inject", "--directory", dist]);
  posthog([
    "sourcemap",
    "upload",
    "--directory",
    dist,
    "--release-name",
    RELEASE_NAME,
    "--release-version",
    version,
  ]);
}

try {
  upload();
} catch (error) {
  // Non-fatal by design. A vendor outage costs unreadable stack traces for one
  // release, where failing here costs the release itself.
  console.warn(`The source maps were not uploaded: ${error.message}`);
}

const left = sourceMaps(dist);
for (const map of left) fs.rmSync(map);
console.log(`Removed ${left.length} source map(s) from the bundle.`);
