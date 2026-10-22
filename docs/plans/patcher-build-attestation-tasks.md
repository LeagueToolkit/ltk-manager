# Patcher build attestation tasks

Checklist for [the plan](patcher-build-attestation-plan.md). Each task names its repository and
what done looks like. `manager` is this repository, `service` is `ltk-patcher-delivery`.

## Phase 0: decisions and keys

- [x] D1 Decide whether `built` stays in the statement. Record it in the spec.
- [x] D2 Decide whether PR #897 ships attestations. Record it in the spec's "Sequencing".
- [x] D3 Decide whether a denied version reaches the UI. Record it in the spec.
- [ ] D4 Read the private spec for a per-key policy reason. Record the outcome in the spec.
- [x] D5 Decide key custody. Record it in the spec's "Keys".
- [x] K1 `manager`: `scripts/attest-keygen.mjs` prints a PEM private key and a base64 raw public key.
- [ ] K2 Generate the staging pair. Private key in the repository secret `LTK_PATCHER_ATTESTATION_KEY` and the password manager. Public key noted for S2.
- [ ] K3 Generate the production pair. Private key in the password manager only, until P1.

## Phase 1: service

- [x] S1 `src/attestation.ts`: decodes the value, parses the statement, validates `manager` by the User-Agent pattern and `commit` as 40 hex, verifies the prefixed signature under any key of `MANAGER_ATTESTATION_PUBLIC_KEYS`. Returns the statement or null.
- [x] S2 `src/env.ts` gains `MANAGER_ATTESTATION_PUBLIC_KEYS: string[]`. `wrangler.json` sets the staging value from K2.
- [x] S3 `register` in `src/delivery.ts` reads `attestation` in place of `key`, runs the five checks in the spec's order, refuses `403 attestation` and `403 manager`, and the field limit comment names the attestation.
- [x] S4 `src/tokens.ts`: `TokenClaims` has `manager` and `commit` in place of `key`. `readToken` validates both by shape.
- [x] S5 `src/access.ts`: `clientKeyId`, `clientKeyRange` and `retireClientKey` removed. `isManagerDenied` and the `deny:manager:` prefix added.
- [x] S6 `authenticate` and `policyRefusal` compare the `manager` query with `claims.manager` and check `isManagerDenied`.
- [x] S7 `src/admin.ts`: `PUT` and `DELETE /admin/v1/managers/<version>/deny`, version validated, `204`. The client-keys route removed.
- [x] S8 `reportEvent` takes `manager` and `commit` where it took `key`. Events `attested`, `attestation_invalid` and `manager_denied` written.
- [x] S9 README: "Public delivery" documents the `attestation` field and the two refusals, the access policy section documents `deny:manager:` and the admin routes, and the client key text is gone.
- [x] S10 Tests: `test/signing.ts` has an Ed25519 test pair and `attest(version, commit)`. `test/delivery.test.ts` and `test/worker.test.ts` cover a forged signature, a version mismatch, a denied version on registration and on an offer, a key-scheme token answering `401`, and `1.29.0-rc.1` inside `>=1.22.0, <2.0.0`. `test/admin.test.ts` covers S7. `test/fixtures/attestation.json` from M7 verifies.
- [ ] S11 Deploy to staging. Delete the `clientkey:` entries. Deny and lift a version through the admin route and see `204` twice.

## Phase 2: manager

- [x] M1 `scripts/attest-build.mjs` takes a version and a commit, reads `LTK_PATCHER_ATTESTATION_KEY`, prints the encoded attestation. `scripts/attest-build.test.mjs` signs with a throwaway key and verifies with `crypto.verify`. The `TEST_FILES` glob in `vitest.config.ts` is `src/**/*.test.{ts,tsx}`, so the config gains `scripts/**/*.test.mjs`.
- [x] M2 `release.yml`: the `Attest build` step from the spec between `Resolve version` and `Build and release`. The build env line becomes `LTK_PATCHER_ATTESTATION`. The step fails on `LeagueToolkit/ltk-manager` without the secret and notices on a fork.
- [x] M3 `src-tauri/src/patcher/delivery.rs`: `ATTESTATION` replaces `CLIENT_KEY`. `PatcherDeliveryState::new` decodes the statement, compares `manager` with `CARGO_PKG_VERSION`, warns and builds no client on a mismatch. `manager` is the full version.
- [x] M4 `crates/ltk-manager-runtime/src/patcher/delivery/`: `attestation` replaces `client_key`, `Service::register` posts it, the test server refuses `refused` with `403 attestation`, and `sync_fails_if_attestation_is_refused` replaces `sync_registers_once_if_client_key_is_refused`.
- [x] M5 The construction-time strip in `delivery.rs` stays, because the service applies Rust's pre-release rule too. `attested_manager` is compared with the cleared version. `releaseVersion` in `scripts/attest-build.mjs` strips the suffix, with a test.
- [x] M6 Docs: `GLOSSARY.md` gains "Build attestation" under "The patcher". ADR-0067 is unchanged. The PR #897 body replaces the client key bullets with the attestation.
- [x] M7 `scripts/attest-build.mjs` with the service's test key writes `test/fixtures/attestation.json` for S10.

## Phase 3: verification on staging

- [x] V1 Build a release candidate from a release branch. Its attestation registers against staging and receives a token.
- [x] V2 The manager log shows `Downloaded patcher DLL` for the channel, and the next patcher start logs `Using the delivered patcher DLL`.
- [x] V3 Deny the rc version. The next sync logs `Refused 403 manager`. A staged DLL keeps running, because a denial stops offers and downloads and a withdrawal stops a staged DLL.
- [x] V4 Lift the denial. The next sync registers again, within a minute of the KV write.

## Phase 4: production

- [ ] P1 Production worker gets `MANAGER_ATTESTATION_PUBLIC_KEYS` from K3, and the production private key enters the repository secret for stable releases.
- [x] P2 `delivery.rs` holds the staging and the production service, chosen by `LTK_PATCHER_DELIVERY`, which the release workflow sets to `staging` for a pre-release and `production` for a release, with the matching attestation secret. Both services carry their manifest key.
- [ ] P3 A stable release registers against production, by its `registration` event.
