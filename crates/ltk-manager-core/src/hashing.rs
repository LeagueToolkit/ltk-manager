//! A bin hash hashed from its name at compile time, and as it crosses IPC.

use std::fmt;
use std::str::FromStr;

use ltk_hash::BinHash;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};

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
}
