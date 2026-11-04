// Prints a new Ed25519 pair for build attestations: the PKCS#8 PEM private key for the
// LTK_PATCHER_ATTESTATION_KEY repository secret, then the base64 raw public key for the
// delivery service's client registry.

import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");

process.stdout.write(privateKey.export({ type: "pkcs8", format: "pem" }));
process.stdout.write(`Public key: ${raw.toString("base64")}\n`);
