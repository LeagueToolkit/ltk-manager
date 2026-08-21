use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const HASH_CHARS: usize = 16;

/// Patcher binary identity
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct BinaryId {
    /// 16 hex sha-256
    pub hash: String,
    pub built: Option<u32>,
}

impl BinaryId {
    /// Identifies the file at `path`, or `None` when it cannot be read.
    pub fn of(path: &Path) -> Option<Self> {
        Some(Self::of_bytes(&std::fs::read(path).ok()?))
    }

    /// Identifies `bytes` by their checksum, with the PE build date when the
    /// bytes are a PE.
    pub fn of_bytes(bytes: &[u8]) -> Self {
        Self {
            hash: content_hash(bytes),
            built: pe_timestamp(bytes),
        }
    }

    /// The build date as `YYYY-MM-DD`, when the stamp is a date.
    pub fn built_date(&self) -> Option<String> {
        self.built_at().map(|at| at.format("%Y-%m-%d").to_string())
    }

    /// The build date as RFC 3339, UTC, when the stamp is a date.
    pub fn built_rfc3339(&self) -> Option<String> {
        self.built_at().map(|at| at.to_rfc3339())
    }

    fn built_at(&self) -> Option<DateTime<Utc>> {
        self.built
            .and_then(|secs| DateTime::from_timestamp(i64::from(secs), 0))
    }
}

/// Patcher identities
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PatcherBinaries {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub dll: Option<BinaryId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub host: Option<BinaryId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub matches_bundle: Option<bool>,
}

impl PatcherBinaries {
    /// Identifies the injected DLL and the host, and compares them to the
    /// checksums this manager build bundled.
    ///
    /// `expected_dll` and `expected_host` are the bundle's checksums from build
    /// time, empty when the build did not bake them in, in which case
    /// [`Self::matches_bundle`] stays `None`.
    pub fn identify(
        dll_path: &Path,
        host_path: &Path,
        expected_dll: &str,
        expected_host: &str,
    ) -> Self {
        let dll = BinaryId::of(dll_path);
        let host = BinaryId::of(host_path);
        let matches_bundle = (!expected_dll.is_empty() || !expected_host.is_empty()).then(|| {
            dll.as_ref().is_some_and(|id| id.hash == expected_dll)
                && host.as_ref().is_some_and(|id| id.hash == expected_host)
        });
        Self {
            dll,
            host,
            matches_bundle,
        }
    }

    /// Whether nothing was identified, so a report and a token can leave it out.
    pub fn is_empty(&self) -> bool {
        self.dll.is_none() && self.host.is_none()
    }
}

/// The first [`HASH_CHARS`] hex digits of the SHA-256 of `bytes`.
pub fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(HASH_CHARS);
    for byte in digest.iter().take(HASH_CHARS / 2) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// `bytes` is a PE file
fn pe_timestamp(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 0x40 || &bytes[..2] != b"MZ" {
        return None;
    }

    let e_lfanew = u32::from_le_bytes(bytes[0x3C..0x40].try_into().ok()?) as usize;
    let stamp_at = e_lfanew.checked_add(8)?;
    if bytes.len() < stamp_at + 4 || &bytes[e_lfanew..e_lfanew + 4] != b"PE\0\0" {
        return None;
    }

    let stamp = u32::from_le_bytes(bytes[stamp_at..stamp_at + 4].try_into().ok()?);
    (stamp != 0 && stamp != u32::MAX).then_some(stamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal PE: `MZ`, `e_lfanew` at 0x3C pointing at `PE\0\0`, then a
    /// `TimeDateStamp`. Everything between is zero padding.
    fn fake_pe(stamp: u32) -> Vec<u8> {
        let e_lfanew: usize = 0x80;
        let mut bytes = vec![0u8; e_lfanew + 12];
        bytes[0] = b'M';
        bytes[1] = b'Z';
        bytes[0x3C..0x40].copy_from_slice(&(e_lfanew as u32).to_le_bytes());
        bytes[e_lfanew..e_lfanew + 4].copy_from_slice(b"PE\0\0");
        bytes[e_lfanew + 8..e_lfanew + 12].copy_from_slice(&stamp.to_le_bytes());
        bytes
    }

    #[test]
    fn the_hash_is_the_sha256_prefix() {
        // `printf 'hello' | sha256sum` is
        // `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
        assert_eq!(BinaryId::of_bytes(b"hello").hash, "2cf24dba5fb0a30e");
    }

    #[test]
    fn a_pe_stamp_reads_as_a_date() {
        let id = BinaryId::of_bytes(&fake_pe(0x6A83_01AB));
        assert_eq!(id.built, Some(0x6A83_01AB));
        assert_eq!(id.built_date().as_deref(), Some("2026-08-17"));
    }

    #[test]
    fn a_zeroed_or_sentinel_stamp_is_not_a_date() {
        assert_eq!(BinaryId::of_bytes(&fake_pe(0)).built, None);
        assert_eq!(BinaryId::of_bytes(&fake_pe(u32::MAX)).built, None);
    }

    #[test]
    fn a_non_pe_has_no_build_date_but_still_a_hash() {
        let id = BinaryId::of_bytes(b"not a pe at all");
        assert_eq!(id.built, None);
        assert_eq!(id.hash.len(), HASH_CHARS);
    }

    #[test]
    fn the_bundle_match_needs_both_binaries() {
        let dll = BinaryId::of_bytes(b"dll");
        let host = BinaryId::of_bytes(b"host");
        let both = PatcherBinaries {
            dll: Some(dll.clone()),
            host: Some(host.clone()),
            matches_bundle: None,
        };

        assert_eq!(
            build(&both, &dll.hash, &host.hash).matches_bundle,
            Some(true)
        );
        // One checksum wrong, and the pair no longer matches.
        assert_eq!(
            build(&both, &dll.hash, "0000000000000000").matches_bundle,
            Some(false)
        );
        // No expected checksums baked in, so nothing is claimed.
        assert_eq!(build(&both, "", "").matches_bundle, None);
    }

    /// Re-runs [`PatcherBinaries::identify`]'s comparison without touching the
    /// filesystem, over ids already in hand.
    fn build(from: &PatcherBinaries, expected_dll: &str, expected_host: &str) -> PatcherBinaries {
        let matches_bundle = (!expected_dll.is_empty() || !expected_host.is_empty()).then(|| {
            from.dll.as_ref().is_some_and(|d| d.hash == expected_dll)
                && from.host.as_ref().is_some_and(|h| h.hash == expected_host)
        });
        PatcherBinaries {
            matches_bundle,
            ..from.clone()
        }
    }
}
