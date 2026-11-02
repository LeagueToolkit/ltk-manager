# Tasks: LTK Protocol Install List

**Input**: Design documents from `.specify/specs/002-ltk-protocol-install-list/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/install-list-manifest.md

**Tests**: Pure functions first: the route, the manifest checks and the link resolution.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

- [x] T001 Add `DeepLinkRequest::InstallList` and `DeepLinkInstallListRequest` in
      `crates/ltk-manager-core/src/deep_link.rs`; share the URL checks through
      `public_https_url`; tests in `deep_link/tests.rs`
- [x] T002 Add `deep_link/install_list.rs`: manifest types, `parse_manifest`, `check_item`,
      `fetch_install_list`, `resolve_download`, `resolved_link`; tests in
      `install_list/tests.rs`
- [x] T003 Add `InstallListProgress` and `InstallListStage` to
      `crates/ltk-manager-base/src/events.rs` and the `install-list-progress` event name
- [x] T004 Add `ModOrigin` and `InstalledMod.origin` in `ltk-manager-library/src/mods/types.rs`,
      `LibraryModEntry.origin` in `index/document.rs`, `ModLibrary::set_mod_origin` in
      `library.rs`, and `origin: None` at every entry construction

## Phase 2: User Story 1 - Install a whole collection (P1)

- [x] T005 [US1] Stamp the list link's host and emit `deep-link-install-list` in
      `src-tauri/src/deep_link.rs`; move `reject_if_untrusted` there
- [x] T006 [US1] Add `src-tauri/src/deep_link/install_list.rs`: `InstallListPlan`,
      `InstallListReport`, `InstallListCancel`, `run` with per-item progress, one 429 retry, and
      the final reorder
- [x] T007 [US1] Add `deep_link_install_list_fetch`, `deep_link_install_list`,
      `deep_link_install_list_cancel` in `src-tauri/src/services/links.rs`; register in
      `services/table.rs`; register the event payloads in `ipc.rs`; regenerate bindings
- [x] T008 [P] [US1] Add the store in `src/modules/deep-link/state/installList.ts` and the
      query and mutations in `api/installList.ts`
- [x] T009 [US1] Hear `deep-link-install-list` and the cold-start `installList` hand-off in
      `api/useDeepLinkListener.ts`
- [x] T010 [US1] Add `components/InstallListDialog.tsx` and `InstallListRow.tsx`: the untrusted
      band, the list heading, the profile choice, the rows, the run progress, the report, Stop,
      Retry failed; queue it as `install-list` in `src/stores/dialogQueue.ts`; mount it in
      `src/routes/__root.tsx`
- [x] T011 [US1] Add the `deep_link_list_*` messages to `messages/en/deep-link.json`
- [x] T012 [US1] Tests in `components/__tests__/InstallListDialog.test.tsx`

## Phase 3: User Story 2 - A second run installs only what changed (P2)

- [x] T013 [US2] Record the origin on every installed, updated and already-installed item in
      the run (T006)
- [x] T014 [US2] Mark items the library holds at the listed version as installed and not
      selectable in the dialog (T010)

## Phase 4: User Story 3 - A collection into its own profile (P3)

- [x] T015 [US3] `InstallListProfile::New` creates and switches before the first item (T006)
- [x] T016 [US3] The profile choice and its name field in the dialog (T010)

## Phase 5: Polish

- [x] T017 `docs/ux/LIBRARY.md` "Installing a list"; `docs/ux/SETTINGS.md` points at it from
      "The deep link"; ADR-0076
- [x] T018 `cargo fmt`, `cargo clippy --all-targets`, `pnpm check`
- [ ] T019 Manual end-to-end against a published manifest, per quickstart.md
- [ ] T020 Runeforge: the signed manifest endpoint, the Install all button, the contract's
      version note (a Runeforge session, runeforge-io/runeforge#544)
