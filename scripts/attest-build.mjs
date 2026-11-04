// Prints the build attestation of one client build, signed with the Ed25519 key in
// LTK_PATCHER_ATTESTATION_KEY (PKCS#8 PEM). The delivery service verifies it.
//
// Usage: node scripts/attest-build.mjs --client <name> --protocol <n> <version> <commit>

import { createPrivateKey, sign } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Separates an attestation signature from any other signature the same key makes.
const PURPOSE = "ltk-patcher-attestation\0";

/** Returns the release version of `version`: its core without a pre-release or build suffix. */
export function releaseVersion(version) {
  const match = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(version);
  if (match === null) {
    throw new Error(`Not a semver version: ${version}`);
  }

  return match[1];
}

/**
 * Returns `text` as a PKCS#8 PEM with its own line breaks.
 *
 * A secret store may return the PEM on one line, with CRLF line breaks, or with the keygen's
 * public key line after it. Fails if the body is not base64.
 */
export function normalizePem(text) {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(text);
  const body = (match?.[1] ?? text).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) {
    throw new Error("Not a PKCS#8 PEM private key");
  }

  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Returns the attestation of `build`, signed with the PEM private key `pem`:
 * `base64url(statement).base64url(signature)`, where the statement is
 * `{"client":"<name>","version":"<release version>","commit":"<commit>","protocol":<n>}`.
 * Fails if the client name, the commit or the protocol is not well formed.
 */
export function attest({ client, version, commit, protocol }, pem) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(client)) {
    throw new Error(`Not a client name: ${client}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Not a commit hash: ${commit}`);
  }
  if (!Number.isInteger(protocol) || protocol < 0 || protocol > 0xffff_ffff) {
    throw new Error(`Not a host protocol: ${protocol}`);
  }

  const statement = Buffer.from(
    JSON.stringify({ client, version: releaseVersion(version), commit, protocol }),
  );
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(PURPOSE), statement]),
    privateKey(normalizePem(pem)),
  );

  return `${statement.toString("base64url")}.${signature.toString("base64url")}`;
}

/**
 * Returns the Ed25519 private key of the PKCS#8 PEM `pem`.
 *
 * Fails with the decoded length and the key type if the PEM body is not a PKCS#8 Ed25519
 * private key, such as the base64 public key pasted in its place.
 */
function privateKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  let key;
  try {
    key = createPrivateKey(pem);
  } catch (cause) {
    throw new Error(
      `Not a PKCS#8 private key: the PEM body decodes to ${Buffer.from(body, "base64").length} bytes (an Ed25519 key is 48)`,
      { cause },
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Not an Ed25519 key: ${key.asymmetricKeyType}`);
  }

  return key;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values, positionals } = parseArgs({
    options: { client: { type: "string" }, protocol: { type: "string" } },
    allowPositionals: true,
  });
  const [version, commit] = positionals;
  const pem = process.env.LTK_PATCHER_ATTESTATION_KEY;
  if (!values.client || !values.protocol || !version || !commit || !pem) {
    console.error(
      "Usage: LTK_PATCHER_ATTESTATION_KEY=<pem> node scripts/attest-build.mjs --client <name> --protocol <n> <version> <commit>",
    );
    process.exit(2);
  }

  process.stdout.write(
    attest({ client: values.client, version, commit, protocol: Number(values.protocol) }, pem),
  );
}
