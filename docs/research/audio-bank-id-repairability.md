# `audio/bank-id`: is an unset soundbank id repairable, and is it a defect at all

Research note, and the record of what was decided from it. The findings in sections 1 to 3
and 5 are evidence. Sections 4 and 6 say what was built on them.

The question came from the mod-health drawer, where `audio/bank-id` sat under
`Cannot be repaired` with the sentence "Couldn't set an id because only the tool that
builds a bank assigns one". The prompt was that we understand the field well enough to
repair it simply. We do, and the sentence was wrong: the id is `FNV-1` of the bank's own
name and the repair is a four-byte write. What the evidence also says is that no reader of
the field is known, so the `Error` severity it shipped at was never supported.

## Sources

Primary, in order of weight:

- **The BKHD layout** - the chunk's fields, the version gate, and every known reader of
  the header id
- **The bank-name hash** - `AK::SoundEngine::GetBankIDFromString` and what it computes
- **The HIRC payload delta** behind `016-audio-bank-conversion`, relevant only to the
  neighbouring rule
- `crates/ltk-manager-core/src/problems/rules/audio_bank_id/mod.rs` - the rule as shipped
- `specs/013-mod-defect-rules/issues/013-audio-bank-id.md` - the issue that created it
- `specs/013-mod-defect-rules/issues/004-audio-bank-version.md` and
  `specs/013-mod-defect-rules/issues/012-audio-bank-removal.md` - the two neighbouring
  audio rules, which the conclusion below leans on

## 1. Where the id lives, and what it would have to be

The rule reads the right bytes. A `.bnk` opens with a `BKHD` chunk, and the header struct
inside it is laid out as:

```
file offset   struct offset   field
0             -               'BKHD'
4             -               u32 chunkSize
8             +0x00           u32 dwBankGeneratorVersion
12            +0x04           u32 dwSoundBankID
16            +0x08           u32 dwLanguageID
20            +0x0C           u16 uAlignment
22            +0x0E           u16 uAltValues
24            +0x10           u32 dwProjectID
28            +0x14           u32 dwBankType      (only read at version >= 143)
32            +0x18           16 B bank hash      (only read at version >= 143)
```

`crates/ltk-manager-core/src/problems/rules/audio_bank_id/mod.rs:39` sets `BANK_ID_AT = 12`
counted from the start of the file, which is `+0x04` in the struct. That is the field.

The value it would have to hold is not a mystery either.
`AK::SoundEngine::GetBankIDFromString` computes it as: strip the extension at the last `.`,
then FNV-1 32-bit over the ASCII-lowercased bytes - basis `0x811C9DC5`, prime
`0x01000193`, multiply before xor. It is FNV-1 and not FNV-1a, and reversing the order
gives a completely different value.

A worked example closes the loop: `sett_base_sfx_audio.bnk` ships with id `0xE9B70B40`, which is
`FNV-1("sett_base_sfx_audio")`.

So a repair is about as cheap as a repair gets:

- the input is the bank's own file name, which the finding's `Site` already carries
- the output is four bytes, little-endian, written at file offset 12
- no parse, no chunk walk, no dependency on the installed game, the hash tables or any
  other rule
- nothing else in the mod holds a copy that would need updating in lockstep, because a
  `BankUnit` names banks by path, not by id - see section 3

The premise behind the question is correct. This is a four-byte in-place patch and we know
exactly what to put there.

## 2. The field is never read, so the repair is cosmetic

This is the finding that reframes the question.

Exactly one reader of header offset `+4` is known, inside `AkBankMgr_GetInMemoryBankInfo`.
That function serves the `LoadBank(const void *memory, ...)` overloads, which have no file
name to hash and so must take the id from the header. Its callers are the eight in-memory
overloads - four `LoadBankMemoryView`, four `LoadBankMemoryCopy` - and nothing calls any of
the eight. League never calls them.

What League does call is the by-name path. `BankManager_LoadBankNow` does this
before any file is opened:

```c
AK_AppendExtensionIfMissing(&fileName, name, ".bnk");
*out_bankID = AK_GetBankIDFromString(name);
```

The id is decided from the file name, before the file exists to the loader. The bank
record and the hash-table key it registers under both come from the request rather than
the header, and no comparison between the requested id and the header id is made
anywhere.

The same holds of Riot's own code. `SoundBank_ExtractEventIds`
reads `BKHD`'s id and size and seeks straight past the body looking for `HIRC`, so the
pre-pass never reads the bank id either.

The conclusion the evidence draws: the header id does not matter. Zero is fine. It is not
read. Fixing it is not worth effort, and a mismatch is not the cause of a problem.

### 2.1 How far that evidence actually reaches

It is a static-analysis argument for a negative, and it should be read as one.

What is established is that no call path found reads the field. What is not established is
that no call path exists. A missed indirect call, a read through the header struct's tail
that the sweep did not chase, or a path in a build the sweep did not cover would all defeat
it, and two of these are open - the `.wpk` container was not covered at all, and the
16-byte hash at `+0x18` was not chased through every read of the struct's tail.

The 18 `crepe_*` banks the sweep counts are **not** the confirming observation I first read
them as. They are version-125 scrapped characters, and no `BankUnit` reference check was
done for the dead content in this install. A bank nothing
requests is never loaded, so it cannot demonstrate that a mismatched id loads. It shows
that Riot's build once shipped a mismatch, not that the runtime tolerates one.

So the honest statement is a narrow one: **there is no known reader, and no
observation of a zero-id bank failing because of its id.** That is enough to say the
severity is unsupported. It is not enough to say the field is provably inert, and it is
not a reason to leave a file holding a value the format says is wrong.

## 3. What the rule's own premise got wrong

Three claims in `013-audio-bank-id.md` and in the module doc do not survive the
evidence.

| Claim                                                                       | Where                                                    | Status                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| "A Wwise bank's header carries the id the runtime addresses the bank by"    | `013-audio-bank-id.md` context, `audio_bank_id/mod.rs:3` | Contradicted. The runtime addresses it by FNV-1 of the file name, computed before the file is opened - section 2 |
| "nothing can ask for it by name and the sounds in it never play"            | `audio_bank_id/mod.rs` `detail()`                        | Contradicted. The name is exactly what it is asked for by, and the name still works                              |
| Severity `Error`, defined as "the game rejects this. The mod does not work" | `audio_bank_id/mod.rs:82`, `problems/mod.rs:73`          | Contradicted. Nothing rejects it                                                                                 |

What survives is the census. Zero banks out of 7,829 in the rule's own measurement, and
zero out of 8,875 in a larger sweep of retail 16.17, carry an unset id.
That statistic holds. What it means is different from what the issue took it to mean: a
zero id is reliable evidence that a bank was not built by the Wwise toolchain, and it is
not evidence that the bank is broken.

The issue was careful about this at the time. It wrote "What an id of zero costs is not
established here" and declined to claim a runtime fault. The gap is that it still shipped
at `Error` and still told the user their sounds never play, on the strength of a
correlation across two specimens.

That correlation now has a better explanation sitting next to it. The specimens are
described as a modder-rebuilt SFX bank at a real game path. The rule that catches the
actual failure in that shape is `audio/bank-version`, `013-004`: a legacy-version bank
carrying `HIRC` is rejected by `AkBankMgr_ProcessBankChunks` with `AK_WrongBankVersion`,
and in retail it is dropped silently because `AK_OPTIMIZED` stripped the emit. Both a zero
id and a rejected
version are downstream of the same cause - a bank rebuilt by a non-Wwise tool - and only
one of them is the thing that stops the audio.

On the lockstep question: nothing else needs updating. `013-012` records that a bank is
requested through `SkinAudioProperties` and `BankUnit`, and a bank unit carries the paths
of the files the unit needs. No id crosses that boundary.

## 4. What was decided

The rule stays, demoted to `Info`, and it now offers the repair.

`Info` is "worth knowing, and nothing is wrong"
(`crates/ltk-manager-core/src/problems/mod.rs:78`), which is what the evidence carries: a
zero id is reliable evidence that a bank was not built by the Wwise toolchain, and there is
no observation of one failing because of it. Reporting it as an `Error` claimed a cost
nothing measured.

Offering the repair anyway is the other half. Section 2.1 is an argument that no reader is
_known_, not that none exists, and a file holding a value the format says is wrong is worth
correcting whether or not this build of the game reads it. The repair costs four bytes and
depends on nothing.

What shipped, in `crates/ltk-manager-core/src/problems/rules/audio_bank_id/`:

- severity is `Info`
- `fix` writes `FNV-1` of the lowercased file name with its extension stripped, little-endian
  at file offset 12
- the id is re-read from the file before the write, so a bank rebuilt since the check keeps
  the id its builder gave it
- a chunk an unpack named by its hash is resolved through the mod's own bank units, which
  list a bank's path in plaintext - section 3's lockstep finding read the other way round.
  Hashing the 16 hex digits would write an id belonging to nothing, so only a bank no unit
  lists goes unrepaired, and that is a bank the game never asks for
- `the_name_hashes_to_the_id_the_game_ships` pins the hash against the shipped
  `sett_base_sfx_audio.bnk` at `0xE9B70B40`, so FNV-1a can never be substituted silently

**The trigger is still an id of zero, not a mismatch.** Zero is the value measured absent
from every one of the 8,875 shipped banks. A mismatch is not: the same sweep counts 18
shipped banks whose id does not match their own name, so a rule keyed on
mismatch would report the game's own content.

## 5. The grouping: what the model held, and why the split was not severity

### What the model holds today

Severity already exists and is already four-valued
(`crates/ltk-manager-core/src/problems/mod.rs:70`):

```
Fatal    The game crashes on this.
Error    The game rejects this. The mod does not work.
Warning  The game accepts this, and something is still wrong.
Info     Worth knowing, and nothing is wrong.
```

`ModHealthVerdict` already carries `counts: Counts` - fatals, errors, warnings, infos - per
mod (`crates/ltk-manager-core/src/mods/health.rs:41`). So severity reaches the frontend
today, at mod granularity.

`RuleBrief`, which is the per-issue-group struct the row unfolds into
(`crates/ltk-manager-core/src/mods/health.rs:57`), carries `rule`, `title`, `description`,
`count`, `fixable`, `mismatches` and `unfixable`. It has no severity field. That is the gap
between the current model and "emit the severity per issue group" - one field on
`RuleBrief`, populated in `rule_briefs` (`crates/ltk-manager-core/src/mods/health.rs:459`).

One wrinkle for that fold: severity is passed per problem at report time
(`report.problem(ID, Severity::Error, site, detail)`), not declared per rule, so folding a
rule's problems into one brief needs a rule for combining them. Taking the worst is the
obvious answer. Most rules emit one constant severity, so it would rarely bite.

The two top-level groups are not severity and never were. `health` is derived in
`ModHealthVerdict::from_run` (`crates/ltk-manager-core/src/mods/health.rs:405`) purely from
whether any finding is fixable:

```rust
let health = if total == 0 {
    ModHealth::Healthy
} else if fixable > 0 {
    ModHealth::Repairable
} else {
    ModHealth::Unrepairable
};
```

The frontend then groups on that one bit
(`src/modules/library/components/ModHealthSweepPanel.tsx:58` and `:419`).

### What the split is actually for

`docs/ux/MOD_HEALTH.md:432` states the reason, and it is not severity:

> A missing Repair button is not a message: a reader scanning twenty rows sees one with
> nothing to press and has to work out why. `Cannot be repaired` on the group header puts
> that fact over every row it covers, and saying it there is what lets the rows drop it - a
> column of `unfixable` repeated per row was the noise the grouping folds away.

So the axis is pressability, and the grouping exists to explain an absent button once
rather than twenty times. Per-group severity is a different axis and does not answer that
question, so removing the split leaves the absent-button problem to be re-solved.

The header's next-step sentence is built on the same bit
(`src/modules/library/components/ModHealthSweepPanel.tsx:317-330`): a library no repair can
reach reads "None of them are auto-fixable, so look for updated versions".

### The weakness that supports the question

`fixable > 0` is a low bar. A mod with six hundred unfixable errors and one fixable warning
is filed under `Can be repaired`, and `docs/ux/MOD_HEALTH.md:428` confirms this is
deliberate - "Both groups count the same thing, so a repairable row shows every finding
rather than only the subset a repair can reach". In the screenshot that prompted this,
`Megumin - Kaisa` sits under `Can be repaired` with 614 problems, and nothing on the row
says how many of those the button reaches.

So the current split can overpromise, which is an argument for changing something. It is
not by itself an argument for severity replacing it, because the two carry different facts.
Three shapes are open:

- severity in addition to the split - a mark on each rule row inside an unfolded mod, the
  split left alone. Smallest change, one field on `RuleBrief`
- severity replacing the split - needs a new answer for the absent button, such as a
  disabled Repair carrying a reason, or a per-row chip. That is the per-row noise
  `docs/ux/MOD_HEALTH.md:432` says the grouping was built to remove
- keep the split but make it honest - show `n of m` on a repairable row so the button stops
  overpromising, with severity added independently

`docs/ux/MOD_HEALTH.md` would have to change under any of them, because it states the
current grouping as a decision with a reason rather than as an implementation detail.

## 6. What was decided about the grouping

The two top-level groups are gone. Mods are the top-level rows, as files are in the project
editor's Problems panel, and severity is emitted per issue group.

- `RuleBrief` gains `severity` (`crates/ltk-manager-core/src/mods/health.rs`), the worst of
  the rule's live problems. Worst-wins is needed rather than a per-rule constant because
  `bin/property-type` genuinely reports at two severities depending on the installed build
- the stored shape carries it, so `VERDICT_FILE_VERSION` went to 3 and old verdicts re-check
- `SeverityGlyph` and `SeverityTally` moved to `@/components`, so the two surfaces draw one
  vocabulary rather than two that drift
- rows sort by the footer's targets, then the worst severity, then the count
- the absent-button problem is answered in the seat the button would have taken:
  `Needs an updated version`, revealed on hover and focus. Not a permanent per-row label,
  which is the noise the old grouping existed to fold away

`docs/ux/MOD_HEALTH.md` and `DS-REPORT-PANEL` in the `design-system` skill both stated the
old anatomy as a decision, and both were rewritten to state this one.

## Open questions

- Do we have a specimen of a zero-id bank that is otherwise sound - correct version,
  correct chunk shape - and does its audio play? That is the one measurement that would
  turn section 2 from a strong static reading into an observed result
- Were the two specimens behind `013-audio-bank-id.md` also failing `audio/bank-version`?
  If they were, the silence is already attributed and the id rule reported a passenger
- Does any rule other than `audio/bank-id` currently report at a severity its evidence does
  not carry? The pass here was prompted by one rule, and the failure mode is not
  obviously unique to it
- The row now tallies by severity rather than showing `n of m`. Whether a reader still wants
  to know how much of a mod the press reaches, before pressing it, is untested
