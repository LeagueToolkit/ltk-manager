//! The phrases the injection host and the DLL write, as the manager reads them.
//!
//! A phrase is a contract between two repositories. Each constant names the
//! `ltk-patcher` source file that writes it, so a rename upstream is found here
//! and not as a silent verdict of Unmodded. [`DllLine::parse`] turns one DLL
//! record into what it says about the game.

use crate::diagnostics::incident::LaunchKind;

use super::injector::WadScanFailure;

/// The host's `status` messages. Written by `crates/ltk_patcher_host/src/worker.rs`.
pub mod host_status {
    /// `status injecting scanning for game`. The session started, or the last
    /// game's window went away.
    pub const SCANNING_FOR_GAME: &str = "scanning for game";
    /// `status injecting game found`. The host hooked the game's thread.
    pub const GAME_FOUND: &str = "game found";
    /// `status injected dll attached`. The DLL read the host's config and acked
    /// with its pid.
    pub const DLL_ATTACHED: &str = "dll attached";
    /// `status waiting game exit`. The hook is removed, and the host waits.
    pub const GAME_EXIT: &str = "game exit";
    /// `status exited dll detached`. The pipe closed, which is the process ending.
    pub const DLL_DETACHED: &str = "dll detached";
}

/// The overlay is live. Written by `crates/ltk_patcher_dll/src/entry/mod.rs`.
pub const INIT_DONE: &str = "init done";
/// League started before the scan, and the DLL stays inert. Written by
/// `crates/ltk_patcher_dll/src/entry/mod.rs`.
pub const JOINED_TOO_LATE: &str = "joined too late, not overlaying";
/// Followed by the game's build timestamp as `0x..`. Written by
/// `crates/ltk_patcher_dll/src/entry/mod.rs`.
pub const END_OF_LIFE: &str = "end of life reached, please update: ";
/// `failed to install integrity hook` and `failed to install overlay hook`.
/// Written by `crates/ltk_patcher_dll/src/entry/mod.rs`.
pub const HOOK_FAILED_PREFIX: &str = "failed to install ";
/// The tail of a hook failure, after the hook's name.
pub const HOOK_FAILED_SUFFIX: &str = " hook";
/// Followed by `wad <name>: <why>`. The eager scan fails closed on the first
/// bad archive. Written by `crates/ltk_patcher_dll/src/verify/mod.rs`.
pub const OVERLAY_DISABLED: &str = "overlay verification failed, disabling overlay: ";
/// Followed by `wad <name>: <why>`. The lazy scan fails open for one archive.
/// Written by `crates/ltk_patcher_dll/src/verify/mod.rs`.
pub const WAD_SKIPPED: &str = "lazy verification failed, not overlaying: ";
/// `WAD scan failed status with <status> for <champion>.wad.client`. Written by
/// `crates/ltk_patcher_dll/src/verify/mod.rs`, which names this phrase as a
/// contract with [`parse_wad_scan_failure`].
pub const WAD_SCAN_FAILED: &str = "WAD scan failed";
/// Followed by the game's request path. Written by
/// `crates/ltk_patcher_dll/src/hooks/fsov/imp_windows_iat.rs` and
/// `imp_windows_strconv.rs`.
pub const REDIRECTED: &str = "redirected wad: ";
/// `<kind> launch; anti-hack scan will not block`. Written by
/// `crates/ltk_patcher_dll/src/verify/mod.rs`.
pub const LAUNCH_SUFFIX: &str = " launch; anti-hack scan will not block";
/// The kind before [`LAUNCH_SUFFIX`] for a spectator launch.
pub const LAUNCH_SPECTATOR: &str = "spectator";
/// The kind before [`LAUNCH_SUFFIX`] for a replay launch.
pub const LAUNCH_REPLAY: &str = "replay (.rofl)";
/// The kind before [`LAUNCH_SUFFIX`] for a PBE launch.
pub const LAUNCH_PBE: &str = "PBE";

/// The level the DLL wrote one record at.
///
/// The host forwards it as its own column of the `dll` event, spelled the way
/// `tracing` renders it, so a reader takes the level from there instead of
/// matching a prefix inside the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DllLevel {
    /// The DLL failed at something. The only level a blocking record carries.
    Error,
    /// Something the DLL noted and carried on from, an opted-out scan included.
    Warn,
    /// Anything quieter, which no verdict rests on.
    Other,
}

impl DllLevel {
    /// The level a `dll` event named, or [`Other`](Self::Other) for the rest.
    ///
    /// Case-insensitive: the host writes `ERROR`, and older builds wrote the
    /// level into the message as `error: `.
    pub fn parse(level: &str) -> Self {
        if level.eq_ignore_ascii_case("error") {
            Self::Error
        } else if level.eq_ignore_ascii_case("warn") {
            Self::Warn
        } else {
            Self::Other
        }
    }
}

/// What one DLL record says about the game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DllLine {
    /// The overlay is live.
    InitDone,
    /// League started before the scan, and the DLL stays inert.
    JoinedTooLate,
    /// The DLL refused a game build newer than it knows.
    EndOfLife {
        /// The game's build timestamp, as the DLL printed it.
        build: String,
    },
    /// The eager scan failed closed, and every mod is off for this game.
    OverlayDisabled { wad: String, why: String },
    /// The lazy scan skipped one archive, and the game ran without it.
    WadSkipped { wad: String, why: String },
    /// A hook did not take.
    HookFailed {
        /// `integrity` or `overlay`.
        hook: String,
    },
    /// The overlay hook served an archive, named by its last path segment.
    Redirected { wad: String },
    /// The anti-hack scan reported on an archive.
    ///
    /// Carries nothing: what the scan said is read by
    /// [`parse_wad_scan_failure`], which collects the failures as a set. This
    /// variant exists so a scan record is not mistaken for one the manager
    /// keeps no line from.
    ScanFailed,
    /// A game where the scan does not block.
    Launch(LaunchKind),
}

impl DllLine {
    /// Reads one DLL record, with or without its `<target>: ` prefix.
    ///
    /// `None` for a record that says nothing the manager keeps. The level is
    /// not consulted: every phrase here names its own kind, and whether a scan
    /// record blocked is [`parse_wad_scan_failure`]'s question.
    pub fn parse(message: &str) -> Option<Self> {
        if message.contains(WAD_SCAN_FAILED) {
            return Some(Self::ScanFailed);
        }

        let text = strip_target(message).trim();
        if text == INIT_DONE {
            return Some(Self::InitDone);
        }
        if text == JOINED_TOO_LATE {
            return Some(Self::JoinedTooLate);
        }
        if let Some(build) = text.strip_prefix(END_OF_LIFE) {
            return Some(Self::EndOfLife {
                build: build.trim().to_string(),
            });
        }
        if let Some(hook) = text
            .strip_prefix(HOOK_FAILED_PREFIX)
            .and_then(|rest| rest.strip_suffix(HOOK_FAILED_SUFFIX))
        {
            return Some(Self::HookFailed {
                hook: hook.to_string(),
            });
        }
        if let Some(rest) = text.strip_prefix(OVERLAY_DISABLED) {
            let (wad, why) = split_wad_and_why(rest);
            return Some(Self::OverlayDisabled { wad, why });
        }
        if let Some(rest) = text.strip_prefix(WAD_SKIPPED) {
            let (wad, why) = split_wad_and_why(rest);
            return Some(Self::WadSkipped { wad, why });
        }
        if let Some(path) = text.strip_prefix(REDIRECTED) {
            return Some(Self::Redirected {
                wad: last_segment(path).to_string(),
            });
        }
        if let Some(kind) = text.strip_suffix(LAUNCH_SUFFIX) {
            let kind = match kind.trim() {
                LAUNCH_SPECTATOR => LaunchKind::Spectator,
                LAUNCH_REPLAY => LaunchKind::Replay,
                LAUNCH_PBE => LaunchKind::Pbe,
                _ => return None,
            };
            return Some(Self::Launch(kind));
        }
        None
    }
}

/// The record after its `tracing` target.
///
/// The DLL writes `<target>: <message>` with a Rust module path as the target.
/// Older builds wrote the level there instead (`error: ...`), which reads the
/// same way. A message whose first `: ` follows anything else is returned whole.
pub fn strip_target(message: &str) -> &str {
    let message = message.trim_start();
    match message.split_once(": ") {
        Some((prefix, rest)) if looks_like_target(prefix) => rest,
        _ => message,
    }
}

fn looks_like_target(prefix: &str) -> bool {
    !prefix.is_empty()
        && prefix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':')
}

/// The last segment of a request path, whichever separator the game used.
fn last_segment(path: &str) -> &str {
    let path = path.trim();
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// `wad <name>: <why>` into the archive's last segment and the reason. The
/// one message without a colon, `wad <path> is not under the overlay prefix`,
/// splits at its first space.
fn split_wad_and_why(text: &str) -> (String, String) {
    let text = text.trim().strip_prefix("wad ").unwrap_or(text).trim();
    let (wad, why) = text
        .split_once(": ")
        .or_else(|| text.split_once(' '))
        .unwrap_or((text, ""));
    (last_segment(wad).to_string(), why.trim().to_string())
}

/// The archive a blocking scan record names, e.g.
/// `WAD scan failed status with c0000229 for Ahri.wad.client`.
///
/// `None` unless the DLL wrote the record at [`DllLevel::Error`], which is what
/// separates a rejection from the line an opted-out scan (`OPT_OUT_AH_V1`)
/// writes before it keeps injecting. `wad` is present when named, and `status`
/// falls back to `"unknown"`. The caller classifies the status.
pub fn parse_wad_scan_failure(level: DllLevel, message: &str) -> Option<WadScanFailure> {
    if level != DllLevel::Error || !message.contains(WAD_SCAN_FAILED) {
        return None;
    }

    let status = message
        .split_once("status with ")
        .map(|(_, rest)| first_token(rest))
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown")
        .to_string();

    let wad = message
        .rsplit_once(" for ")
        .map(|(_, rest)| rest.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    Some(WadScanFailure { wad, status })
}

/// First whitespace-delimited token of `s` (empty string if none).
fn first_token(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: &str = "ltk_patcher_dll::verify: ";

    #[test]
    fn init_done_is_a_live_overlay() {
        assert_eq!(DllLine::parse("init done"), Some(DllLine::InitDone));
        assert_eq!(
            DllLine::parse("ltk_patcher_dll::entry: init done"),
            Some(DllLine::InitDone)
        );
    }

    #[test]
    fn joined_too_late_is_an_inert_dll() {
        assert_eq!(
            DllLine::parse("ltk_patcher_dll::entry: joined too late, not overlaying"),
            Some(DllLine::JoinedTooLate)
        );
    }

    #[test]
    fn end_of_life_keeps_the_build_timestamp() {
        assert_eq!(
            DllLine::parse(
                "ltk_patcher_dll::entry: end of life reached, please update: 0x68a1b2c3"
            ),
            Some(DllLine::EndOfLife {
                build: "0x68a1b2c3".to_string()
            })
        );
    }

    #[test]
    fn hook_failures_name_the_hook() {
        assert_eq!(
            DllLine::parse("ltk_patcher_dll::entry: failed to install integrity hook"),
            Some(DllLine::HookFailed {
                hook: "integrity".to_string()
            })
        );
        assert_eq!(
            DllLine::parse("failed to install overlay hook"),
            Some(DllLine::HookFailed {
                hook: "overlay".to_string()
            })
        );
    }

    #[test]
    fn overlay_disabled_names_the_archive_and_the_reason() {
        let line = format!(
            "{TARGET}overlay verification failed, disabling overlay: wad data/final/champions/briar.wad.client: anti-hack scan blocked (c0000229): 21a1ca943ae71cbc"
        );
        assert_eq!(
            DllLine::parse(&line),
            Some(DllLine::OverlayDisabled {
                wad: "briar.wad.client".to_string(),
                why: "anti-hack scan blocked (c0000229): 21a1ca943ae71cbc".to_string(),
            })
        );
    }

    #[test]
    fn overlay_disabled_outside_the_prefix_still_names_the_archive() {
        let line = format!(
            "{TARGET}overlay verification failed, disabling overlay: wad C:\\overlay\\Aatrox.wad.client is not under the overlay prefix"
        );
        assert_eq!(
            DllLine::parse(&line),
            Some(DllLine::OverlayDisabled {
                wad: "Aatrox.wad.client".to_string(),
                why: "is not under the overlay prefix".to_string(),
            })
        );
    }

    #[test]
    fn lazy_failure_is_a_skipped_archive() {
        let line = format!(
            "{TARGET}lazy verification failed, not overlaying: wad DATA/FINAL/Champions/Ahri.wad.client: mount modded wad: invalid signature"
        );
        assert_eq!(
            DllLine::parse(&line),
            Some(DllLine::WadSkipped {
                wad: "Ahri.wad.client".to_string(),
                why: "mount modded wad: invalid signature".to_string(),
            })
        );
    }

    #[test]
    fn redirected_keeps_the_last_path_segment() {
        assert_eq!(
            DllLine::parse(
                "ltk_patcher_dll::hooks::fsov::imp_windows_iat: redirected wad: DATA/FINAL/Champions/Aatrox.wad.client"
            ),
            Some(DllLine::Redirected {
                wad: "Aatrox.wad.client".to_string()
            })
        );
        assert_eq!(
            DllLine::parse("redirected wad: DATA\\FINAL\\Maps\\Shipping\\Map11.wad.client"),
            Some(DllLine::Redirected {
                wad: "Map11.wad.client".to_string()
            })
        );
    }

    #[test]
    fn a_scan_record_is_read_whatever_its_status() {
        for status in ["c0000229", "base_skin"] {
            let line = format!("{TARGET}WAD scan failed status with {status} for briar.wad.client");
            assert_eq!(DllLine::parse(&line), Some(DllLine::ScanFailed));
        }
    }

    /// The phrase says which line this is and the level says whether it blocked,
    /// so an opted-out scan is still a scan record and still names no failure.
    #[test]
    fn an_opted_out_scan_record_names_no_failure() {
        let line = "WAD scan failed status with c0000229 for Ahri.wad.client";
        assert_eq!(DllLine::parse(line), Some(DllLine::ScanFailed));
        assert_eq!(parse_wad_scan_failure(DllLevel::Warn, line), None);
        assert!(parse_wad_scan_failure(DllLevel::Error, line).is_some());
    }

    #[test]
    fn a_level_is_read_however_the_host_spells_it() {
        assert_eq!(DllLevel::parse("ERROR"), DllLevel::Error);
        assert_eq!(DllLevel::parse("error"), DllLevel::Error);
        assert_eq!(DllLevel::parse("WARN"), DllLevel::Warn);
        assert_eq!(DllLevel::parse("INFO"), DllLevel::Other);
        assert_eq!(DllLevel::parse(""), DllLevel::Other);
    }

    #[test]
    fn launch_kinds_are_read_from_the_scan_notice() {
        assert_eq!(
            DllLine::parse(
                format!("{TARGET}spectator launch; anti-hack scan will not block").as_str()
            ),
            Some(DllLine::Launch(LaunchKind::Spectator))
        );
        assert_eq!(
            DllLine::parse("replay (.rofl) launch; anti-hack scan will not block"),
            Some(DllLine::Launch(LaunchKind::Replay))
        );
        assert_eq!(
            DllLine::parse("PBE launch; anti-hack scan will not block"),
            Some(DllLine::Launch(LaunchKind::Pbe))
        );
        assert_eq!(
            DllLine::parse("tournament launch; anti-hack scan will not block"),
            None
        );
    }

    #[test]
    fn chatter_is_not_a_line() {
        assert_eq!(
            DllLine::parse("ltk_patcher_dll::entry: init in process"),
            None
        );
        assert_eq!(DllLine::parse("overlay verified 4 wad(s)"), None);
        assert_eq!(DllLine::parse(""), None);
    }

    #[test]
    fn strip_target_only_strips_a_module_path() {
        assert_eq!(
            strip_target("ltk_patcher_dll::verify: init done"),
            "init done"
        );
        assert_eq!(strip_target("error: init done"), "init done");
        assert_eq!(
            strip_target("redirected wad: DATA/x.wad.client"),
            "redirected wad: DATA/x.wad.client"
        );
        assert_eq!(strip_target("init done"), "init done");
    }

    #[test]
    fn detects_wad_scan_failure_with_wad_and_status() {
        let msg = "error: WAD scan failed status with c0000229 for Ahri.wad.client";
        let failure = parse_wad_scan_failure(DllLevel::Error, msg).expect("should detect failure");
        assert_eq!(failure.wad.as_deref(), Some("Ahri.wad.client"));
        assert_eq!(failure.status, "c0000229");
    }

    #[test]
    fn ignores_scanning_info_line() {
        assert!(
            parse_wad_scan_failure(DllLevel::Other, "Scanning champion Ahri.wad.client").is_none()
        );
    }

    #[test]
    fn ignores_wad_log_hash_dump() {
        assert!(
            parse_wad_scan_failure(
                DllLevel::Error,
                "error: AH WAD Log:  9fed2719bffb7d50 51df2d746a6b6791"
            )
            .is_none()
        );
    }

    #[test]
    fn falls_back_when_status_and_wad_missing() {
        let failure =
            parse_wad_scan_failure(DllLevel::Error, "error: WAD scan failed").expect("detected");
        assert_eq!(failure.wad, None);
        assert_eq!(failure.status, "unknown");
    }

    #[test]
    fn falls_back_to_unknown_status_but_keeps_wad() {
        let failure = parse_wad_scan_failure(
            DllLevel::Error,
            "error: WAD scan failed for Kayn.wad.client",
        )
        .expect("detected");
        assert_eq!(failure.wad.as_deref(), Some("Kayn.wad.client"));
        assert_eq!(failure.status, "unknown");
    }

    #[test]
    fn parses_arbitrary_status_code() {
        // The parser stays status-agnostic - any hex code parses the same way and
        // the frontend classifies it. c0000225 is no longer emitted at runtime
        // (linked bins are validated pre-flight); kept here to prove that.
        let failure = parse_wad_scan_failure(
            DllLevel::Error,
            "error: WAD scan failed status with c0000225 for TahmKench.wad.client",
        )
        .expect("parseable scan failure");
        assert_eq!(failure.wad.as_deref(), Some("TahmKench.wad.client"));
        assert_eq!(failure.status, "c0000225");
    }

    #[test]
    fn detects_wad_scan_failure_from_ltk_patcher_dll_target() {
        // The message reaching us is the DLL record text after the level field
        // (`host::parse_event` strips the level), which the new DLL prefixes with
        // its `tracing` target. The parser keys off `WAD scan failed`, so the
        // target prefix is irrelevant.
        let msg =
            "ltk_patcher_dll::verify: WAD scan failed status with c0000229 for briar.wad.client";
        let failure = parse_wad_scan_failure(DllLevel::Error, msg).expect("should detect failure");
        assert_eq!(failure.wad.as_deref(), Some("briar.wad.client"));
        assert_eq!(failure.status, "c0000229");
    }

    #[test]
    fn ignores_overlay_verification_failed_line() {
        // The DLL logs a second ERROR right after the scan failure, summarizing
        // the disabled overlay. It must not be mistaken for a separate failure
        // (it lacks the `WAD scan failed` phrase), or briar would be counted twice.
        assert!(parse_wad_scan_failure(DllLevel::Error, "ltk_patcher_dll::verify: overlay verification failed, disabling overlay: wad data/final/champions/briar.wad.client: anti-hack scan blocked (c0000229): 21a1ca943ae71cbc a9d31e88e92e4715"
        )
        .is_none());
    }
}
