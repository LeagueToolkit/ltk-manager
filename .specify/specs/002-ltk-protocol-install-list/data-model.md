# Data Model: LTK Protocol Install List

## Entities

### DeepLinkInstallListRequest (Rust, `ltk-manager-core`)

| Field              | Type             | Description                                           |
| ------------------ | ---------------- | ----------------------------------------------------- |
| `url`              | `String`         | The manifest URL, checked as an install link's `url`  |
| `source`           | `Option<String>` | Display name, max 256 characters                      |
| `untrusted_domain` | `Option<String>` | Stamped by the host from the trusted providers list   |

### InstallList, InstallListItem, DownloadLink (Rust, `ltk-manager-core`)

The manifest after the checks of `parse_manifest`. See the contract for fields. `DownloadMethod`
is `Post` or `Get`.

### ModOrigin (Rust, `ltk-manager-library`)

| Field     | Type             | Description                                 |
| --------- | ---------------- | ------------------------------------------- |
| `source`  | `String`         | The site, as the link's `source` named it   |
| `id`      | `String`         | The mod's id on the site                    |
| `version` | `Option<String>` | The version the site listed, as written     |

Stored on `LibraryModEntry.origin` in `library.json` with `#[serde(default)]`, so an index without
it reads as before. Surfaced on `InstalledMod.origin`. Written by
`ModLibrary::set_mod_origin`.

### InstallListPlan, InstallListProfile (Rust, `src-tauri`)

What the reader confirmed. See the contract.

### InstallListReport, InstallListResult, InstallListFailure (Rust, `src-tauri`)

What a run did. See the contract.

### InstallListProgress (Rust, `ltk-manager-base` events)

| Field     | Type               | Description                                  |
| --------- | ------------------ | -------------------------------------------- |
| `index`   | `u32`              | Position among the items the run was handed  |
| `total`   | `u32`              | How many items the run was handed            |
| `item_id` | `String`           | The item's id on the site                    |
| `stage`   | `InstallListStage` | See the contract                             |
| `error`   | `Option<String>`   | The failure in a sentence, for `failed`      |

### Install list store (frontend, Zustand)

| Field     | Type                               | Description                          |
| --------- | ---------------------------------- | ------------------------------------ |
| `request` | `DeepLinkInstallListRequest\|null` | The link, `null` while none is asked |
| `phase`   | `idle \| running \| done`          | The run as a whole                   |
| `stages`  | `Record<itemId, InstallListStage>` | Each item's latest stage             |
| `report`  | `InstallListReport \| null`        | The last run's result                |
| `error`   | `AppError \| null`                 | A run that failed before its first item |

The manifest itself is a TanStack query keyed on the manifest URL, read once per link.

## State Transitions

```text
[idle] --link arrives--> [request set]
  |                            |
  |              untrusted host? ask, save, then read
  |                            |
  |                     [manifest read] --refused--> [failure drawn] --Done--> [idle]
  |                            |
  |                     reader confirms
  |                            |
  |                        [running]  per item: resolving -> downloading -> installing
  |                            |                 -> installed | updated | alreadyInstalled | failed
  |                   Stop pressed? ends after the current item
  |                            |
  |                         [done] --Retry failed--> [running] (failed items, active profile)
  |                            |
  +----------------------- Done -----------------------------+
```

## Relationships to Existing Entities

- **InstallOutcome**: Each item's install returns one, as a single install does. The run maps
  it to the item's stage and the report's bucket.
- **Profile**: The run reads the active profile for the report, creates and switches to a new one
  on request, and reorders its `mod_order` at the end through `reorder_mods`.
- **Settings.trustedDomains**: The fetch and the run both refuse a manifest host outside it.
