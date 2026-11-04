# Patcher build attestation

Design spec, 2026-10-21. Draft for planning.

Since 2026-11-04 the statement is `{"client":"ltk-manager","version":"<version>","commit":"<commit>","protocol":<n>}`
under the purpose prefix `ltk-patcher-attestation\0`, where `protocol` is the host protocol in
`src-tauri/host-protocol`. The registration body carries `client` and `version`, and the offer
query `version`. The sections below describe the first form.

A manager build proves to the delivery service that it is a release build of one version, with a
statement that the release workflow signs at build time. The service verifies the statement
against a pinned public key and denies a version by name. This replaces the shared client key,
its per-release KV entry and its per-release repository secret.

The delivery client is PR #897, `crates/ltk-manager-runtime/src/patcher/delivery/` and
`src-tauri/src/patcher/delivery.rs`. The service is the private `ltk-patcher-delivery` worker.
Its README section "Public delivery" and `src/delivery.ts`, `src/access.ts`, `src/tokens.ts` and
`src/admin.ts` are the sources for the service side of this spec.

## Problem

The service registers an install only with a client key that an operator allowlisted. The key
is any text. Its SHA-256 is the ID of a `clientkey:<id>` entry in the `ACCESS_POLICY` KV
namespace, whose value names the manager versions the key may claim. The key text ships in the
binary through `LTK_PATCHER_CLIENT_KEY`, read by `option_env!`.

Each release therefore needs two manual steps, in this order: the KV write and the secret. The
costs:

- A release without the KV entry registers nothing. The sync logs `Refused 403 key` and every
  session runs the bundled DLL. Nothing in the release fails, so the omission is silent.
- Automating the KV write from the manager's release workflow needs a Cloudflare token that can
  write the policy namespace. That token can also deny installs and retire keys.
- The key claims a range an operator typed. A typo widens or empties it.
- The key is public by construction. Anyone with the installer reads it. The only property it
  adds over no credential is a kill switch per key, and a bar against a client that never had
  a real binary.

## What a credential can do

The service's abuse controls are the proof of work, the per-address and per-install counters,
the install denylist and the minisign-signed manifests. A credential embedded in a public
binary cannot be a secret. What it can be is an unforgeable claim of identity: this binary is a
release build of version X. That claim gives the service a stable identity per build to deny,
to count and to raise difficulty for.

The design keeps that claim and drops the parts that pretend the key is secret.

## Decision

**The release workflow signs an attestation of the build, and the service verifies it.**

- An attestation is a statement that names the manager's release version and the commit, and
  an Ed25519 signature over it.
- The manager repository holds the private key as one long-lived secret. The service holds the
  public key as one configuration value, as it holds `MANIFEST_PUBLIC_KEYS`.
- Registration takes the attestation in place of the key. The service verifies the signature,
  checks the attested version against the version the request claims, and refuses a version
  that a `deny:manager:<version>` entry names.
- The token binds the install and the attested version. Offers and downloads check the denylist
  on every request, as they check the client key range today.

Nothing is written per release. A release is attested or the workflow fails.

## The attestation

### Statement

The statement is the UTF-8 bytes of this JSON, with the keys in this order and no whitespace:

```json
{ "manager": "1.29.0", "commit": "<40 lowercase hex>" }
```

| Field     | Value                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| `manager` | The release version of the build: `CARGO_PKG_VERSION` without a pre-release suffix |
| `commit`  | The commit the workflow built, `GITHUB_SHA`                                        |

The client reports the same release version in its User-Agent, its registration body and its
offer query, so the attestation and the request agree by construction. See "Pre-release
versions" for why the suffix is dropped. A release candidate and its final differ in `commit`.

### Signature

Ed25519 over `"ltk-manager-attestation\0"` followed by the statement bytes. The prefix separates
the purpose from any other signature the same key could make, the way `macInput` in
`src/tokens.ts` prefixes a purpose to its payload.

### Encoding

The value that reaches the binary and the service is one string:

```text
base64url(statement) "." base64url(signature)
```

This is the shape of the service's sealed tokens, so the service decodes it with
`src/encoding.ts` as it is. The string is about 250 characters, within the
`maxFieldChars` limit of a registration field in `src/delivery.ts`. The comment on that limit
names the client key and changes to name the attestation.

### Keys

| Side    | Holds                                    | Where                                                                                                                      |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Manager | Ed25519 private key, PKCS#8 PEM          | Repository secrets `LTK_PATCHER_ATTESTATION_KEY` for a release and `LTK_PATCHER_ATTESTATION_KEY_STAGING` for a pre-release |
| Service | Ed25519 public key, raw 32 bytes, base64 | Worker var `MANAGER_ATTESTATION_PUBLIC_KEYS`                                                                               |

The service var is an array, so a rotation adds the new key, deploys, and removes the old key
after its last attested release is denied or past its end of life. `MANIFEST_PUBLIC_KEYS`
follows the same pattern.

The private key is generated once, outside CI, and stored in the repository secret and in the
maintainer's password manager. A compromised key forges attestations for any version, including
versions never released. The response is a rotation. The damage before it is bounded by the
rate limits, the same as a replayed attestation from a shipped binary.

Node 22 signs with `crypto.sign(null, statement, privateKey)` and no dependency. The worker
verifies with `crypto.subtle.importKey("raw", bytes, { name: "Ed25519" }, false, ["verify"])`
and `crypto.subtle.verify("Ed25519", key, signature, data)`. The Workers Web Crypto page lists
Ed25519 as a standard algorithm for `importKey`, `sign` and `verify`, with no compatibility flag.

`scripts/attest-keygen.mjs` in the manager repository generates a pair with
`crypto.generateKeyPairSync("ed25519")` and prints the PEM private key and the base64 public key.

## Service changes

### Registration

`POST /v1/installs` body:

```json
{
  "install": "<uuid>",
  "manager": "<version>",
  "attestation": "<value>",
  "challenge": "<c>",
  "nonce": "<n>"
}
```

`register` in `src/delivery.ts` runs these checks after the existing User-Agent, shape,
`manager` and challenge checks, in this order:

1. The attestation decodes and the statement parses with the three fields of the stated types.
2. The signature verifies under one of `MANAGER_ATTESTATION_PUBLIC_KEYS`.
3. `statement.manager` equals the `manager` of the body, which already equals the User-Agent
   version.
4. `deny:<install>` is absent.
5. `deny:manager:<statement.manager>` is absent.

A failure of 1 to 3 refuses with `403 {"reason":"attestation"}`. A failure of 5 refuses with
`403 {"reason":"manager"}`. The order keeps the property the README states: an unsolved request
learns nothing about policy and uses no shared allowance.

### Token

`TokenClaims.key` becomes `manager`, the attested version, and gains `commit`. `authenticate`
compares the `manager` query of an offer or a download against `claims.manager` instead of
reading a key range. `policyRefusal` reads `deny:<install>` and `deny:manager:<claims.manager>`.

`readToken` validates `manager` against the User-Agent version pattern and `commit` as 40
lowercase hex, in place of `isSha256Hex(claims.key)`. A token issued under the client key scheme
has no `manager` claim and fails that check. The
client registers again on `401`, which is the migration.

### Access policy

`src/access.ts` drops `clientKeyId`, `clientKeyRange` and `retireClientKey`. It gains
`isManagerDenied(policy, version)` beside `isInstallDenied`. The key format is
`deny:manager:<full version>`, exact. A range form is not part of this spec. A bad release is
one version, and an `rc` and its final are two.

### Admin routes

| Route                               | Method   | Effect                     |
| ----------------------------------- | -------- | -------------------------- |
| `/admin/v1/managers/<version>/deny` | `PUT`    | Denies the version. `204`. |
| `/admin/v1/managers/<version>/deny` | `DELETE` | Lifts the denial. `204`.   |
| `/admin/v1/client-keys/<sha256>`    |          | Removed                    |

Both use the `admin` credential, as `operatorRequest` in `src/admin.ts` requires today. The
route validates `<version>` against the User-Agent version pattern and answers `400` otherwise.

### Events

`reportEvent` writes the attested version and commit where it writes the key ID. A new
`attestation_invalid` event records a failed check 1 to 3, and `manager_denied` a failed check 5.

### Configuration

`Env` gains `MANAGER_ATTESTATION_PUBLIC_KEYS: string[]`. `wrangler.json` sets it per
environment. Staging and production hold different keys, so a staging key never attests a
production registration.

### Tests

`test/signing.ts` gains an Ed25519 test key pair and an `attest(version, commit)` helper.
`test/delivery.test.ts` and `test/worker.test.ts` register with an attestation, and cover:
a forged signature, a statement whose version differs from the body, a denied version on
registration and on an offer with a live token, and a token from the key scheme answering
`401`. `test/admin.test.ts` covers the two routes.

`test/fixtures/attestation.json` holds an attestation that `scripts/attest-build.mjs` in the
manager repository produced with the test key, so the prefix and the encoding of the two
repositories are checked against each other.

## Manager changes

### Release workflow

`release.yml` gains one step between `Resolve version` and `Build and release`:

```yaml
- name: Attest build
  shell: bash
  env:
    LTK_PATCHER_ATTESTATION_KEY: ${{ secrets.LTK_PATCHER_ATTESTATION_KEY }}
  run: |
    if [[ -z "$LTK_PATCHER_ATTESTATION_KEY" ]]; then
      if [[ "${{ github.repository }}" == "LeagueToolkit/ltk-manager" ]]; then
        echo "::error::LTK_PATCHER_ATTESTATION_KEY is not set"
        exit 1
      fi
      echo "::notice::No attestation key. The build runs the bundled patcher DLL only."
      exit 0
    fi
    echo "LTK_PATCHER_ATTESTATION=$(node scripts/attest-build.mjs \
      "${{ steps.version.outputs.version }}" "$GITHUB_SHA")" >> "$GITHUB_ENV"
```

`scripts/attest-build.mjs` reads the key from the environment, builds the statement, signs it
and prints the encoded value. It is the only place that knows the statement layout on the
manager side. The build step's `LTK_PATCHER_CLIENT_KEY` line becomes
`LTK_PATCHER_ATTESTATION: ${{ env.LTK_PATCHER_ATTESTATION }}`.

The attestation is not secret, so it is not masked. A fork without the secret builds without
delivery, as a build without the client key does today.

### Client

`src-tauri/src/patcher/delivery.rs`:

- `CLIENT_KEY` becomes `ATTESTATION: Option<&str> = option_env!("LTK_PATCHER_ATTESTATION")`. A
  build without it has no client.
- `PatcherDeliveryState::new` decodes the statement and compares its `manager` with
  `CARGO_PKG_VERSION`. A mismatch logs a warning and builds no client, so a stale environment
  value never registers under the wrong version.
- `manager` is `CARGO_PKG_VERSION` with its pre-release cleared, as the review fixes of PR #897
  made it. See "Pre-release versions".

`crates/ltk-manager-runtime/src/patcher/delivery/`:

- `PatcherDelivery.client_key` becomes `attestation: String`.
- `Service::register` posts `attestation` in place of `key`.
- `DeliveryError::Refused { status: 403, reason }` already carries `attestation` and `manager`.
  The sync logs it, and the patcher runs the bundled DLL. No new error variant.
- The test server refuses an attestation equal to `refused` with `403 {"reason":"attestation"}`.
  The test `sync_registers_once_if_client_key_is_refused` becomes
  `sync_fails_if_attestation_is_refused` and asserts `Refused { status: 403, .. }` after one
  registration.

### Pre-release versions

Rust's `semver` matches a pre-release version only against a comparator with a pre-release on
the same core, and the service's `ManagerRange` applies the same rule. A manifest range such as
`>=1.22.0, <2.0.0` therefore never serves `1.29.0-rc.1`, on either side. The client reports its
release version instead: `PatcherDeliveryState::new` clears the pre-release of
`CARGO_PKG_VERSION` once, and that version reaches the User-Agent, the registration, the offer
query and `Manifest::serves`. `scripts/attest-build.mjs` names the same release version.

A denial by version therefore covers a release candidate and its final together. The token and
the events carry `commit`, which tells them apart. A denial by commit is not part of this spec.

## Operations

| Situation          | Action                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A release          | None. The workflow attests it.                                                                                                             |
| A bad release      | `PUT /admin/v1/managers/<version>/deny`. Its tokens fail within a minute. To stop a staged DLL as well, withdraw its digest in a manifest. |
| A bad install      | `PUT /admin/v1/installs/<uuid>/deny`, unchanged.                                                                                           |
| Key rotation       | Add the new public key to the var, deploy, replace the secret, remove the old key later.                                                   |
| Key compromise     | Rotation, then deny any version the attacker attested that was never released.                                                             |
| Production service | Its own key pair and `MANAGER_ATTESTATION_PUBLIC_KEYS`. The `shortcut:` constants in `delivery.rs` switch with it.                         |

## Failure modes

| Failure                                        | Result                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Secret missing on the upstream repository      | The release workflow fails at `Attest build`.                                                                                         |
| Secret missing on a fork                       | The build has no delivery client.                                                                                                     |
| Attestation does not match `CARGO_PKG_VERSION` | The build has no delivery client, with a warning in the log.                                                                          |
| Signature does not verify                      | `403 attestation`. The sync logs it. Bundled DLL.                                                                                     |
| Version denied                                 | `403 manager` on registration, offer and download. No new download. A staged DLL keeps running until a manifest withdraws its digest. |
| Token from the key scheme                      | `401`. The client registers again with the attestation.                                                                               |
| Public key var empty                           | Every registration fails `403 attestation`. The service fails closed.                                                                 |

## Sequencing

1. **Service.** Attestation verification, the denylist, the admin routes, the events and the
   tests. Deploy to staging with the staging public key. The old `clientkey:` entries are
   ignored and can be deleted.
2. **Keys.** Generate the staging pair and the production pair. Store the private keys in the
   repository secret and the password manager. Set the staging var.
3. **Manager.** `scripts/attest-build.mjs`, the workflow step, and the client changes on the
   PR #897 branch before it merges. The branch then ships the attestation scheme and never the
   key scheme.
4. **Verify.** A release-candidate build registers against staging, by the `registration`
   event and a `Downloaded patcher DLL` line in the manager log.
5. **Production.** When the production service exists, its key and vars, and the constant
   switch in `delivery.rs`.

## Out of scope

- A range form of `deny:manager:`. Exact versions cover the known cases.
- Per-version adaptive difficulty. The attested version gives it an identity to key on, and the
  service README lists it as later work.
- Sigstore or GitHub artifact attestations. The worker would verify certificate chains and
  transparency log entries for a claim that one Ed25519 signature already makes.
- A credential-free scheme, proof of work and the denylist only. It drops the bar against a
  client that never had a real binary and the per-build identity, for the saving of one secret
  and one workflow step.

## Decisions

Recorded on 2026-10-21.

- `built` is not in the statement. `commit` identifies the build, and a rebuild of one commit
  attests identically.
- PR #897 ships the attestation scheme. The client key scheme never reaches a release.
- A denied version stays a log line and the bundled DLL. No UI.
- The maintainer generates both pairs locally with `scripts/attest-keygen.mjs`. Private keys live
  in the repository secret and the password manager only.

## Open questions

- Does the private spec the service README refers to hold a reason for per-key policy that
  this spec does not cover?
- Should a denial by commit join the denial by version, for a release candidate whose final is
  sound?
