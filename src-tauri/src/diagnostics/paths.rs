//! Path / install / storage diagnostic checks.
//!
//! - League path validity, writability, length
//! - Mod storage path validity, writability, free space
//! - Storage NOT inside League dir
//! - Cloud-sync attribute (OneDrive offline / RECALL_ON_DATA_ACCESS)
//!
//! Free-space and length thresholds match cslol-diag (1 GB / 128 chars).

use std::path::{Path, PathBuf};

use super::{check, check_ok, Category, Check, CheckCtx, CheckDetail, Severity};

#[cfg(target_os = "windows")]
use super::win_util::has_cloud_sync_attrs;

const PATH_LEN_WARN: usize = 128;
const FREE_SPACE_WARN: u64 = 1024 * 1024 * 1024; // 1 GB

fn bytes_to_str(x: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;
    if x >= TB {
        format!("{:.1} TB", x as f64 / TB as f64)
    } else if x >= GB {
        format!("{:.1} GB", x as f64 / GB as f64)
    } else if x >= MB {
        format!("{:.1} MB", x as f64 / MB as f64)
    } else if x >= KB {
        format!("{:.1} KB", x as f64 / KB as f64)
    } else {
        format!("{} B", x)
    }
}

/// Try to write a temp file inside `dir` and let it auto-clean. Returns
/// `Ok(())` on success or the underlying io::Error otherwise.
///
/// We only care about the *write* succeeding — that's what the patcher and
/// overlay builder need. `tempfile::Builder` handles unique naming and RAII
/// cleanup, so we never leak `.ltk-diag-probe-*` files when the remove path
/// fails (locked by AV, transient handle, etc.).
fn probe_writable(dir: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = tempfile::Builder::new()
        .prefix(".ltk-diag-probe-")
        .tempfile_in(dir)?;
    f.write_all(b"ltk")?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn free_disk_bytes(path: &Path) -> Option<u64> {
    use std::ptr;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide = super::win_util::path_to_wide(path);
    let mut free: u64 = 0;
    // SAFETY: null-terminated wide string; `free` is a stack u64.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free as *mut u64,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        None
    } else {
        Some(free)
    }
}

#[cfg(not(target_os = "windows"))]
fn free_disk_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(not(target_os = "windows"))]
fn has_cloud_sync_attrs(_path: &Path) -> bool {
    false
}

fn is_subpath_of(child: &Path, parent: &Path) -> bool {
    let Ok(c) = std::fs::canonicalize(child) else {
        return child.starts_with(parent);
    };
    let Ok(p) = std::fs::canonicalize(parent) else {
        return false;
    };
    c.starts_with(p)
}

/// Recognized cloud-sync directory tokens. Used as a path-component fallback
/// when the file-attribute query returns false (cloud syncing client not
/// installed or path outside the synced root).
const CLOUD_TOKENS: &[&str] = &[
    "OneDrive",
    "Dropbox",
    "iCloudDrive",
    "iCloud Drive",
    "Google Drive",
    "GoogleDrive",
    "Box",
    "pCloud",
];

fn cloud_token_in_path(path: &Path) -> Option<&'static str> {
    let s = path.display().to_string();
    CLOUD_TOKENS.iter().copied().find(|t| s.contains(t))
}

pub fn check_league_path(ctx: &CheckCtx) -> Check {
    let Some(p) = ctx.league_path.as_ref() else {
        return check(
            "paths.league.exists",
            "League installation path",
            Category::League,
            Severity::Bad,
            "Not configured",
        );
    };
    let game_exe = p.join("Game").join("League of Legends.exe");
    let mac_path = p.join("Contents").join("LoL").join("Game");
    let exists = game_exe.exists() || mac_path.exists();
    if !exists {
        let mut c = check(
            "paths.league.exists",
            "League installation path",
            Category::League,
            Severity::Bad,
            "Configured path doesn't contain League of Legends",
        );
        c.details
            .push(CheckDetail::new("path", p.display().to_string()));
        c.suggestion = Some(
            "League's executable was not found at the configured path. Re-run setup or update the path in Settings."
                .into(),
        );
        return c;
    }
    let mut c = check_ok(
        "paths.league.exists",
        "League installation path",
        Category::League,
        &p.display().to_string(),
    );
    let len = p.display().to_string().len();
    if len > PATH_LEN_WARN {
        c.severity = Severity::Warn;
        c.summary = format!("{} (path length {} > {})", p.display(), len, PATH_LEN_WARN);
        c.suggestion = Some(
            "League is installed under a deeply nested path. Combined with a similarly deep mod folder this can hit the legacy 260-character path limit. Consider moving League to a shorter path."
                .into(),
        );
    }
    c.details.push(CheckDetail::new("length", len.to_string()));
    if has_cloud_sync_attrs(p) {
        c.severity = Severity::Bad;
        c.summary = format!("{} (cloud-only / OneDrive)", p.display());
        c.suggestion = Some(
            "League's installation has cloud-sync attributes set (e.g. OneDrive Files-On-Demand). The patcher cannot reliably overlay files that may be evicted to the cloud. Move League outside any cloud-synced folder."
                .into(),
        );
        c.details.push(CheckDetail::new(
            "cloud_attrs",
            "FILE_ATTRIBUTE_OFFLINE / RECALL_ON_DATA_ACCESS",
        ));
    } else if let Some(t) = cloud_token_in_path(p) {
        if c.severity == Severity::Ok {
            c.severity = Severity::Warn;
            c.summary = format!("{} (path contains \"{}\")", p.display(), t);
        }
        c.details.push(CheckDetail::new("cloud_token", t));
    }
    c
}

pub fn check_league_writability(ctx: &CheckCtx) -> Check {
    let Some(p) = ctx.league_path.as_ref() else {
        return check(
            "paths.league.writable",
            "League directory is writable",
            Category::League,
            Severity::Info,
            "League path not configured",
        );
    };
    let game_dir = p.join("Game");
    let target = if game_dir.exists() {
        game_dir
    } else {
        p.clone()
    };
    match probe_writable(&target) {
        Ok(()) => check_ok(
            "paths.league.writable",
            "League directory is writable",
            Category::League,
            "Writable",
        ),
        Err(e) => {
            let mut c = check(
                "paths.league.writable",
                "League directory is writable",
                Category::League,
                Severity::Bad,
                "Cannot write to League's Game directory",
            );
            c.details
                .push(CheckDetail::new("path", target.display().to_string()));
            c.details.push(CheckDetail::new("error", e.to_string()));
            c.suggestion = Some(
                "The patcher needs to write the overlay into the Game folder. Make sure ltk-manager is NOT running as administrator (a non-admin manager + non-admin League is the supported config), check NTFS permissions, and confirm no antivirus is blocking writes to the League directory."
                    .into(),
            );
            c
        }
    }
}

pub fn check_storage_path(ctx: &CheckCtx) -> Check {
    let Some(p) = ctx.mod_storage_path.as_ref() else {
        return check(
            "paths.storage.exists",
            "Mod storage path",
            Category::Storage,
            Severity::Bad,
            "Could not resolve a storage directory (Tauri app-data dir unavailable)",
        );
    };
    let summary_suffix = if ctx.mod_storage_is_default {
        " (default)"
    } else {
        ""
    };
    if !p.exists() {
        let mut c = check(
            "paths.storage.exists",
            "Mod storage path",
            Category::Storage,
            Severity::Warn,
            format!(
                "Storage directory does not exist yet{} — will be created on first use",
                summary_suffix
            ),
        );
        c.details
            .push(CheckDetail::new("path", p.display().to_string()));
        if ctx.mod_storage_is_default {
            c.details
                .push(CheckDetail::new("source", "default (app-data dir)"));
        }
        return c;
    }
    let mut c = check_ok(
        "paths.storage.exists",
        "Mod storage path",
        Category::Storage,
        &format!("{}{}", p.display(), summary_suffix),
    );
    if ctx.mod_storage_is_default {
        c.details
            .push(CheckDetail::new("source", "default (app-data dir)"));
    }
    if has_cloud_sync_attrs(p) {
        c.severity = Severity::Bad;
        c.summary = format!("{} (cloud-only / OneDrive){}", p.display(), summary_suffix);
        c.suggestion = Some(
            "Your mod storage folder has cloud-sync attributes. Mods on cloud-only storage will be re-downloaded every time the patcher reads them — slow at best, broken at worst. Move storage to a local-only folder."
                .into(),
        );
        c.details.push(CheckDetail::new(
            "cloud_attrs",
            "FILE_ATTRIBUTE_OFFLINE / RECALL_ON_DATA_ACCESS",
        ));
    } else if let Some(t) = cloud_token_in_path(p) {
        c.severity = Severity::Warn;
        c.summary = format!(
            "{} (path contains \"{}\"){}",
            p.display(),
            t,
            summary_suffix
        );
        c.suggestion = Some(
            format!(
                "Storage path appears to live under a {} folder. If sync is active this will cause patcher slowness and potential corruption — recommend moving storage out of any cloud-synced folder.",
                t
            ),
        );
        c.details.push(CheckDetail::new("cloud_token", t));
    }
    c
}

pub fn check_storage_writability(ctx: &CheckCtx) -> Check {
    let Some(p) = ctx.mod_storage_path.as_ref() else {
        return check(
            "paths.storage.writable",
            "Storage directory is writable",
            Category::Storage,
            Severity::Info,
            "No storage path resolved",
        );
    };
    if !p.exists() {
        return check(
            "paths.storage.writable",
            "Storage directory is writable",
            Category::Storage,
            Severity::Info,
            "Storage directory does not exist yet — skipped",
        );
    }
    match probe_writable(p) {
        Ok(()) => check_ok(
            "paths.storage.writable",
            "Storage directory is writable",
            Category::Storage,
            "Writable",
        ),
        Err(e) => {
            let mut c = check(
                "paths.storage.writable",
                "Storage directory is writable",
                Category::Storage,
                Severity::Bad,
                "Cannot write to mod storage directory",
            );
            c.details.push(CheckDetail::new("error", e.to_string()));
            c.suggestion = Some(
                "Mods can't be installed if the storage folder isn't writable. Check NTFS permissions and antivirus exclusions."
                    .into(),
            );
            c
        }
    }
}

pub fn check_storage_in_league(ctx: &CheckCtx) -> Check {
    let (Some(storage), Some(league)) = (ctx.mod_storage_path.as_ref(), ctx.league_path.as_ref())
    else {
        return check(
            "paths.storage.not_in_league",
            "Storage outside League directory",
            Category::Storage,
            Severity::Info,
            "League path not configured — skipped",
        );
    };
    if is_subpath_of(storage, league) {
        let mut c = check(
            "paths.storage.not_in_league",
            "Storage outside League directory",
            Category::Storage,
            Severity::Bad,
            "Mod storage is inside the League installation",
        );
        c.details
            .push(CheckDetail::new("storage", storage.display().to_string()));
        c.details
            .push(CheckDetail::new("league", league.display().to_string()));
        c.suggestion = Some(
            "Storing mods inside the League folder confuses the patcher (mods get rescanned as game WADs and double-counted). Move storage to a separate folder."
                .into(),
        );
        c
    } else {
        check_ok(
            "paths.storage.not_in_league",
            "Storage outside League directory",
            Category::Storage,
            "OK",
        )
    }
}

pub fn check_free_space(ctx: &CheckCtx) -> Check {
    let target: PathBuf = ctx
        .mod_storage_path
        .clone()
        .or_else(|| ctx.league_path.clone())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .unwrap_or_else(|| PathBuf::from("."));
    let Some(free) = free_disk_bytes(&target) else {
        return check(
            "paths.free_space",
            "Free disk space",
            Category::Storage,
            Severity::Info,
            "Could not query free space",
        );
    };
    let display = bytes_to_str(free);
    if free < FREE_SPACE_WARN {
        let mut c = check(
            "paths.free_space",
            "Free disk space",
            Category::Storage,
            Severity::Warn,
            format!("{} free (< 1 GB)", display),
        );
        c.details
            .push(CheckDetail::new("path", target.display().to_string()));
        c.suggestion = Some(
            "Less than 1 GB free on the storage drive. Building the overlay requires temporarily duplicating WAD contents — free up space before starting the patcher."
                .into(),
        );
        c
    } else {
        let mut c = check_ok(
            "paths.free_space",
            "Free disk space",
            Category::Storage,
            &format!("{} free", display),
        );
        c.details
            .push(CheckDetail::new("path", target.display().to_string()));
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_str_formats_units() {
        assert_eq!(bytes_to_str(0), "0 B");
        assert_eq!(bytes_to_str(1024), "1.0 KB");
        assert_eq!(bytes_to_str(1024 * 1024), "1.0 MB");
        assert_eq!(bytes_to_str(2 * 1024 * 1024 * 1024), "2.0 GB");
    }

    #[test]
    fn cloud_token_detection() {
        assert_eq!(
            cloud_token_in_path(Path::new(r"C:\Users\foo\OneDrive\Mods")),
            Some("OneDrive")
        );
        assert_eq!(
            cloud_token_in_path(Path::new(r"D:\Riot Games\League of Legends")),
            None
        );
    }

    #[test]
    fn probe_writable_works_in_temp() {
        let dir = std::env::temp_dir();
        assert!(probe_writable(&dir).is_ok());
    }
}
