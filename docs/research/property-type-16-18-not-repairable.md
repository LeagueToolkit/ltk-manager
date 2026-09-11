# `bin/property-type` does not repair the 16.18 String to File retypes

Research note, gathered on 2026-09-12 against `main` at `504d317a` (v1.18.1). Sections 1 to 4 are
the evidence. Section 5 is the proposed fix and section 6 what is deliberately left out.

The question came from users on patch 16.18 reporting that `String` to `File` property types are
not repaired. Two separate defects produce that one complaint, and each accounts for a different
half of it:

- **The shipped meta schema snapshot stops at build `8104348` (patch 16.17).** A 16.18 install is
  past it, so `MetaSchema::describes` is false, the schema arm of the rule stands down entirely
  and the six 16.18 `String` to `File` retypes are never reported at all.
- **`Conversion::between` crosses one dimension of a type at a time.** Two of the 16.18 shapes
  change a tag and an item type together, so they fall to `Conversion::Unknown`, report with no
  repair, and tell the reader to rebuild the mod against the current game.

## Sources

- `crates/ltk-manager-core/src/problems/rules/bin_property_type/mod.rs` - the rule, `Lens::objection`
  and `derived`
- `crates/ltk-manager-core/src/problems/rules/bin_property_type/table.rs` - `Conversion::between`
- `crates/ltk-manager-core/src/meta_schema.rs` - `MetaSchema::describes` and `expected`
- `crates/ltk-manager-core/src/meta_schema/cache.rs` - `MetaSchemaCache::load` and `refresh`
- `crates/ltk-manager-core/src/mods/health/sweep.rs` - `fill_meta_schema`, the only automatic sync
- `scripts/generate-meta-schema.mjs` and `.github/workflows/release-prepare.yml`
- `rito-meta diff 16.17 16.18`, read on 2026-09-12
- `https://raw.githubusercontent.com/LeagueToolkit/lol-meta-wiki/main/db/meta.db.json`, read the same day
- Three throwaway tests run in-crate against both databases, quoted below

## 1. What 16.18 changed

`rito-meta diff 16.17 16.18` returns twelve changed properties. Patch 16.18 is content build
`8159717`. Seven of the twelve carry a path across to `File`:

| Class and property                                | Old type           | New type         |
| ------------------------------------------------- | ------------------ | ---------------- |
| `TextureResource.texturePath`                     | `String`           | `File`           |
| `AtlasDataBase.mTextureName`                      | `String`           | `File`           |
| `MapBakeProperties.RmaStaticLightGridTexturePath` | `String`           | `File`           |
| `MapClouds.CloudsTexturePath`                     | `String`           | `File`           |
| `MapCubemapProbe.CubemapProbePath`                | `String`           | `File`           |
| `MapTerrainPaint.TerrainPaintTexturePath`         | `String`           | `File`           |
| `EvolutionDescription.mIconNames`                 | `List[String]`     | `List[File]`     |
| `UiElementParticleSystemData.TextureOverrides`    | `Map[File,String]` | `Map[File,File]` |
| `StaticMaterialDef.type`                          | `U32`              | `U8`             |
| `AudioPriorityBehavior.TargetQueue`               | `Link`             | `Hash`           |
| `AudioQueueConfig.0x1c6439cf`                     | `List2[Link]`      | `List2[Hash]`    |
| `AudioQueueConfigList.queues`                     | `List2[Link]`      | `List2[Hash]`    |

`TextureResource.texturePath` is the one behind the reports. It is in nearly every skin mod.

The shipped migration table `problems/tables/binfile_migration_16.17.8087655.jsonl` names none of
these classes except `UiElementParticleSystemData`, so the table arm of the rule cannot answer for
any of them. Everything below is about the schema arm.

## 2. The shipped snapshot is behind the game

`MetaSchema::describes` is `build.content() <= self.latest`, and `Judge::lens` returns `None` for a
build it refuses. `Lens::objection` then asks the schema nothing.

```
node scripts/generate-meta-schema.mjs --check
The snapshot is at 2026-08-24T03:56:00Z, reaching build 8104348, and the publisher is at
2026-08-24T03:56:00Z, reaching build 8159717.
```

Built against the shipped snapshot alone, with `TextureResource.texturePath` holding a string:

```
build 16.17.8104348: schema=true hits=0
build 16.18.8159717: schema=false hits=0
```

Not a finding without a repair. No finding. **A 16.18 install loses every schema-derived finding
the rule has, not only the 16.18 ones,** because one build comparison stands the whole arm down.

Nothing tells the reader this happened. `describes` has one caller outside the schema module, and
no panel draws the gap between the database's reach and the installed build.

### Why the snapshot is behind

`release-prepare.yml` runs `generate-meta-schema.mjs` and commits the result, so the snapshot
tracks the release cadence and nothing else. v1.18.1 was cut on 2026-09-10 and the generator wrote
nothing, so the 16.18 revisions landed in `lol-meta-wiki` after that date. The snapshot has not
moved since it was introduced in `df557df1` on 2026-09-01.

### Why the cache does not always cover for it

`MetaSchemaCache::load` prefers whichever copy covers the installed build, so a synced machine is
fine. The cache is filled in exactly two places:

```
.
|-- mods/health/sweep.rs: fill_meta_schema
|   |-- runs in front of the library health sweep
|-- src-tauri/src/commands/hashtables.rs
    |-- sync_hashtables, the Settings cache card
```

The workshop problems pass fetches nothing. `BinPropertyType::subscribe` calls
`Judge::opened(project.build())`, which reads whatever `meta_schema::shared` already has. A user
who works in the workshop and never runs a library sweep sits on the shipped snapshot forever.

Neither does the snapshot behave as a floor when the cache is also behind. `load` falls back to the
shipped copy only when the shipped copy describes the build, so when neither reaches it the cached
one is parsed and answers nothing.

## 3. `Conversion::between` crosses one dimension at a time

The second defect does not depend on the database being behind. Run against the published database
at build `8159717`, with values shaped the way a pre-16.17 mod writes them:

```
TextureResource.texturePath:                    string -> file             HashValue  fix=true
AtlasDataBase.mTextureName:                     string -> file             HashValue  fix=true
EvolutionDescription.mIconNames as list:        list[string] -> list[file] HashValue  fix=true
EvolutionDescription.mIconNames as list2:       list2[string] -> list[file] Unknown   fix=false
UiElementParticleSystemData as map[hash,string]: map[hash,string] -> map[file,file] Unknown fix=false
UiElementParticleSystemData as map[file,string]: map[file,string] -> map[file,file] HashValue fix=true
```

The two `Unknown` rows report this, from `note`:

> The game reads this property as `list[file]` and drops a value of any other type. Nothing
> rewrites a `list2[string]` into one, so the mod has to be rebuilt against the current game.

That sentence is what a user reads as "unfixable", and it is wrong in both cases. Reading
`Conversion::between`:

- `list2[string]` to `list[file]` misses because the `Container` and `UnorderedContainer` arm
  requires `to.value` to equal `from.value`, and the same-kind arm requires `to.kind` to equal
  `from.kind`. Neither holds when the tag and the item type move together, so it falls through to
  `widening`, which answers `Unknown` for a container.
- `map[hash,string]` to `map[file,file]` misses because one arm requires `from.key == to.key` and
  the other requires `from.value == to.value`. A map whose key and value both move matches neither.

Both are mechanically repairable with code the rule already has. `hashed` converts an
`UnorderedContainer` of `String`, `retagged` swaps the `List` and `List2` tags, and `rehash_keys`
rekeys a `Hash`-keyed map while `hashed` rewrites its `String` values. The gap is that `Conversion`
is one tag and `convert` dispatches on it once, so no row can name two steps.

## 4. What each defect costs

| Reader                                 | Today                                                |
| -------------------------------------- | ---------------------------------------------------- |
| 16.18, cache synced since 16.18 landed | Five of seven path retypes repair, two say rebuild   |
| 16.18, cache older or absent           | Silence on all twelve, and on every other schema row |
| 16.17 or older                         | Unaffected                                           |

## 5. Proposed fix

Three changes, independent of each other, in the order they pay off.

### 5.1 Refresh the embedded snapshot

`node scripts/generate-meta-schema.mjs` moves the snapshot from `8104348` to `8159717`. The same
two-build check then reads:

```
build 16.17.8104348: schema=true hits=0
build 16.18.8159717: schema=true hits=1
```

`cargo test -p ltk-manager-core` is 1308 passed, 0 failed with the new snapshot. This is the whole
of the first defect for every user, online or off, cache or no cache, and it is one command and one
commit. It is applied on this branch.

### 5.2 Stop the snapshot depending on the release cadence

The snapshot moves when a release is cut, and the game moves when Riot ships a patch. The two have
no reason to line up, and section 2 is what happens when they do not. Three pieces, smallest first:

```
.
|-- A scheduled workflow running `generate-meta-schema.mjs --check`
|   |-- opens a PR with the regenerated snapshot when the check fails
|   |-- the release then commits a snapshot that is already current
|-- Sync the schema in front of a project problems pass
|   |-- `fill_meta_schema` is what the library sweep already calls
|   |-- the workshop reader is the one this defect was reported by
|-- Say so when the game has outrun the database
    |-- `MetaSchema::describes` is false and nothing draws it
    |-- the rule reporting nothing reads as a clean project, which is the worst of the answers
```

The third is the one to keep even if the other two land. A check that stands down silently cannot
be told from a check that passed.

An alternative to the third, worth weighing rather than assuming: have `Judge::lens` floor to the
newest build the database names instead of refusing, the way `class_schema` already does. It would
keep the schema arm alive on a build past the database, at the cost of claiming a type the
installed game may have moved since. Recommended only beside a visible note that the answer is
floored, because silently answering at an older build is how a rule reports a mismatch that is not
there.

### 5.3 Let a conversion name more than one step

Give `Conversion` a composite form, so a row can hold the steps a value takes rather than one tag.
The smallest shape that covers both misses:

```rust
/// How a value crosses from the old type to the new one.
enum Conversion {
    // ... the existing single-step variants
    /// Two steps, applied in order, where one alone does not cross the pair.
    ///
    /// A container whose tag and item type both move, and a map whose key and
    /// value both move, are the pairs that need one.
    Then(&'static Conversion, &'static Conversion),
}
```

`Conversion::between` then answers `Then(HashValue, None)` for `list2[string]` to `list[file]` and
`Then(HashKey, HashValue)` for `map[hash,string]` to `map[file,file]`, and `convert` applies each
step against the value in front of it. What this has to keep:

- **`keep_names` sees every path the whole sequence hashes away.** It is what refuses a repair that
  would leave the mod holding a hash no table names, and a two-step conversion has two chances to
  do that.
- **The four-row idempotence in the module header.** A value matching `to` raises nothing, so a
  half-applied sequence has to leave the property as it was rather than partway across. Both steps
  above already report whether they changed anything, so a sequence is all-or-nothing on the same
  terms a single step is.
- **`preview` draws the paths the sequence writes from.** For both pairs above that is what
  `HashValue` and `HashKey` already draw.

A boxed or vector form is not needed. Every pair the meta database has produced so far is two steps
at most, and a fixed pair keeps `Conversion` `Copy` and the table's row type unchanged.

## 6. Not doing

**Widening the table to cover 16.18.** A table is a claim about one build and a hand-audited file,
and the database already carries what 16.18 changed. The rule was built to prefer the database for
exactly this, and adding a `binfile_migration_16.18.8159717.jsonl` would put the same 395-row audit
burden on a patch the database answers for free.

**Repairing `Link` to `Hash`.** `kinds::NAMES` holds no entry for `Link`, so `Shape::written`
returns `None`, the revision carries no shape and `objection` is silent. That is the documented
behaviour for a type name the mapping does not hold, and the three audio properties it affects are
not what was reported. It is a separate question from this one.

**Changing `describes` itself.** It gates every reader of the schema, not only this rule, and the
class card depends on its current meaning. Section 5.2 puts the decision in `Judge::lens`, which is
the rule's own.
