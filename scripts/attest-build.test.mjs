import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { attest, normalizePem, releaseVersion } from "./attest-build.mjs";

const COMMIT = "a".repeat(40);
const PURPOSE = Buffer.from("ltk-patcher-attestation\0");

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey };
}

function verifies(value, publicKey) {
  const [statement, signature] = value.split(".");
  return verify(
    null,
    Buffer.concat([PURPOSE, Buffer.from(statement, "base64url")]),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
}

describe("attest", () => {
  it("signs the client, the release version, the commit and the protocol", () => {
    const { pem, publicKey } = pair();

    const value = attest(
      { client: "ltk-manager", version: "1.29.0-rc.1", commit: COMMIT, protocol: 3 },
      pem,
    );

    const [statement] = value.split(".");
    expect(JSON.parse(Buffer.from(statement, "base64url").toString())).toEqual({
      client: "ltk-manager",
      version: "1.29.0",
      commit: COMMIT,
      protocol: 3,
    });
    expect(verifies(value, publicKey)).toBe(true);
  });

  it("fails if the client name, the commit or the protocol is malformed", () => {
    const { pem } = pair();
    const build = { client: "ltk-manager", version: "1.29.0", commit: COMMIT, protocol: 3 };

    expect(() => attest({ ...build, commit: "abc" }, pem)).toThrow("Not a commit hash");
    expect(() => attest({ ...build, client: "LTK Manager" }, pem)).toThrow("Not a client name");
    expect(() => attest({ ...build, protocol: 1.5 }, pem)).toThrow("Not a host protocol");
    expect(() => attest({ ...build, protocol: Number.NaN }, pem)).toThrow("Not a host protocol");
  });
});

describe("normalizePem", () => {
  it("restores a PEM that lost its line breaks or carries the public key line", () => {
    const { pem, publicKey } = pair();
    const build = { client: "ltk-manager", version: "1.30.2", commit: COMMIT, protocol: 3 };

    for (const text of [
      pem.replace(/\n/g, ""),
      pem.replace(/\n/g, "\r\n"),
      `${pem}Public key: ${publicKey.export({ format: "jwk" }).x}\n`,
      pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").trim(),
    ]) {
      expect(verifies(attest(build, text), publicKey)).toBe(true);
    }
    expect(normalizePem(pem)).toBe(pem);
  });

  it("fails on text that is not a key", () => {
    expect(() => normalizePem("not a key!")).toThrow("Not a PKCS#8 PEM private key");
  });
});

describe("releaseVersion", () => {
  it("strips a pre-release and build suffix", () => {
    expect(releaseVersion("1.29.0")).toBe("1.29.0");
    expect(releaseVersion("1.29.0-rc.1")).toBe("1.29.0");
    expect(releaseVersion("1.29.0+build.5")).toBe("1.29.0");
  });

  it("fails on a version that is not semver", () => {
    expect(() => releaseVersion("v1.29")).toThrow("Not a semver version");
  });
});
