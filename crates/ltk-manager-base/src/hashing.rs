//! A bin hash hashed from its name at compile time, and as it crosses IPC, the hash that
//! identifies content, and the fingerprint of a built overlay.

use std::fmt;
use std::io::{self, Read, Write};
use std::path::Path;
use std::str::FromStr;

use ltk_hash::BinHash;
use ltk_overlay::{OverlayState, StateDir};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use sha2::{Digest, Sha256};

/// How many hex digits a [`content_hash`] is.
pub const CONTENT_HASH_CHARS: usize = 16;

/// The first [`CONTENT_HASH_CHARS`] hex digits of the SHA-256 of `bytes`.
pub fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(CONTENT_HASH_CHARS);
    for byte in digest.iter().take(CONTENT_HASH_CHARS / 2) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Returns the SHA-256 of the file at `path`, as lowercase hex.
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = fs_err::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }

    Ok(format!("{:x}", hash.finalize()))
}

/// Copies `source` into `destination` and checks the copy against `size` and the hex
/// SHA-256 `digest`.
///
/// Calls `progress` with the bytes copied so far before each read. Stops reading and
/// returns `Ok(false)` as soon as the source exceeds `size`. Returns `Ok(false)` if the
/// copied bytes differ from `size` or `digest`.
pub fn copy_verified<E: From<io::Error>>(
    source: &mut impl Read,
    destination: &mut impl Write,
    size: u64,
    digest: &str,
    mut progress: impl FnMut(u64) -> Result<(), E>,
) -> Result<bool, E> {
    let mut hash = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        progress(copied)?;
        let count = source.read(&mut buffer).map_err(E::from)?;
        if count == 0 {
            break;
        }

        copied += count as u64;
        if copied > size {
            return Ok(false);
        }

        hash.update(&buffer[..count]);
        destination.write_all(&buffer[..count]).map_err(E::from)?;
    }

    Ok(copied == size && format!("{:x}", hash.finalize()).eq_ignore_ascii_case(digest))
}

/// The bin hash of a class or field `name`, which is FNV-1a over its lowercased ASCII.
///
/// The same value as `BinHash::hash_str`, in a `const`.
#[must_use]
pub const fn named(name: &str) -> BinHash {
    let bytes = name.as_bytes();
    let mut hash: u32 = 0x811c_9dc5;
    let mut at = 0;

    while at < bytes.len() {
        hash ^= bytes[at].to_ascii_lowercase() as u32;
        hash = hash.wrapping_mul(0x0100_0193);
        at += 1;
    }

    BinHash(hash)
}

/// A [`BinHash`] written as `0x` and eight hex digits, which is how a user reads one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", specta(transparent))]
pub struct HexBinHash(#[cfg_attr(feature = "ts", specta(type = String))] BinHash);

impl HexBinHash {
    /// The hash itself.
    #[must_use]
    pub const fn get(self) -> BinHash {
        self.0
    }
}

impl From<BinHash> for HexBinHash {
    fn from(hash: BinHash) -> Self {
        Self(hash)
    }
}

impl From<HexBinHash> for BinHash {
    fn from(hash: HexBinHash) -> Self {
        hash.0
    }
}

impl fmt::Display for HexBinHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{:08x}", self.0.0)
    }
}

/// Why text is not a [`HexBinHash`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a bin hash, which is 0x and up to eight hex digits: {0}")]
pub struct ParseHexBinHashError(String);

impl FromStr for HexBinHash {
    type Err = ParseHexBinHashError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let digits = text.strip_prefix("0x").unwrap_or(text);
        if digits.is_empty() || digits.len() > 8 {
            return Err(ParseHexBinHashError(text.to_owned()));
        }

        u32::from_str_radix(digits, 16)
            .map(|value| Self(BinHash(value)))
            .map_err(|_| ParseHexBinHashError(text.to_owned()))
    }
}

impl Serialize for HexBinHash {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for HexBinHash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

/// The fingerprint of a built overlay: [`CONTENT_HASH_CHARS`] hex digits over the fingerprint
/// of the game directory and the fingerprint of each patched archive. Two builds with one
/// fingerprint wrote the same archives.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OverlayFingerprint(String);

impl OverlayFingerprint {
    /// Returns the fingerprint of the overlay that `state` describes.
    #[must_use]
    pub fn of(state: &OverlayState) -> Self {
        let mut facts = state.game_fingerprint.to_le_bytes().to_vec();
        for (wad, fingerprint) in &state.wad_fingerprints {
            facts.extend_from_slice(wad.as_bytes());
            // A byte that no path holds, so two names cannot run together.
            facts.push(0);
            facts.extend_from_slice(&fingerprint.to_le_bytes());
        }
        Self(content_hash(&facts))
    }

    /// Reads the fingerprint of the overlay whose state file is in `state_dir`.
    ///
    /// Returns `None` if the state file is missing or cannot be read.
    #[must_use]
    pub fn read(state_dir: &StateDir) -> Option<Self> {
        let state = OverlayState::load(&state_dir.overlay_state())
            .ok()
            .flatten()?;
        Some(Self::of(&state))
    }

    /// Returns the fingerprint as its hex digits.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for OverlayFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_crosses_ipc_as_eight_hex_digits() {
        let hash = HexBinHash::from(BinHash(0x0430_0058));

        assert_eq!(serde_json::to_string(&hash).unwrap(), r#""0x04300058""#);
        assert_eq!(
            serde_json::from_str::<HexBinHash>(r#""0x04300058""#).unwrap(),
            hash
        );
    }

    #[test]
    fn text_that_is_no_hash_is_refused() {
        for text in ["", "0x", "0x123456789", "0xnothex"] {
            assert!(text.parse::<HexBinHash>().is_err(), "{text:?} parsed");
        }
    }

    /// Saves a state with `mods` enabled and the patched archives `wads` in `dir`.
    fn save_overlay_state(dir: &StateDir, mods: &[&str], wads: &[(&str, u64)]) {
        let state = OverlayState::new(
            mods.iter().map(|id| (*id).to_owned()).collect(),
            std::collections::BTreeMap::new(),
            7,
            Vec::new(),
            Vec::new(),
            wads.iter()
                .map(|(wad, hash)| ((*wad).to_owned(), *hash))
                .collect(),
        );
        state.save(&dir.overlay_state()).expect("the state saves");
    }

    #[test]
    fn overlay_fingerprint_follows_the_patched_archives() {
        let temp = tempfile::tempdir().unwrap();
        let dir = StateDir::new(camino::Utf8Path::from_path(temp.path()).unwrap());
        assert_eq!(OverlayFingerprint::read(&dir), None);

        save_overlay_state(&dir, &["a"], &[("Ahri.wad.client", 1)]);
        let first = OverlayFingerprint::read(&dir).expect("a fingerprint");
        assert_eq!(first.as_str().len(), CONTENT_HASH_CHARS);

        save_overlay_state(&dir, &["a", "b"], &[("Ahri.wad.client", 1)]);
        assert_eq!(OverlayFingerprint::read(&dir), Some(first.clone()));

        save_overlay_state(&dir, &["a", "b"], &[("Ahri.wad.client", 2)]);
        assert_ne!(OverlayFingerprint::read(&dir), Some(first));
    }

    #[test]
    fn an_overlay_fingerprint_is_stored_as_its_hex_digits() {
        let fingerprint: OverlayFingerprint =
            serde_json::from_str(r#""ab12cd34ef567890""#).unwrap();

        assert_eq!(fingerprint.to_string(), "ab12cd34ef567890");
        assert_eq!(
            serde_json::to_string(&fingerprint).unwrap(),
            r#""ab12cd34ef567890""#
        );
    }
}
