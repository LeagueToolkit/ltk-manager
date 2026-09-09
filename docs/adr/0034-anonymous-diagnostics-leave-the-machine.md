# ADR-0034: Anonymous diagnostics leave the machine

- **Status:** Accepted (2026-09-08)
- **Date:** 2026-09-08
- **Crates:** `ltk-telemetry`, `ltk-manager-core`, `src-tauri`
- **Related:** [ADR-0029](0029-the-generated-bindings-describe-the-wire-format-they-do-not-change-it.md),
  whose envelope the one reporting command answers through.

## Context and problem statement

The manager classifies a failed game session into a verdict, names the suspects and writes the
incident to disk. Every one of those incidents ends on the machine that produced it. The one
outward route is a reader pressing **Report a Bug**, and almost nobody does.

What the project cannot answer follows from that. How often a session ends badly. Which verdict
kinds dominate. Whether a release moved the rate. Whether a rule fires wrongly, names the wrong
suspect, or never fires at all.

A machine that reports carries a reader's library, their paths and their account. The design
question is not whether to collect but what can be collected without any of that.

## Decision

Anonymous diagnostics are on by default and send four events: a game session ending, a backend
error reaching the frontend, a Rust panic, and a frontend crash. Nothing else leaves.

The identity on an event is a hash of a secret held on the machine and the current UTC date. It
changes at midnight and the secret never leaves in raw form. Daily unique counts are what this
buys, and retention curves across a week are what it gives up.

A suspect travels as a digest and the coded reason it was named, never as a name, a path or an id.
The digest covers the mod archive's bytes in archive storage and the mod's sorted wad paths in
project storage.

A reader is told before anything leaves, in a dialog on the first launch after the release that
carries it, which offers the switch that turns it off then and there. A **Privacy** card in
Settings carries the same switch and a button that mints a new secret.

A published document at `config/telemetry.json` can stop collection or narrow it for every install
without a release. It never widens what a reader refused.

## Consequences

**The digest is pseudonymous rather than anonymous.** A maintainer holding the same mod file
computes the same digest, so a popular mod is recognisable in the data by anybody who already has
it. The property is a fingerprint of a file, not of a person, and it identifies the mod rather than
the reader. Claiming otherwise would be claiming more than the design provides, so the public page
says this plainly.

**A repacked mod is a different mod.** The archive digest is over the bytes, so re-packing the same
content reports as something new. Correlating a mod across repacks is not available and is not
worth a weaker digest.

**The rate has a denominator.** A clean session reports as well as a failing one, so a verdict rate
is a rate. The cost is that the session event is the highest volume thing the app sends, which is
what the sample rate in the published document exists to control.

**A reader who refuses is silent, not queued.** Turning the switch off discards what was spooled
rather than holding it back, and an install with the switch off does not even fetch the published
configuration.

**The schema is one file per side.** `crates/ltk-manager-core/src/diagnostics/telemetry.rs` holds
what a session reports and `src-tauri/src/telemetry/errors.rs` holds what a failure reports. A
property that changes in either without `docs/ux/TELEMETRY.md` changing with it is a defect.
