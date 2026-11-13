use crate::diagnostics::incident::LaunchKind;

use super::injector::WadScanFailure;

pub mod host_status {
    pub const SCANNING_FOR_GAME: &str = "scanning for game";
    pub const GAME_FOUND: &str = "game found";
    pub const DLL_ATTACHED: &str = "dll attached";
    pub const GAME_EXIT: &str = "game exit";
    pub const DLL_DETACHED: &str = "dll detached";
}

pub const INIT_DONE: &str = "init done";
pub const JOINED_TOO_LATE: &str = "joined too late, not overlaying";
pub const END_OF_LIFE: &str = "end of life reached, please update: ";
pub const HOOK_FAILED_PREFIX: &str = "failed to install ";
pub const HOOK_FAILED_SUFFIX: &str = " hook";
pub const OVERLAY_DISABLED: &str = "overlay verification failed, disabling overlay: ";
pub const WAD_SKIPPED: &str = "lazy verification failed, not overlaying: ";
pub const WAD_SCAN_FAILED: &str = "WAD scan failed";
pub const OVERLAY_REFUSED: &str = "host verification failed, refusing overlay";
pub const WAD_OPEN_FAILED: &str = "overlay open failed for verified wad ";
pub const WAD_ALLOC_FAILED: &str = "overlay string alloc failed for verified wad ";
pub const USING_ORIGINAL: &str = ", using original";
/// The reason that a `WadSkipped` line carries when the DLL verified an archive and
/// then failed to open it.
pub const WAD_OPEN_FAILED_WHY: &str = "the patcher could not open the modded archive";
pub const REDIRECTED: &str = "redirected wad: ";
pub const LAUNCH_SUFFIX: &str = " launch; anti-hack scan will not block";
pub const LAUNCH_SPECTATOR: &str = "spectator";
pub const LAUNCH_REPLAY: &str = "replay (.rofl)";
pub const LAUNCH_PBE: &str = "PBE";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DllLevel {
    Error,
    Warn,
    Other,
}

impl DllLevel {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DllLine {
    InitDone,
    JoinedTooLate,
    EndOfLife {
        build: String,
    },
    OverlayDisabled {
        wad: String,
        why: String,
    },
    WadSkipped {
        wad: String,
        why: String,
    },
    HookFailed {
        hook: String,
    },
    /// The DLL refused the overlay. `code` is the bracketed code of the record, if
    /// the record has one.
    OverlayRefused {
        code: Option<String>,
    },
    Redirected {
        wad: String,
    },
    ScanFailed,
    Launch(LaunchKind),
}

impl DllLine {
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
        if let Some(rest) = text.strip_prefix(OVERLAY_REFUSED) {
            return Some(Self::OverlayRefused {
                code: bracketed_code(rest),
            });
        }
        if let Some(wad) = text
            .strip_prefix(WAD_OPEN_FAILED)
            .or_else(|| text.strip_prefix(WAD_ALLOC_FAILED))
            .and_then(|rest| rest.strip_suffix(USING_ORIGINAL))
        {
            return Some(Self::WadSkipped {
                wad: last_segment(wad).to_string(),
                why: WAD_OPEN_FAILED_WHY.to_string(),
            });
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

/// Returns the text between the first `[` and the next `]` of `text`, if it is
/// ASCII letters and digits only.
fn bracketed_code(text: &str) -> Option<String> {
    let (_, rest) = text.split_once('[')?;
    let (code, _) = rest.split_once(']')?;
    (!code.is_empty() && code.chars().all(|c| c.is_ascii_alphanumeric())).then(|| code.to_string())
}

fn last_segment(path: &str) -> &str {
    let path = path.trim();
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn split_wad_and_why(text: &str) -> (String, String) {
    let text = text.trim().strip_prefix("wad ").unwrap_or(text).trim();
    let (wad, why) = text
        .split_once(": ")
        .or_else(|| text.split_once(' '))
        .unwrap_or((text, ""));
    (last_segment(wad).to_string(), why.trim().to_string())
}

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
    fn overlay_refused_keeps_the_code_and_drops_its_arguments() {
        assert_eq!(
            DllLine::parse(
                "ltk_patcher_dll::verify: host verification failed, refusing overlay: [VRF00000008] (4312,ab12)"
            ),
            Some(DllLine::OverlayRefused {
                code: Some("VRF00000008".to_string())
            })
        );
    }

    #[test]
    fn overlay_refused_without_a_code_has_no_code() {
        assert_eq!(
            DllLine::parse("host verification failed, refusing overlay: access denied"),
            Some(DllLine::OverlayRefused { code: None })
        );
    }

    #[test]
    fn wad_open_failure_is_a_skipped_archive() {
        for line in [
            "overlay open failed for verified wad DATA/FINAL/Champions/Ahri.wad.client, using original",
            "overlay string alloc failed for verified wad DATA/FINAL/Champions/Ahri.wad.client, using original",
        ] {
            assert_eq!(
                DllLine::parse(&format!("{TARGET}{line}")),
                Some(DllLine::WadSkipped {
                    wad: "Ahri.wad.client".to_string(),
                    why: WAD_OPEN_FAILED_WHY.to_string(),
                })
            );
        }
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
        let msg =
            "ltk_patcher_dll::verify: WAD scan failed status with c0000229 for briar.wad.client";
        let failure = parse_wad_scan_failure(DllLevel::Error, msg).expect("should detect failure");
        assert_eq!(failure.wad.as_deref(), Some("briar.wad.client"));
        assert_eq!(failure.status, "c0000229");
    }

    #[test]
    fn ignores_overlay_verification_failed_line() {
        assert!(parse_wad_scan_failure(DllLevel::Error, "ltk_patcher_dll::verify: overlay verification failed, disabling overlay: wad data/final/champions/briar.wad.client: anti-hack scan blocked (c0000229): 21a1ca943ae71cbc a9d31e88e92e4715"
        )
        .is_none());
    }
}
