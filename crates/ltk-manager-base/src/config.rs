//! Core application configuration.
//!
//! [`Config`] holds the patching-relevant settings shared by every frontend.
//! UI preferences (theme, tray behavior, hotkeys, …) live in the Tauri shell's
//! `Settings`, which embeds this struct via `#[serde(flatten)]` so everything
//! persists to a single `settings.json`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

fn default_true() -> bool {
    true
}

fn default_wad_blocklist() -> Vec<WadBlocklistEntry> {
    vec![]
}

fn default_keep_incidents() -> u32 {
    50
}

/// A single entry in the WAD blocklist.
///
/// `Exact` matches a literal filename (case-insensitively). `Regex` matches
/// against every WAD filename in the game install; the pattern is always
/// applied case-insensitively.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WadBlocklistEntry {
    Exact { value: String },
    Regex { value: String },
}

/// Accepts both the legacy `["Name.wad.client", ...]` format and the new
/// tagged `[{ "kind": "exact", "value": "..." }, ...]` format. Legacy strings
/// are migrated to `Exact` entries.
fn deserialize_wad_blocklist<'de, D>(deserializer: D) -> Result<Vec<WadBlocklistEntry>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawEntry {
        Legacy(String),
        Tagged(WadBlocklistEntry),
    }

    let raw: Vec<RawEntry> = Vec::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .map(|entry| match entry {
            RawEntry::Legacy(value) => WadBlocklistEntry::Exact { value },
            RawEntry::Tagged(entry) => entry,
        })
        .collect())
}

/// Patching-relevant configuration: everything the mod library, overlay
/// builder, and patcher need, and nothing UI-specific.
///
/// Every field is optional or defaulted so a partial (or empty) JSON document
/// deserializes into a usable configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub league_path: Option<PathBuf>,
    pub mod_storage_path: Option<PathBuf>,
    /// Directory where mod projects are stored (for Creator Workshop).
    pub workshop_path: Option<PathBuf>,
    /// Whether to patch TFT game files (Map22.wad.client). Default: false.
    #[serde(default)]
    pub patch_tft: bool,
    /// Whether to block mods from patching Scripts.wad.client. Default: true.
    #[serde(default = "default_true")]
    pub block_scripts_wad: bool,
    /// Additional WAD files to exclude from overlay building.
    #[serde(
        default = "default_wad_blocklist",
        deserialize_with = "deserialize_wad_blocklist"
    )]
    #[cfg_attr(feature = "ts", specta(type = Vec<WadBlocklistEntry>))]
    pub wad_blocklist: Vec<WadBlocklistEntry>,
    /// Whether to automatically categorize mods from their content (champions,
    /// maps and content tags derived from the WAD/chunk footprint, surfaced as
    /// "auto" suggestions and library filters). When off, only the categories
    /// the user sets themselves are used. Default: true.
    #[serde(default = "default_true")]
    pub auto_categorization_enabled: bool,
    /// Whether the library sweep checks mod health at startup, after a hashtable
    /// sync and after an install. A check the user starts runs either way.
    /// Default: true.
    #[serde(default = "default_true")]
    pub auto_health_check_enabled: bool,
    /// Enabling a mod moves it to the front of its folder. Off by default.
    #[serde(default)]
    pub promote_enabled_mods: bool,
    /// Whether mods' string overrides are applied to every installed locale
    /// instead of only the locale the League client is configured to use.
    /// Default: false (current locale only).
    #[serde(default)]
    pub apply_string_overrides_to_all_locales: bool,
    /// Raise the injection host's log level from `Info` to `Debug`. The host and
    /// the injected DLL decide their own verbosity from this, so it is the only
    /// way to get their diagnostics out of a release build - `RUST_LOG` only
    /// affects the manager's own tracing. Read at patcher start, so a change
    /// takes effect on the next start. Default: false.
    #[serde(default)]
    pub verbose_patcher_logging: bool,
    /// Whether the patcher runs builds from the beta delivery channel instead of
    /// the stable channel. Default: false.
    #[serde(default)]
    pub beta_patcher: bool,
    /// Whether to set the `FULL_WAD_SCAN` hook flag, which scans every archive
    /// up front instead of the DLL's default of verifying each one as the game
    /// loads it. The overlay makes lazy scanning crash-prone, so the DLL only
    /// scans lazily when the game has crash reporting disabled, which is what
    /// [`Self::disable_crash_reporting`] is for - with crash reporting on, the
    /// up-front scan happens either way and this flag changes nothing.
    /// Default: false.
    #[serde(default)]
    pub full_wad_scan: bool,
    /// Whether to turn the League client's crash reporting off when the
    /// patcher starts, by clearing `install.crash_reporting.enabled` in its
    /// `LeagueClientSettings.yaml`.
    ///
    /// The DLL verifies archives as the game loads them only while crash
    /// reporting is off, so leaving it on costs every session the up-front
    /// scan of every archive. The client rewrites its settings when it exits,
    /// which is why the patcher applies this at every start rather than once.
    /// Default: true.
    #[serde(default = "default_true")]
    pub disable_crash_reporting: bool,
    /// Whether to hide the Riot Client's window once the game is up. Nobody
    /// launching through the manager wants the launcher left sitting on their
    /// desktop behind the game, so this is on by default.
    ///
    /// Hides to the tray; the client keeps running because the game needs it for
    /// the whole session, and it stays hidden after the game exits. That last
    /// part takes active work: the client un-hides *itself* on exit, through the
    /// `showUxIfHidden` flag on Foundation's UX command bus, so
    /// `hide_for_play_session` re-asserts the hide. Reversible from the tray
    /// icon at any point. Default: true.
    #[serde(default = "default_true")]
    pub hide_riot_client_on_launch: bool,
    /// Whether to read League's own game log after a game ends, for the
    /// verdict on a game that went wrong. Turns the reader off. An incident
    /// still records the ending, the game's boundaries and what the DLL said,
    /// and with this off the manager opens nothing under the League install.
    /// Default: true.
    #[serde(default = "default_true")]
    pub read_game_log: bool,
    /// How many incidents the app data directory keeps, under 1MB together.
    /// The oldest goes first, and a dismissed one before an undismissed one
    /// of the same age. Default: 50.
    #[serde(default = "default_keep_incidents")]
    pub keep_incidents: u32,
    /// Which built-in mods the overlay injects above every other mod.
    #[serde(default)]
    pub builtin_mods: BuiltinModSettings,
    /// The tools that audio editing runs.
    #[serde(default)]
    pub audio: AudioSettings,
}

/// The tools that audio editing runs, none by default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct AudioSettings {
    /// `WwiseConsole.exe` of a Wwise install, which converts a `.wav`, `.ogg` or `.flac` into a
    /// Vorbis WEM. Default: none, and a replacement then takes a `.wem` only.
    pub wwise_console_path: Option<PathBuf>,
}

/// The built-in mods a user turned on, every one off by default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct BuiltinModSettings {
    /// Every ward shows its own base skin.
    pub default_ward_skins: bool,
    /// Which champions show their base skin on every skin.
    pub base_skins: BaseSkinsScope,
    /// Which map skin every game shows.
    pub map_skin: MapSkinMode,
    /// The `name` of the map skin [`MapSkinMode::Forced`] shows, kept while another mode is on.
    pub forced_map_skin: String,
    /// What each map decoration does, by the mutator that switches it. One absent follows the
    /// game.
    pub map_decorations: BTreeMap<String, MapDecorationMode>,
    /// Character inking: which champions get an outline, on which maps, and how it looks.
    pub character_inking: CharacterInking,
    /// Custom loading screen background.
    pub loading_screen: LoadingScreenSettings,
}

/// The settings of the custom loading screen background built-in mod.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct LoadingScreenSettings {
    /// Whether the mod runs.
    pub enabled: bool,
    /// Path to the custom loading screen image or video.
    pub assets: Option<PathBuf>,
}

/// The settings of the character inking built-in mod.
///
/// Every value is an integer, so the struct keeps `Eq`. A number out of its documented range is
/// clamped when the material is built, so an edited `settings.json` still loads. A color that is
/// not `#rrggbb` reads as its default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CharacterInking {
    /// Whether the mod runs.
    pub enabled: bool,
    /// Which champions get an outline.
    pub scope: InkingScope,
    /// Lowercased champion names, as the champion archives are named, for
    /// [`InkingScope::Chosen`].
    pub chosen_champions: BTreeSet<String>,
    /// Whether lane minions get an outline.
    pub minions: bool,
    /// Whether turrets, inhibitors and nexuses get an outline.
    pub structures: bool,
    /// Which maps draw the outline.
    pub maps: InkingMaps,
    /// Lowercased map names such as `map11`, for [`InkingMaps::Chosen`].
    pub chosen_maps: BTreeSet<String>,
    /// One color, or one per team.
    pub color_mode: InkingColorMode,
    /// The color of [`InkingColorMode::Single`].
    pub color: Rgb8,
    /// The ally color of [`InkingColorMode::Team`].
    pub ally_color: Rgb8,
    /// The enemy color of [`InkingColorMode::Team`].
    pub enemy_color: Rgb8,
    /// `Outline_Width` in tenths of a world unit, 10 to 150.
    pub width: u16,
    /// `Outline_FinalAlphaMult` in percent, 10 to 100.
    pub opacity: u8,
    /// `Outline_CameraDistanceMod` in world units, 1000 to 9000.
    pub camera_distance: u16,
    /// How long the outline takes to fade out when a champion dies, in milliseconds, 0 to 2000.
    pub death_fade: u16,
}

impl Default for CharacterInking {
    /// The Original preset, with the mod off.
    fn default() -> Self {
        Self {
            enabled: false,
            scope: InkingScope::default(),
            chosen_champions: BTreeSet::new(),
            minions: false,
            structures: false,
            maps: InkingMaps::default(),
            chosen_maps: BTreeSet::new(),
            color_mode: InkingColorMode::default(),
            color: Rgb8::from_u32(0x000000),
            ally_color: Rgb8::from_u32(0x3399ff),
            enemy_color: Rgb8::from_u32(0xff3333),
            width: 50,
            opacity: 100,
            camera_distance: 4500,
            death_fade: 500,
        }
    }
}

/// Which champions character inking draws an outline around.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum InkingScope {
    /// Every champion.
    #[default]
    All,
    /// Each champion an enabled mod gives a new base skin.
    Modded,
    /// The champions in `chosenChampions`.
    Chosen,
}

/// Which maps character inking draws the outline on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum InkingMaps {
    /// Every map but TFT's.
    #[default]
    All,
    /// `Map11`, Summoner's Rift.
    SummonersRift,
    /// The maps in `chosenMaps`.
    Chosen,
}

/// Whether the outline has one color or one per team.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum InkingColorMode {
    /// One color for every champion.
    #[default]
    Single,
    /// One color for allies and the player's champion, and one for enemies.
    Team,
}

/// An sRGB color with 8 bits per channel, written as `#rrggbb`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", specta(transparent))]
#[serde(try_from = "String", into = "String")]
pub struct Rgb8(#[cfg_attr(feature = "ts", specta(type = String))] pub [u8; 3]);

impl Rgb8 {
    /// The color whose `#rrggbb` form is the low 24 bits of `rgb`.
    #[must_use]
    pub const fn from_u32(rgb: u32) -> Self {
        let [_, r, g, b] = rgb.to_be_bytes();
        Self([r, g, b])
    }
}

/// The error of a color that is not `#` and six hexadecimal digits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseRgb8Error(String);

impl fmt::Display for ParseRgb8Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "`{}` is not a color of the form #rrggbb", self.0)
    }
}

impl std::error::Error for ParseRgb8Error {}

impl FromStr for Rgb8 {
    type Err = ParseRgb8Error;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let error = || ParseRgb8Error(text.to_owned());
        let digits = text.strip_prefix('#').ok_or_else(error)?;
        if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(error());
        }

        let rgb = u32::from_str_radix(digits, 16).map_err(|_| error())?;
        Ok(Self::from_u32(rgb))
    }
}

impl fmt::Display for Rgb8 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [r, g, b] = self.0;
        write!(f, "#{r:02x}{g:02x}{b:02x}")
    }
}

impl TryFrom<String> for Rgb8 {
    type Error = ParseRgb8Error;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        text.parse()
    }
}

impl From<Rgb8> for String {
    fn from(color: Rgb8) -> Self {
        color.to_string()
    }
}

/// A color as `settings.json` holds it, `None` if the value is not `#rrggbb`.
#[derive(Debug, Default)]
struct LenientColor(Option<Rgb8>);

impl<'de> Deserialize<'de> for LenientColor {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Text(String),
            Other(serde::de::IgnoredAny),
        }

        Ok(Self(match Raw::deserialize(deserializer)? {
            Raw::Text(text) => text.parse().ok(),
            Raw::Other(_) => None,
        }))
    }
}

/// [`CharacterInking`] as `settings.json` holds it, each color read leniently.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredInking {
    enabled: bool,
    scope: InkingScope,
    chosen_champions: BTreeSet<String>,
    minions: bool,
    structures: bool,
    maps: InkingMaps,
    chosen_maps: BTreeSet<String>,
    color_mode: InkingColorMode,
    color: LenientColor,
    ally_color: LenientColor,
    enemy_color: LenientColor,
    width: u16,
    opacity: u8,
    camera_distance: u16,
    death_fade: u16,
}

impl Default for StoredInking {
    fn default() -> Self {
        let defaults = CharacterInking::default();
        Self {
            enabled: defaults.enabled,
            scope: defaults.scope,
            chosen_champions: defaults.chosen_champions,
            minions: defaults.minions,
            structures: defaults.structures,
            maps: defaults.maps,
            chosen_maps: defaults.chosen_maps,
            color_mode: defaults.color_mode,
            color: LenientColor::default(),
            ally_color: LenientColor::default(),
            enemy_color: LenientColor::default(),
            width: defaults.width,
            opacity: defaults.opacity,
            camera_distance: defaults.camera_distance,
            death_fade: defaults.death_fade,
        }
    }
}

impl<'de> Deserialize<'de> for CharacterInking {
    /// Reads the settings with each missing field at its default, and a color that is not
    /// `#rrggbb` at its default too, so one bad color does not fail the whole settings file.
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let stored = StoredInking::deserialize(deserializer)?;
        let defaults = Self::default();
        Ok(Self {
            enabled: stored.enabled,
            scope: stored.scope,
            chosen_champions: stored.chosen_champions,
            minions: stored.minions,
            structures: stored.structures,
            maps: stored.maps,
            chosen_maps: stored.chosen_maps,
            color_mode: stored.color_mode,
            color: stored.color.0.unwrap_or(defaults.color),
            ally_color: stored.ally_color.0.unwrap_or(defaults.ally_color),
            enemy_color: stored.enemy_color.0.unwrap_or(defaults.enemy_color),
            width: stored.width,
            opacity: stored.opacity,
            camera_distance: stored.camera_distance,
            death_fade: stored.death_fade,
        })
    }
}

/// What a map decoration a mutator switches does, whatever mutators the game applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum MapDecorationMode {
    /// Never drawn.
    Hide,
    /// Drawn in every game.
    Show,
}

/// Which map skin every game shows, whatever skin the server names.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum MapSkinMode {
    /// The skin the server names.
    #[default]
    Game,
    /// The map's `Default` skin.
    Classic,
    /// The skin named by `forcedMapSkin`.
    Forced,
}

/// Which champions show their base skin on every skin, a mod's where one replaces it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum BaseSkinsScope {
    /// Every champion keeps its skins.
    #[default]
    Off,
    /// Each champion an enabled mod gives a new base skin.
    ModdedChampions,
    /// Every champion.
    AllChampions,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            league_path: None,
            mod_storage_path: None,
            workshop_path: None,
            patch_tft: false,
            block_scripts_wad: true,
            wad_blocklist: default_wad_blocklist(),
            auto_categorization_enabled: true,
            auto_health_check_enabled: true,
            promote_enabled_mods: false,
            apply_string_overrides_to_all_locales: false,
            verbose_patcher_logging: false,
            beta_patcher: false,
            full_wad_scan: false,
            disable_crash_reporting: true,
            hide_riot_client_on_launch: true,
            read_game_log: true,
            keep_incidents: default_keep_incidents(),
            builtin_mods: BuiltinModSettings::default(),
            audio: AudioSettings::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default_values() {
        let config = Config::default();
        assert!(config.league_path.is_none());
        assert!(config.mod_storage_path.is_none());
        assert!(config.workshop_path.is_none());
        assert!(!config.patch_tft);
        assert!(config.block_scripts_wad);
        assert!(config.wad_blocklist.is_empty());
        assert!(config.auto_categorization_enabled);
        assert!(!config.promote_enabled_mods);
        assert!(!config.apply_string_overrides_to_all_locales);
        assert!(!config.verbose_patcher_logging);
        assert!(!config.beta_patcher);
        assert!(!config.full_wad_scan);
        assert!(config.disable_crash_reporting);
        assert!(config.hide_riot_client_on_launch);
        assert!(config.read_game_log);
        assert_eq!(config.keep_incidents, 50);
        assert_eq!(config.builtin_mods, BuiltinModSettings::default());
    }

    /// A built-in mod reads from its group, and an empty group reads as off.
    #[test]
    fn a_built_in_mod_reads_from_its_group() {
        let config: Config =
            serde_json::from_str(r#"{ "builtinMods": { "defaultWardSkins": true } }"#).unwrap();
        assert!(config.builtin_mods.default_ward_skins);

        let config: Config = serde_json::from_str(r#"{ "builtinMods": {} }"#).unwrap();
        assert!(!config.builtin_mods.default_ward_skins);
        assert_eq!(config.builtin_mods.base_skins, BaseSkinsScope::Off);
        assert_eq!(config.builtin_mods.map_skin, MapSkinMode::Game);

        let config: Config =
            serde_json::from_str(r#"{ "builtinMods": { "baseSkins": "allChampions" } }"#).unwrap();
        assert_eq!(config.builtin_mods.base_skins, BaseSkinsScope::AllChampions);

        let config: Config = serde_json::from_str(
            r#"{ "builtinMods": { "mapSkin": "forced", "forcedMapSkin": "Sodapop_SRS" } }"#,
        )
        .unwrap();
        assert_eq!(config.builtin_mods.map_skin, MapSkinMode::Forced);
        assert_eq!(config.builtin_mods.forced_map_skin, "Sodapop_SRS");

        let config: Config = serde_json::from_str(
            r#"{ "builtinMods": { "mapDecorations": { "SR_Hall_Of_Legends": "hide" } } }"#,
        )
        .unwrap();
        assert_eq!(
            config
                .builtin_mods
                .map_decorations
                .get("SR_Hall_Of_Legends"),
            Some(&MapDecorationMode::Hide)
        );
    }

    #[test]
    fn character_inking_reads_off_from_an_empty_group() {
        let config: Config = serde_json::from_str(r#"{ "builtinMods": {} }"#).unwrap();
        assert_eq!(
            config.builtin_mods.character_inking,
            CharacterInking::default()
        );

        let inking: CharacterInking = serde_json::from_str("{}").unwrap();
        assert!(!inking.enabled);
        assert_eq!(inking.scope, InkingScope::All);
        assert_eq!(inking.maps, InkingMaps::All);
        assert_eq!(inking.color_mode, InkingColorMode::Single);
        assert_eq!(inking.color, Rgb8([0, 0, 0]));
        assert_eq!(
            (inking.width, inking.opacity, inking.camera_distance),
            (50, 100, 4500)
        );
        assert_eq!(inking.death_fade, 500);
    }

    #[test]
    fn character_inking_round_trips_through_json() {
        let inking = CharacterInking {
            enabled: true,
            scope: InkingScope::Chosen,
            chosen_champions: BTreeSet::from(["ahri".to_owned()]),
            maps: InkingMaps::SummonersRift,
            color_mode: InkingColorMode::Team,
            color: Rgb8([0x1a, 0x2b, 0x3c]),
            ..CharacterInking::default()
        };

        let json = serde_json::to_value(&inking).unwrap();
        assert_eq!(json["color"], "#1a2b3c");
        assert_eq!(json["maps"], "summonersRift");
        assert_eq!(json["colorMode"], "team");
        assert_eq!(
            serde_json::from_value::<CharacterInking>(json).unwrap(),
            inking
        );
    }

    #[test]
    fn rgb8_parses_only_hash_and_six_hex_digits() {
        assert_eq!("#1a2b3c".parse(), Ok(Rgb8([0x1a, 0x2b, 0x3c])));
        assert_eq!("#FFAA00".parse(), Ok(Rgb8([0xff, 0xaa, 0x00])));
        assert_eq!(Rgb8([0x1a, 0x2b, 0x3c]).to_string(), "#1a2b3c");
        for bad in ["#12345", "red", "#gg0000", "1a2b3c", "#1a2b3c4d", ""] {
            assert!(bad.parse::<Rgb8>().is_err(), "{bad} parsed");
        }
    }

    #[test]
    fn character_inking_falls_back_per_color_when_a_color_is_bad() {
        let inking: CharacterInking = serde_json::from_str(
            r##"{ "enabled": true, "color": "red", "allyColor": 7, "enemyColor": "#00ff00" }"##,
        )
        .unwrap();
        assert!(inking.enabled);
        assert_eq!(inking.color, Rgb8([0, 0, 0]));
        assert_eq!(inking.ally_color, Rgb8([0x33, 0x99, 0xff]));
        assert_eq!(inking.enemy_color, Rgb8([0, 0xff, 0]));
    }

    /// A config written before the retention setting was removed still carries
    /// the key, so it has to parse as the noise it now is.
    #[test]
    fn a_config_with_the_removed_retention_key_still_parses() {
        let config: Config = serde_json::from_str(r#"{ "retainModArchives": false }"#).unwrap();
        assert!(config.league_path.is_none());
    }

    #[test]
    fn config_deserializes_from_empty_object() {
        let config: Config = serde_json::from_str("{}").unwrap();
        assert!(config.league_path.is_none());
        assert!(config.block_scripts_wad);
    }

    /// Settings files written before this flag existed have to come back on,
    /// not off - a missing key is an old install, not a user who said no.
    #[test]
    fn hiding_the_riot_client_defaults_on_for_settings_written_before_it_existed() {
        let config: Config = serde_json::from_str(r#"{ "patchTft": true }"#).unwrap();
        assert!(config.hide_riot_client_on_launch);
    }

    #[test]
    fn hiding_the_riot_client_can_be_turned_off() {
        let config: Config =
            serde_json::from_str(r#"{ "hideRiotClientOnLaunch": false }"#).unwrap();
        assert!(!config.hide_riot_client_on_launch);
    }

    /// The reader is on for an install whose settings predate it, and a user
    /// who turned it off stays off.
    #[test]
    fn reading_the_game_log_defaults_on_and_can_be_turned_off() {
        let config: Config = serde_json::from_str(r#"{ "patchTft": true }"#).unwrap();
        assert!(config.read_game_log);
        assert_eq!(config.keep_incidents, 50);

        let config: Config =
            serde_json::from_str(r#"{ "readGameLog": false, "keepIncidents": 10 }"#).unwrap();
        assert!(!config.read_game_log);
        assert_eq!(config.keep_incidents, 10);
    }

    #[test]
    fn wad_blocklist_accepts_legacy_string_array() {
        let json = r#"{
            "wadBlocklist": ["Map12.wad.client", "Aatrox.wad.client"]
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.wad_blocklist.len(), 2);
        assert_eq!(
            config.wad_blocklist[0],
            WadBlocklistEntry::Exact {
                value: "Map12.wad.client".to_string()
            }
        );
        assert_eq!(
            config.wad_blocklist[1],
            WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string()
            }
        );
    }

    #[test]
    fn wad_blocklist_accepts_tagged_entries() {
        let json = r#"{
            "wadBlocklist": [
                { "kind": "exact", "value": "Map12.wad.client" },
                { "kind": "regex", "value": "^map\\d+\\.en_us\\.wad\\.client$" }
            ]
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.wad_blocklist.len(), 2);
        assert!(matches!(
            config.wad_blocklist[0],
            WadBlocklistEntry::Exact { .. }
        ));
        assert!(matches!(
            config.wad_blocklist[1],
            WadBlocklistEntry::Regex { .. }
        ));
    }

    #[test]
    fn wad_blocklist_mixed_legacy_and_tagged() {
        let json = r#"{
            "wadBlocklist": [
                "Legacy.wad.client",
                { "kind": "regex", "value": "^tft" }
            ]
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.wad_blocklist.len(), 2);
        assert_eq!(
            config.wad_blocklist[0],
            WadBlocklistEntry::Exact {
                value: "Legacy.wad.client".to_string()
            }
        );
        assert_eq!(
            config.wad_blocklist[1],
            WadBlocklistEntry::Regex {
                value: "^tft".to_string()
            }
        );
    }

    #[test]
    fn wad_blocklist_serializes_as_tagged() {
        let entries = vec![
            WadBlocklistEntry::Exact {
                value: "foo.wad.client".to_string(),
            },
            WadBlocklistEntry::Regex {
                value: "bar".to_string(),
            },
        ];
        let json = serde_json::to_value(&entries).unwrap();
        assert_eq!(json[0]["kind"], "exact");
        assert_eq!(json[0]["value"], "foo.wad.client");
        assert_eq!(json[1]["kind"], "regex");
        assert_eq!(json[1]["value"], "bar");
    }
}
