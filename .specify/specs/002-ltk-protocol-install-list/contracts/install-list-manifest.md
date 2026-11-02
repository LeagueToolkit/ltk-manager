# Contract: `ltk://install-list` and the manifest (v1)

## Deep link

```text
ltk://install-list?url=<https manifest URL>&source=Runeforge
```

| Parameter | Required | Description                                                                   |
| --------- | -------- | ----------------------------------------------------------------------------- |
| `url`     | Yes      | The manifest URL. `https`, no local or private host. Opaque to the manager.   |
| `source`  | No       | A display name for the site, cut to 256 characters.                           |

Unknown parameters are ignored. A manager older than this contract answers the route with
`Unknown action`, which the site reads as "needs LTK Manager 1.33 or later".

The manager stamps the link with `untrustedDomain` when the manifest host is outside the trusted
providers list, and asks the reader before reading the list.

## Manifest

`GET <url>` with `Accept: application/json` answers `application/json`:

```json
{
  "version": 1,
  "name": "Clean ADC kit",
  "author": "ezreal_main",
  "source": "Runeforge",
  "pageUrl": "https://runeforge.dev/collections/5a00…",
  "items": [
    {
      "id": "57000000-0000-0000-0000-000000000001",
      "name": "Necron Chronomancer Kalista",
      "author": "frostforge",
      "version": "v1.2.0",
      "pageUrl": "https://runeforge.dev/mods/…",
      "download": {
        "method": "POST",
        "url": "https://runeforge.dev/api/mods/<modId>/releases/<releaseId>/download-link"
      }
    }
  ]
}
```

| Field            | Required | Notes                                                                      |
| ---------------- | -------- | -------------------------------------------------------------------------- |
| `version`        | Yes      | Exactly `1`. Any other value refuses the manifest whole.                   |
| `name`           | Yes      | Cut to 256 characters.                                                     |
| `author`         | No       |                                                                            |
| `source`         | No       | Replaces the link's `source` on screen and in the origin record.           |
| `pageUrl`        | No       |                                                                            |
| `items`          | Yes      | At most 500, in the owner's order, top first.                              |
| `items[].id`     | Yes      | The mod's id on the site. The origin record keeps it.                      |
| `items[].name`   | Yes      | Cut to 256 characters.                                                     |
| `items[].author` | No       |                                                                            |
| `items[].version`| No       | As the site writes it. The origin record keeps it as written.              |
| `items[].pageUrl`| No       |                                                                            |
| `items[].download.method` | Yes | `POST` or `GET`.                                                      |
| `items[].download.url`    | Yes | `https`, on the manifest's host.                                      |

Unknown fields are ignored. The site leaves out mods with no release, and mods the reader could
not install when the manifest was minted.

## The download of one item

- `POST`: the manager POSTs `download.url` with `Accept: application/json` just before the item
  downloads, never in advance. The answer is `{ "path": "...", "expiresAt": "..." }`. `path`
  resolves against the link's origin and must stay `https` on the manifest's host. `expiresAt` is
  not read. The resolved URL is downloaded as a single install's `url` is, following redirects.
- `GET`: `download.url` is the file.

A 429 with `Retry-After` of at most 60 seconds is waited through once, on the mint or the
download. Any other refusal fails the item, and the run continues.

## Limits the manager enforces

| What                            | Limit                                       |
| ------------------------------- | ------------------------------------------- |
| Manifest body                   | 1 MiB, 10 s request timeout                 |
| `items`                         | at most 500                                 |
| `version`                       | exactly 1                                   |
| `download.url`, the minted path | `https`, same host as the manifest, no local host |
| Concurrency                     | one item at a time                          |
| `User-Agent`                    | `ltk-manager/<version>`                     |

## Tauri IPC

### `deep_link_install_list_fetch(url) -> InstallList`

Reads the manifest. Refuses `UNTRUSTED_DOMAIN` for a host outside the list, `DOWNLOAD` for a
refused or unreachable manifest, and `VALIDATION_FAILED` for one outside the limits.

### `deep_link_install_list(plan) -> InstallListReport`

```typescript
interface InstallListPlan {
  manifestUrl: string;
  source: string;
  items: InstallListItem[];        // the checked items, in the list's order
  profile: { kind: "active" } | { kind: "new"; name: string };
}

interface InstallListReport {
  installed: { itemId: string; mod: InstalledMod }[];
  updated: { itemId: string; mod: InstalledMod }[];
  alreadyInstalled: { itemId: string; mod: InstalledMod }[];
  failed: { itemId: string; error: AppErrorResponse }[];
  cancelled: boolean;
  profile: Profile;
}
```

Holds for the whole run. Fails before the first item for an untrusted host, an item outside the
manifest checks, or a profile that cannot be made. From the first item on, every failure is a
row of `failed`.

### `deep_link_install_list_cancel()`

Stops the run after the item it is on.

## Events

| Event                       | Payload                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `deep-link-install-list`    | `DeepLinkInstallListRequest { url, source, untrustedDomain }` |
| `install-list-progress`     | `InstallListProgress { index, total, itemId, stage, error }`  |
| `protocol-install-progress` | the bytes of the item being downloaded, as for a single install |

`stage` is one of `resolving`, `downloading`, `installing`, `installed`, `updated`,
`alreadyInstalled`, `failed`.
