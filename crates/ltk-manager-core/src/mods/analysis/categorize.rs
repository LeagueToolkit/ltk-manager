//! Mod content → category classification.
//!
//! Two classification paths feed the same [`DerivedCategorization`]:
//!
//! - **Precise** — [`DerivedCategorization::from_chunk_paths`] reads a modpkg's
//!   internal chunk paths (e.g. `assets/characters/aatrox/skins/skin01/...`).
//!   The chunk path names the content unambiguously, so it distinguishes
//!   champions, maps, emotes, summoner icons, ward skins, TFT and companions —
//!   and never confuses a champion base-particle edit for a map skin.
//! - **Coarse** — [`ModWadReport::derive_categorization`] works only from the
//!   WAD footprint (`affected_wads`, e.g. `DATA/FINAL/Champions/Aatrox.wad.client`).
//!   Used for `.fantome` mods whose chunks are hash-keyed and carry no readable
//!   path. Reliable for champions/maps (the WAD filename names them) but blind
//!   to the shared-WAD categories, which all live in `Global`/`UI`.
//!
//! Both are pure and I/O-free; the champion roster (which names are real
//! champions vs. wards/pets/structures) is supplied by the caller via
//! [`ChampionRoster::from_internal_names`].

use super::wad_reports::ModWadReport;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Categories derived from a mod's contents. Each list is de-duplicated and
/// sorted. Champions hold display names (e.g. `"Aatrox"`); maps and tags hold
/// well-known slugs (e.g. `"summoners-rift"`, `"champion-skin"`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DerivedCategorization {
    pub champions: Vec<String>,
    pub maps: Vec<String>,
    pub tags: Vec<String>,
    /// The champion the mod contributes most content to, of [`Self::champions`].
    ///
    /// Weighted by chunk paths on the precise path and by per-WAD override
    /// counts on the coarse one, so a mod that edits one champion and spills a
    /// little into two others names the one it is actually a skin for. `None`
    /// for a report analysed before this was recorded, and for a mod with no
    /// champions at all.
    #[serde(default)]
    pub primary_champion: Option<String>,
}

impl DerivedCategorization {
    /// `true` when nothing was classified — caller may fall back to a coarser
    /// source rather than persist an empty result.
    pub fn is_empty(&self) -> bool {
        self.champions.is_empty() && self.maps.is_empty() && self.tags.is_empty()
    }
}

/// A content-category tag, stored as its slug in [`DerivedCategorization::tags`].
#[derive(Debug, Clone, Copy)]
enum Tag {
    ChampionSkin,
    MapSkin,
    WardSkin,
    Emote,
    SummonerIcon,
    Ui,
    Tft,
    Companion,
    /// Whole-mod fallback when content exists but matched no specific rule.
    Misc,
}

impl Tag {
    /// The serialized slug written into [`DerivedCategorization::tags`].
    fn slug(self) -> &'static str {
        match self {
            Tag::ChampionSkin => "champion-skin",
            Tag::MapSkin => "map-skin",
            Tag::WardSkin => "ward-skin",
            Tag::Emote => "emote",
            Tag::SummonerIcon => "summoner-icon",
            Tag::Ui => "ui",
            Tag::Tft => "tft",
            Tag::Companion => "companion",
            Tag::Misc => "misc",
        }
    }
}

/// The set of real champions, keyed by normalized internal name. Distinguishes
/// `characters/aatrox` (a champion) from `characters/sightward` (a ward) or
/// `characters/annietibbers` (a summon) so the classifier never emits a champion
/// for a non-champion entity.
#[derive(Debug, Clone, Default)]
pub struct ChampionRoster {
    display_by_norm: HashMap<String, String>,
}

impl ChampionRoster {
    /// Build from the champion WAD stems under `DATA/FINAL/Champions` (e.g.
    /// `"Aatrox"`, `"MonkeyKing"`). Localized variants collapse onto the same
    /// key, and the display-name overrides are applied here.
    pub fn from_internal_names<I, S>(names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut display_by_norm = HashMap::new();
        for name in names {
            let name = name.as_ref();
            let key = norm_key(name);
            if key.is_empty() {
                continue;
            }
            display_by_norm
                .entry(key)
                .or_insert_with(|| champion_display_name(name));
        }
        Self { display_by_norm }
    }

    /// Display name for an internal champion name (`"aatrox"` → `"Aatrox"`), or
    /// `None` if the name isn't a champion.
    fn lookup(&self, internal_name: &str) -> Option<&str> {
        self.display_by_norm
            .get(&norm_key(internal_name))
            .map(String::as_str)
    }
}

/// Map a champion's internal name to its display name (`"MonkeyKing"` →
/// `"Wukong"`); names without an override pass through unchanged.
fn champion_display_name(internal: &str) -> String {
    match internal {
        "MonkeyKing" => "Wukong".to_string(),
        other => other.to_string(),
    }
}

/// A non-champion `characters/` entity that is a placeable ward (sight ward,
/// control ward / `jammerdevice`, or a `*trinket`).
fn is_ward_entity(name: &str) -> bool {
    name.contains("ward") || name.ends_with("trinket") || name == "jammerdevice"
}

/// The first known map slug among `segments`, case-insensitively (`"Map11"` →
/// `"summoners-rift"`). Only confident mappings are named; an unrecognized
/// `mapNN` yields `None` so the caller emits the generic `map-skin` tag without
/// guessing a wrong mode. Shared by both classification paths.
fn map_slug_from_segments(segments: &[String]) -> Option<&'static str> {
    segments
        .iter()
        .find_map(|s| match s.to_ascii_lowercase().as_str() {
            "map11" => Some("summoners-rift"),
            "map12" => Some("aram"),
            _ => None,
        })
}

/// Normalization key for de-duplicating derived values against each other and
/// against user-declared metadata: lowercase, alphanumerics only. Lets a
/// derived `"Aatrox"` collapse against a user-typed `"aatrox"`.
fn norm_key(s: &str) -> String {
    s.chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect()
}

/// Collapse a sorted set on its normalized key, keeping the first occurrence.
fn dedup_normalized(values: BTreeSet<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for v in values {
        if seen.insert(norm_key(&v)) {
            out.push(v);
        }
    }
    out
}

/// Collects classified categories, then finalizes into a sorted, normalized
/// [`DerivedCategorization`]. Both classification paths funnel through here so
/// de-duplication and ordering happen in exactly one place.
#[derive(Default)]
struct CategoryAccumulator {
    /// Each champion against the weight of what the mod puts into it.
    champions: BTreeMap<String, u32>,
    maps: BTreeSet<String>,
    tags: BTreeSet<String>,
}

impl CategoryAccumulator {
    fn add_champion(&mut self, display_name: String, weight: u32) {
        *self.champions.entry(display_name).or_default() += weight;
    }

    fn add_map(&mut self, slug: &str) {
        self.maps.insert(slug.to_string());
    }

    fn add_tag(&mut self, tag: Tag) {
        self.tags.insert(tag.slug().to_string());
    }

    fn remove_tag(&mut self, tag: Tag) {
        self.tags.remove(tag.slug());
    }

    fn clear_maps(&mut self) {
        self.maps.clear();
    }

    fn finish(self) -> DerivedCategorization {
        // A `BTreeMap` iterates by name, and only a strictly greater weight
        // displaces the leader, so an all-square set resolves to its first name
        // rather than to whichever one hashing happened to reach last.
        let primary_champion = self
            .champions
            .iter()
            .fold(None::<(&String, u32)>, |best, (name, &weight)| match best {
                Some((_, leading)) if weight <= leading => best,
                _ => Some((name, weight)),
            })
            .map(|(name, _)| name.clone());

        DerivedCategorization {
            champions: dedup_normalized(self.champions.into_keys().collect()),
            maps: dedup_normalized(self.maps),
            tags: dedup_normalized(self.tags),
            primary_champion,
        }
    }
}

// ─── Precise classification (modpkg chunk paths) ───

/// What a single chunk path resolves to. [`ChunkClass::Unclassified`]
/// contributes nothing, signalling the caller to defer to the coarse path.
enum ChunkClass {
    /// Champion display name; also implies the `champion-skin` tag.
    Champion(String),
    /// A placeable ward (`ward-skin`).
    Ward,
    /// Map content (`map-skin`), with a well-known slug when the path names one.
    Map(Option<&'static str>),
    /// A flat tag (`emote`, `summoner-icon`, `ui`, `tft`, `companion`).
    Tag(Tag),
    /// Recognized as nothing.
    Unclassified,
}

/// A modpkg chunk path split into lowercased, separator-normalized segments
/// (`assets\Characters\Aatrox\...` → `["assets", "characters", "aatrox", …]`).
struct ChunkPath {
    segments: Vec<String>,
}

impl ChunkPath {
    fn parse(raw: &str) -> Self {
        let segments = raw
            .replace('\\', "/")
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect();
        Self { segments }
    }

    /// The segment immediately following the first occurrence of `key`.
    fn segment_after(&self, key: &str) -> Option<&str> {
        let idx = self.segments.iter().position(|s| s == key)?;
        self.segments.get(idx + 1).map(String::as_str)
    }

    fn has_segment(&self, segment: &str) -> bool {
        self.segments.iter().any(|s| s == segment)
    }

    /// Classify this path. Rules are ordered by specificity; the first match wins.
    fn classify(&self, roster: &ChampionRoster) -> ChunkClass {
        // 1. `characters/<name>` — champion, ward, or an ignored summon/structure.
        if let Some(name) = self.segment_after("characters") {
            return match roster.lookup(name) {
                Some(display) => ChunkClass::Champion(display.to_string()),
                None if is_ward_entity(name) => ChunkClass::Ward,
                None => ChunkClass::Unclassified,
            };
        }

        // 2. Map content — `assets|data/maps/...` or `levels/mapNN/...`.
        let is_map =
            self.has_segment("maps") || self.segments.first().is_some_and(|s| s == "levels");
        if is_map {
            return ChunkClass::Map(map_slug_from_segments(&self.segments));
        }

        // 3. Loadout cosmetics — `[assets/]loadouts/<kind>/...`.
        if let Some(kind) = self.segment_after("loadouts") {
            return match kind {
                "summoneremotes" => ChunkClass::Tag(Tag::Emote),
                "companions" => ChunkClass::Tag(Tag::Companion),
                k if k.starts_with("tft") => ChunkClass::Tag(Tag::Tft),
                _ => ChunkClass::Unclassified,
            };
        }

        // 4. UX / HUD — `assets/ux/<kind>/...`.
        if let Some(kind) = self.segment_after("ux") {
            return match kind {
                "summonericons" => ChunkClass::Tag(Tag::SummonerIcon),
                k if k.starts_with("tft") => ChunkClass::Tag(Tag::Tft),
                _ => ChunkClass::Tag(Tag::Ui),
            };
        }

        // 5. Standalone companion / TFT content not under loadouts.
        if self.has_segment("companions") {
            return ChunkClass::Tag(Tag::Companion);
        }
        if self
            .segments
            .iter()
            .any(|s| s == "tft" || s.starts_with("tftset"))
        {
            return ChunkClass::Tag(Tag::Tft);
        }

        ChunkClass::Unclassified
    }
}

impl DerivedCategorization {
    /// Precise classification from a modpkg's internal chunk paths.
    ///
    /// `roster` decides which `characters/` entities are real champions. Pure
    /// over `chunk_paths`; safe to compute once at analysis time and persist.
    ///
    /// An empty result means "nothing to add" and tells the caller to defer to
    /// the coarse WAD-footprint classification — so, unlike the coarse path,
    /// this one deliberately never emits a `misc` fallback that would clobber it.
    pub fn from_chunk_paths(chunk_paths: &[String], roster: &ChampionRoster) -> Self {
        let mut acc = CategoryAccumulator::default();

        for path in chunk_paths {
            match ChunkPath::parse(path).classify(roster) {
                ChunkClass::Champion(name) => {
                    acc.add_champion(name, 1);
                    acc.add_tag(Tag::ChampionSkin);
                }
                ChunkClass::Ward => acc.add_tag(Tag::WardSkin),
                ChunkClass::Map(slug) => {
                    acc.add_tag(Tag::MapSkin);
                    if let Some(slug) = slug {
                        acc.add_map(slug);
                    }
                }
                ChunkClass::Tag(tag) => acc.add_tag(tag),
                ChunkClass::Unclassified => {}
            }
        }

        acc.finish()
    }
}

// ─── Coarse classification (WAD footprint) ───

/// One affected-WAD path split into the segments we classify on. Separators are
/// normalized (`\` → `/`) and empty segments dropped; segment matching is
/// case-insensitive while champion names preserve their original case.
struct WadPath {
    segments: Vec<String>,
    /// Index of the first segment that isn't `DATA`/`FINAL` — the category root.
    category_index: Option<usize>,
}

impl WadPath {
    fn parse(raw: &str) -> Self {
        let segments: Vec<String> = raw
            .replace('\\', "/")
            .split('/')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        let category_index = segments.iter().position(|s| {
            let lower = s.to_ascii_lowercase();
            lower != "data" && lower != "final"
        });
        Self {
            segments,
            category_index,
        }
    }

    /// The category root segment, lowercased and with any WAD extension stripped
    /// (`"UI.wad.client"` → `"ui"`, `"Champions"` → `"champions"`).
    fn category(&self) -> Option<String> {
        let seg = &self.segments[self.category_index?];
        Some(seg.split('.').next().unwrap_or(seg).to_ascii_lowercase())
    }

    /// Champion internal name: the file stem of the segment after `Champions/`.
    fn champion_name(&self) -> Option<String> {
        let idx = self.category_index?;
        if !self.segments.get(idx)?.eq_ignore_ascii_case("champions") {
            return None;
        }
        let file = self.segments.get(idx + 1)?;
        let stem = file.split('.').next().unwrap_or(file);
        (!stem.is_empty()).then(|| stem.to_string())
    }

    /// The first known map slug among this path's segments, when it is a `Maps/`
    /// path (`Maps/Shipping/Map11/...` → `"summoners-rift"`). `None` for a
    /// `Maps/` path whose number isn't a known map — the `map-skin` tag still
    /// applies, just without a specific slug.
    fn map_slug(&self) -> Option<&'static str> {
        let idx = self.category_index?;
        if !self.segments.get(idx)?.eq_ignore_ascii_case("maps") {
            return None;
        }
        map_slug_from_segments(&self.segments)
    }
}

/// The coarse tag implied by a WAD category root (`"champions"` →
/// `Tag::ChampionSkin`), falling back to `Tag::Misc` for unrecognized roots.
fn coarse_tag(category: &str) -> Tag {
    match category {
        "champions" => Tag::ChampionSkin,
        "maps" => Tag::MapSkin,
        "ux" | "ui" => Tag::Ui,
        "companions" => Tag::Companion,
        c if c.starts_with("tft") => Tag::Tft,
        _ => Tag::Misc,
    }
}

impl DerivedCategorization {
    /// Coarse classification from a mod's WAD footprint.
    ///
    /// Shared chunks are duplicated across WADs, so the overlay distributes a
    /// champion mod's overrides into map WADs too. Such spillover is a subset of
    /// the champion's chunks, so `counts` lets us keep a map only when it has
    /// *more* overrides than any champion WAD (a real map edit). Empty `counts`
    /// (the read-time fallback) suppresses maps whenever a champion is present.
    pub fn from_wad_footprint(affected_wads: &[String], counts: &HashMap<String, u32>) -> Self {
        let mut acc = CategoryAccumulator::default();
        let mut champion_max = 0;
        let mut map_max = 0;

        for wad in affected_wads {
            let path = WadPath::parse(wad);
            let Some(category) = path.category() else {
                continue;
            };
            let overrides = counts.get(wad).copied().unwrap_or(0);

            acc.add_tag(coarse_tag(&category));

            match category.as_str() {
                "champions" => {
                    champion_max = champion_max.max(overrides);
                    if let Some(name) = path.champion_name() {
                        // A floor of one, so the read-time fallback - which has
                        // no counts - still weighs every champion equally
                        // rather than weighing them all at nothing.
                        acc.add_champion(champion_display_name(&name), overrides.max(1));
                    }
                }
                "maps" => {
                    map_max = map_max.max(overrides);
                    if let Some(slug) = path.map_slug() {
                        acc.add_map(slug);
                    }
                }
                _ => {}
            }
        }

        // When a champion is present and no map WAD out-edits it, the map WADs
        // are base-chunk spillover, not a real map skin — drop them.
        if !acc.champions.is_empty() && champion_max >= map_max {
            acc.clear_maps();
            acc.remove_tag(Tag::MapSkin);
        }

        acc.finish()
    }
}

impl ModWadReport {
    /// Coarse classification from this report's WAD footprint, without per-WAD
    /// override counts — champion presence suppresses any map spillover.
    ///
    /// The read-time fallback for cache entries that predate precise
    /// classification (where counts weren't persisted). At analysis time,
    /// [`DerivedCategorization::from_wad_footprint`] is called directly with the
    /// upstream counts instead.
    pub fn derive_categorization(&self) -> DerivedCategorization {
        DerivedCategorization::from_wad_footprint(&self.affected_wads, &HashMap::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(wads: &[&str]) -> ModWadReport {
        ModWadReport {
            mod_id: "test".to_string(),
            affected_wads: wads.iter().map(|s| s.to_string()).collect(),
            wad_count: wads.len() as u32,
            override_count: 0,
            content_fingerprint: None,
            game_index_fingerprint: 0,
            computed_at: "2026-01-01T00:00:00Z".to_string(),
            is_stale: false,
            derived: DerivedCategorization::default(),
        }
    }

    fn derive_coarse(wads: &[&str]) -> DerivedCategorization {
        report(wads).derive_categorization()
    }

    fn derive_coarse_with_counts(wads: &[&str], counts: &[(&str, u32)]) -> DerivedCategorization {
        let counts: HashMap<String, u32> =
            counts.iter().map(|(w, c)| (w.to_string(), *c)).collect();
        DerivedCategorization::from_wad_footprint(&report(wads).affected_wads, &counts)
    }

    fn roster() -> ChampionRoster {
        ChampionRoster::from_internal_names(["Aatrox", "Ahri", "MonkeyKing", "Smolder"])
    }

    fn derive_precise(paths: &[&str]) -> DerivedCategorization {
        let paths: Vec<String> = paths.iter().map(|s| s.to_string()).collect();
        DerivedCategorization::from_chunk_paths(&paths, &roster())
    }

    // --- The primary champion ---

    /// Story: a Kayn skin spilling a few chunks into Shyvana and Rhaast is a
    /// Kayn skin, and the surface that shows one champion should show that one.
    #[test]
    fn precise_primary_champion_is_the_one_with_the_most_chunks() {
        let derived = derive_precise(&[
            "characters/aatrox/skins/skin01/x.bin",
            "characters/aatrox/skins/skin01/y.bin",
            "characters/aatrox/skins/skin01/z.bin",
            "characters/ahri/skins/skin01/x.bin",
        ]);

        assert_eq!(derived.primary_champion.as_deref(), Some("Aatrox"));
        assert_eq!(derived.champions, vec!["Aatrox", "Ahri"]);
    }

    #[test]
    fn coarse_primary_champion_is_the_one_with_the_most_overrides() {
        let derived = derive_coarse_with_counts(
            &[
                "DATA/FINAL/Champions/Aatrox.wad.client",
                "DATA/FINAL/Champions/Ahri.wad.client",
            ],
            &[
                ("DATA/FINAL/Champions/Aatrox.wad.client", 2),
                ("DATA/FINAL/Champions/Ahri.wad.client", 40),
            ],
        );

        assert_eq!(derived.primary_champion.as_deref(), Some("Ahri"));
    }

    /// The read-time fallback carries no counts, so every champion weighs the
    /// same and the pick has to be the same on every read rather than arbitrary.
    #[test]
    fn a_tie_resolves_to_the_first_champion_by_name() {
        let derived = derive_coarse(&[
            "DATA/FINAL/Champions/Ahri.wad.client",
            "DATA/FINAL/Champions/Aatrox.wad.client",
        ]);

        assert_eq!(derived.primary_champion.as_deref(), Some("Aatrox"));
    }

    #[test]
    fn a_mod_with_no_champions_names_none() {
        let derived = derive_precise(&["ux/summonericons/icon.dds"]);

        assert_eq!(derived.primary_champion, None);
    }

    // --- Coarse (WAD-footprint) path ---

    #[test]
    fn coarse_champion_skin() {
        let d = derive_coarse(&["DATA/FINAL/Champions/Aatrox.wad.client"]);
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn coarse_champion_name_override() {
        let d = derive_coarse(&["DATA/FINAL/Champions/MonkeyKing.wad.client"]);
        assert_eq!(d.champions, vec!["Wukong"]);
    }

    #[test]
    fn coarse_known_map_slug() {
        let d = derive_coarse(&["DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client"]);
        assert_eq!(d.maps, vec!["summoners-rift"]);
        assert_eq!(d.tags, vec!["map-skin"]);
        assert!(d.champions.is_empty());
    }

    #[test]
    fn coarse_unknown_map_emits_tag_but_no_slug() {
        let d = derive_coarse(&["DATA/FINAL/Maps/Shipping/Map99/Base/Map99.wad.client"]);
        assert_eq!(d.tags, vec!["map-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn coarse_top_level_ui_wad_maps_to_ui() {
        // A real fantome HUD mod's footprint is the top-level UI.wad.client file,
        // not a UX/ directory — the extension must be stripped to classify it.
        let d = derive_coarse(&["DATA/FINAL/UI.wad.client"]);
        assert_eq!(d.tags, vec!["ui"]);
    }

    #[test]
    fn coarse_companions_wad_maps_to_companion() {
        let d = derive_coarse(&["DATA/FINAL/Companions.wad.client"]);
        assert_eq!(d.tags, vec!["companion"]);
    }

    #[test]
    fn coarse_tft_wad_maps_to_tft() {
        let d = derive_coarse(&["DATA/FINAL/TFTSet10.wad.client"]);
        assert_eq!(d.tags, vec!["tft"]);
    }

    #[test]
    fn coarse_backslash_and_mixed_case() {
        let d = derive_coarse(&["data\\final\\champions\\Ahri.wad.client"]);
        assert_eq!(d.champions, vec!["Ahri"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
    }

    #[test]
    fn coarse_old_champions_does_not_false_positive() {
        let d = derive_coarse(&["DATA/FINAL/Old_Champions/Foo.wad.client"]);
        assert_eq!(d.tags, vec!["misc"]);
        assert!(d.champions.is_empty());
    }

    #[test]
    fn coarse_champion_suppresses_map_spillover() {
        // A base-skin fantome mod's footprint includes the map WADs its base
        // chunks spill into. The champion presence must suppress the false map.
        let d = derive_coarse(&[
            "DATA/FINAL/Champions/Aatrox.wad.client",
            "DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client",
            "DATA/FINAL/Maps/Shipping/Map12/Base/Map12.wad.client",
        ]);
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn coarse_base_spillover_suppressed_with_counts() {
        // The champion WAD holds 40 overrides; the map holds only the 8 base
        // chunks that spilled in. map_max < champion_max → suppress the map.
        let d = derive_coarse_with_counts(
            &[
                "DATA/FINAL/Champions/Aatrox.wad.client",
                "DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client",
            ],
            &[
                ("DATA/FINAL/Champions/Aatrox.wad.client", 40),
                ("DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client", 8),
            ],
        );
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert!(d.maps.is_empty());
        assert!(!d.tags.contains(&"map-skin".to_string()));
    }

    #[test]
    fn coarse_genuine_map_bundle_kept_with_counts() {
        // A real champion+map bundle: the map WAD holds 50 independent overrides,
        // far more than the champion's 2. map_max > champion_max → keep the map.
        let d = derive_coarse_with_counts(
            &[
                "DATA/FINAL/Champions/Aatrox.wad.client",
                "DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client",
            ],
            &[
                ("DATA/FINAL/Champions/Aatrox.wad.client", 2),
                ("DATA/FINAL/Maps/Shipping/Map11/Base/Map11.wad.client", 50),
            ],
        );
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert_eq!(d.maps, vec!["summoners-rift"]);
        assert!(d.tags.contains(&"champion-skin".to_string()));
        assert!(d.tags.contains(&"map-skin".to_string()));
    }

    #[test]
    fn coarse_empty_footprint() {
        assert_eq!(derive_coarse(&[]), DerivedCategorization::default());
    }

    // --- Precise (chunk-path) path ---

    #[test]
    fn precise_champion_skin_with_skin_id() {
        let d = derive_precise(&[
            "assets/characters/aatrox/skins/skin01/aatrox.skn",
            "data/characters/aatrox/skins/skin01.bin",
        ]);
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn precise_champion_name_override() {
        let d = derive_precise(&["assets/characters/monkeyking/skins/base/monkeyking.skn"]);
        assert_eq!(d.champions, vec!["Wukong"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
    }

    #[test]
    fn precise_base_particle_is_champion_not_map() {
        // The exact overlap that makes the coarse path emit a false `map-skin`:
        // a base particle lives in champion + every map WAD. By chunk path it is
        // unambiguously the champion.
        let d = derive_precise(&[
            "assets/characters/aatrox/skins/base/particles/aatrox_base_q_smokeerode.tex",
        ]);
        assert_eq!(d.champions, vec!["Aatrox"]);
        assert_eq!(d.tags, vec!["champion-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn precise_map_content() {
        let d = derive_precise(&[
            "assets/maps/particles/sr/foo.tex",
            "data/maps/shipping/map11/map11.bin",
            "levels/map11/scripts/foo.bin",
        ]);
        assert_eq!(d.maps, vec!["summoners-rift"]);
        assert_eq!(d.tags, vec!["map-skin"]);
        assert!(d.champions.is_empty());
    }

    #[test]
    fn precise_map_without_number_emits_tag_only() {
        let d = derive_precise(&["assets/maps/kitpieces/foo/bar.scb"]);
        assert_eq!(d.tags, vec!["map-skin"]);
        assert!(d.maps.is_empty());
    }

    #[test]
    fn precise_ward_skin_not_champion() {
        let d = derive_precise(&[
            "assets/characters/sightward/skins/skin01/sightward.skn",
            "assets/characters/jammerdevice/skins/base/jammerdevice.skn",
        ]);
        assert_eq!(d.tags, vec!["ward-skin"]);
        assert!(d.champions.is_empty());
    }

    #[test]
    fn precise_non_champion_summon_is_ignored() {
        // `annietibbers` is Annie's summon, not in the roster and not a ward —
        // emit nothing rather than a bogus champion.
        let d = derive_precise(&["assets/characters/annietibbers/skins/base/annietibbers.skn"]);
        assert!(d.is_empty());
    }

    #[test]
    fn precise_emote() {
        let d = derive_precise(&["assets/loadouts/summoneremotes/emote_poro/foo.dds"]);
        assert_eq!(d.tags, vec!["emote"]);
    }

    #[test]
    fn precise_summoner_icon() {
        let d = derive_precise(&["assets/ux/summonericons/icon123.dds"]);
        assert_eq!(d.tags, vec!["summoner-icon"]);
    }

    #[test]
    fn precise_companion() {
        let d = derive_precise(&["loadouts/companions/pengu/pengu.bin"]);
        assert_eq!(d.tags, vec!["companion"]);
    }

    #[test]
    fn precise_tft() {
        let d = derive_precise(&[
            "assets/loadouts/tftdamageskins/foo.dds",
            "assets/ux/tft/bar.dds",
        ]);
        assert_eq!(d.tags, vec!["tft"]);
    }

    #[test]
    fn precise_generic_ux_is_ui() {
        let d = derive_precise(&["assets/ux/hud/foo.dds"]);
        assert_eq!(d.tags, vec!["ui"]);
    }

    #[test]
    fn precise_unclassified_is_empty() {
        // Unrecognized content yields nothing so the caller defers to the coarse
        // footprint, rather than overwriting it with a `misc` tag.
        let d = derive_precise(&["assets/sounds/foo/bar.bnk"]);
        assert!(d.is_empty());
    }

    #[test]
    fn precise_empty_input_is_empty() {
        assert!(derive_precise(&[]).is_empty());
    }

    #[test]
    fn precise_multi_content_mix() {
        let d = derive_precise(&[
            "assets/characters/aatrox/skins/skin01/aatrox.skn",
            "assets/characters/ahri/skins/skin02/ahri.skn",
            "assets/ux/summonericons/icon1.dds",
        ]);
        assert_eq!(d.champions, vec!["Aatrox", "Ahri"]);
        assert_eq!(d.tags, vec!["champion-skin", "summoner-icon"]);
    }

    #[test]
    fn precise_unknown_champion_is_ignored() {
        // A champion released after the roster was built isn't a false negative
        // disaster — it's simply not emitted (coarse footprint still catches it).
        let d = derive_precise(&["assets/characters/somenewchamp/skins/base/x.skn"]);
        assert!(d.is_empty());
    }

    #[test]
    fn roster_collapses_localized_variants() {
        let r = ChampionRoster::from_internal_names(["Aatrox", "Aatrox", "MonkeyKing"]);
        assert_eq!(r.lookup("aatrox"), Some("Aatrox"));
        assert_eq!(r.lookup("MonkeyKing"), Some("Wukong"));
        assert_eq!(r.lookup("nope"), None);
    }

    #[test]
    fn normalized_dedup_collapses_punctuation_variants() {
        let mut set = BTreeSet::new();
        set.insert("Kai'Sa".to_string());
        set.insert("KaiSa".to_string());
        assert_eq!(dedup_normalized(set).len(), 1);
    }
}
