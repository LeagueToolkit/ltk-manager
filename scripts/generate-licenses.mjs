// Regenerates public/third-party-licenses.json from the Rust dependency graph.
// Requires cargo-about (https://github.com/EmbarkStudios/cargo-about):
//   cargo install cargo-about --locked
// Configuration (accepted licenses, targets) lives in about.toml.
//
// `--if-available` returns without writing when cargo-about is not installed,
// for the pre-commit hook. The CI job runs without it, so a manifest a hook
// skipped still fails the pull request that carries it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(repoRoot, "public", "third-party-licenses.json");

if (process.argv.includes("--if-available") && !hasCargoAbout()) {
  console.warn(
    "cargo-about is not installed, so public/third-party-licenses.json was left as it is.",
  );
  console.warn("Install it with `cargo install cargo-about --locked`, or let CI regenerate it.");
  process.exit(0);
}

/* Probed rather than inferred from a failed generate, so that a cargo-about
   that is installed and then fails still stops the commit. */
function hasCargoAbout() {
  try {
    execFileSync("cargo", ["about", "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// cargo-about refuses to write JSON to stdout under PowerShell, so go through a temp file
const tempDir = mkdtempSync(join(tmpdir(), "cargo-about-"));
const reportPath = join(tempDir, "licenses.json");

let report;
try {
  execFileSync("cargo", ["about", "generate", "--format", "json", "-o", reportPath], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// Byte-wise comparison — localeCompare would make output depend on the host locale
const byteCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// cargo-about emits one entry per distinct license *text* (differing copyright headers).
// Invert that into a crate-centric shape: each crate lists indices into a deduplicated
// `texts` array, so the UI can show one row per library without repeating full texts.
const entries = report.licenses
  .map((license) => ({
    id: license.id,
    name: license.name,
    text: license.text,
    usedBy: license.used_by.map((usage) => ({
      name: usage.crate.name,
      version: usage.crate.version,
      ...(usage.crate.repository ? { url: usage.crate.repository } : {}),
    })),
  }))
  .sort((a, b) => byteCompare(a.id, b.id) || byteCompare(a.text, b.text));

const texts = entries.map(({ id, name, text }) => ({ id, name, text }));

const crateMap = new Map();
entries.forEach((entry, textIndex) => {
  for (const usage of entry.usedBy) {
    const key = `${usage.name}@${usage.version}`;
    const crate = crateMap.get(key) ?? { ...usage, licenses: [] };
    if (!crate.licenses.includes(textIndex)) crate.licenses.push(textIndex);
    crateMap.set(key, crate);
  }
});

const crates = [...crateMap.values()].sort(
  (a, b) => byteCompare(a.name, b.name) || byteCompare(a.version, b.version),
);

writeFileSync(outputPath, JSON.stringify({ texts, crates }, null, 2) + "\n");

console.log(
  `Wrote ${crates.length} crates referencing ${texts.length} license texts to ${outputPath}`,
);
