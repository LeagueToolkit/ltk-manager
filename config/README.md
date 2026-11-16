# Remote configuration

What the app reads off the default branch at runtime rather than out of the build it shipped as.
A document here changes a running install by merging a pull request. `news/` is the neighbouring
directory a reader sees, where this one only the app reads.

## Telemetry

`telemetry.json` is the kill switch and the volume dial for anonymous diagnostics. The app reads
it raw from the default branch on every boot, so that URL is the contract, and stopping collection
or changing the sample rate ships by merging a pull request without a release.

The document can only ever narrow what is collected. It never turns collection back on for
somebody who turned it off in Settings, and it never lifts the rule that a debug build reports
nothing.

### Schema 1

```json
{
  "schema": 1,
  "enabled": true,
  "sampleRate": 0.05,
  "endpoint": "https://eu.i.posthog.com/batch/",
  "minVersion": "1.17.0",
  "events": {
    "app_error": 0.25
  }
}
```

| Field        | Required | What it is                                                   |
| ------------ | -------- | ------------------------------------------------------------ |
| `schema`     | yes      | `1`. A build reads this schema and nothing else              |
| `enabled`    | no       | `false` stops every build at once. Defaults to `true`        |
| `sampleRate` | no       | The share of installs that report, from 0 to 1               |
| `endpoint`   | no       | Where a batch is posted, so a vendor change needs no release |
| `minVersion` | no       | A semver version. A build below it collects nothing          |
| `events`     | no       | A rate for one event name, drawn after the global one        |

A rate is drawn against the rotating identity rather than against the event, so an install is in
or out for a whole UTC day and a sampled session is never half reported. A per-event rate applies
on top of the global one, so an event named at `0.25` under a global `0.5` reaches an eighth of
installs.

A document on another schema, a document that does not parse, and a document that cannot be
fetched all leave the last one that could be read. A network failure must never be
indistinguishable from a deliberate stop. A build that has never read one falls back to the
compiled defaults in `src-tauri/src/telemetry/config.rs`, whose sample rate mirrors the rate
below so an install behind a blocked network weighs the same in the data as one that is not.

### Rollout

The rate is **deliberately low**, not left over.

| Stage | Rate   | When                                                                       |
| ----- | ------ | -------------------------------------------------------------------------- |
| 1     | `0.05` | The first release that reports. Confirms the event shape and the free tier |
| 2     | `0.25` | After a few days at stage 1 with no schema surprise and quota to spare     |
| 3     | `1.00` | Once the volume at stage 2 projects comfortably inside the free tier       |

Raise a stage by editing this one field. Read the projected volume off the vendor's usage page
before each raise rather than from the previous stage's raw count, since the population reporting
changes with the rate.

## Known issues

`known-issues.json` holds the maintainers' answer to a failure that many installs hit, such as a
game patch that stops every mod. The app reads it raw from the default branch, so that URL is the
contract. A maintainer publishes an entry by merging a pull request, and withdraws it by removing
the entry or by setting `expiresAt`. No release is needed.

The app shows the message of an entry beside a verdict of a listed kind: in the session bar after
a game, and in the `Get help` dialog before the send actions.

### Schema 1

```json
{
  "schema": 1,
  "issues": [
    {
      "id": "2026-11-patch-16-23",
      "verdicts": ["missing-data", "corrupt-archive"],
      "message": "Patch 16.23 moved the skin data. Update the manager to 1.35.0.",
      "url": "https://github.com/LeagueToolkit/ltk-manager/issues/1100",
      "versions": "<1.35.0",
      "expiresAt": "2026-12-15T00:00:00Z"
    }
  ]
}
```

| Field       | Required | What it is                                                            |
| ----------- | -------- | --------------------------------------------------------------------- |
| `schema`    | yes      | `1`. A build reads this schema and nothing else                       |
| `id`        | yes      | A stable name for the entry                                           |
| `verdicts`  | yes      | The verdict kinds that the entry explains. An empty list matches none |
| `message`   | yes      | One or two sentences in English                                       |
| `url`       | no       | The page that `Read more` opens                                       |
| `versions`  | no       | A semver range. The entry applies to a build inside the range only    |
| `expiresAt` | no       | RFC 3339. The entry is withdrawn after this time                      |

The verdict kinds are `patcher-did-not-run`, `overlay-build-failed`, `injection-host-failed`,
`patcher-out-of-date`, `archive-rejected`, `skinhack-detected`, `overlay-disabled`, `unmodded`,
`missing-data`, `corrupt-archive`, `texture-failed`, `out-of-memory`, `graphics-fault`,
`stuck-loading`, `archive-skipped`, `ended-without-reason`, `wrong-install` and `shader-failed`.

An entry with a `versions` range or an `expiresAt` time that does not parse is not shown. A
document on another schema, a document that does not parse and a document that cannot be fetched
all show no entry. The app keeps an answer for 30 minutes.
