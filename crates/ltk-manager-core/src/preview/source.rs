use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::game_wads::{GameArchives, WadCache};
use crate::utils::path::resolve_within;

/// Where a previewed asset's bytes come from.
///
/// A reference crosses IPC from the webview, so every path in one is untrusted.
/// [`read`](Self::read) checks a relative path against the root it belongs to
/// rather than joining it on, and [`File`](Self::File) is the one variant that
/// names a path outright.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AssetRef {
    /// A file of one layer of a workshop project.
    #[serde(rename_all = "camelCase")]
    Layer {
        /// The project directory.
        project: String,
        layer: String,
        /// Path relative to the layer root, with forward slashes.
        path: String,
    },
    /// One chunk of one archive of the installed game.
    #[serde(rename_all = "camelCase")]
    GameChunk {
        /// A `DATA/FINAL`-relative archive name.
        wad: String,
        /// The chunk's path hash as 16 lowercase hex digits.
        path_hash: String,
    },
    /// Any file on disk, for a preview that belongs to no project.
    ///
    /// Confined to no root, because a file dropped on the window or picked
    /// from a dialog is anywhere. The built-in `asset:` protocol already serves
    /// the whole filesystem to the same webview, so this adds no reach.
    #[serde(rename_all = "camelCase")]
    File { path: String },
}

impl AssetRef {
    /// Read the asset's bytes from wherever it lives.
    ///
    /// `wads` is only touched by [`GameChunk`](Self::GameChunk), whose archive
    /// it keeps mounted for the chunks read after this one.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when the reference names nothing
    /// the store holds, or when a relative path in it escapes its root, and
    /// with I/O or WAD errors when the store itself cannot be read.
    pub fn read(&self, config: &Config, wads: &WadCache) -> AppResult<Vec<u8>> {
        match self {
            Self::Layer {
                project,
                layer,
                path,
            } => {
                /* Under `content` rather than under the layer, so one check
                covers the layer name as well as the path inside it. */
                let root = Path::new(project).join("content");
                Ok(fs::read(resolve_within(
                    &root,
                    &format!("{layer}/{path}"),
                )?)?)
            }
            Self::GameChunk { wad, path_hash } => {
                let path_hash = u64::from_str_radix(path_hash, 16).map_err(|_| {
                    AppError::InvalidPath(format!("Not a chunk path hash: {path_hash}"))
                })?;
                wads.read_chunk(&GameArchives::resolve(config)?, wad, path_hash)
            }
            Self::File { path } => Ok(fs::read(path)?),
        }
    }

    /// The name a viewer shows, and what a guess at the file kind falls back to.
    ///
    /// A game chunk has the hash for a name, because the reference carries no
    /// resolved path. Nothing is lost: a chunk is identified by its magic
    /// bytes, which is what an unnamed chunk needs anyway.
    pub fn name(&self) -> &str {
        match self {
            Self::Layer { path, .. } | Self::File { path } => {
                path.rsplit(['/', '\\']).next().unwrap_or(path)
            }
            Self::GameChunk { path_hash, .. } => path_hash,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer_project(root: &Path) -> String {
        let layer = root.join("content").join("base").join("assets");
        fs::create_dir_all(&layer).unwrap();
        fs::write(layer.join("icon.tex"), b"TEX\0").unwrap();
        root.to_string_lossy().into_owned()
    }

    fn layer_ref(project: &str, layer: &str, path: &str) -> AssetRef {
        AssetRef::Layer {
            project: project.to_owned(),
            layer: layer.to_owned(),
            path: path.to_owned(),
        }
    }

    #[test]
    fn reads_a_layer_file() {
        let tmp = tempfile::tempdir().unwrap();
        let project = layer_project(tmp.path());

        let bytes = layer_ref(&project, "base", "assets/icon.tex")
            .read(&Config::default(), &WadCache::default())
            .unwrap();

        assert_eq!(bytes, b"TEX\0");
    }

    #[test]
    fn a_layer_path_cannot_escape_the_content_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let project = layer_project(tmp.path());
        fs::write(tmp.path().join("mod.config.json"), b"{}").unwrap();

        for (layer, path) in [
            ("base", "../../mod.config.json"),
            ("base", "assets/../../../mod.config.json"),
            ("..", "mod.config.json"),
            ("../..", "secret"),
        ] {
            let err = layer_ref(&project, layer, path)
                .read(&Config::default(), &WadCache::default())
                .unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPath(_)),
                "{layer:?} + {path:?} should be rejected as an invalid path"
            );
        }
    }

    /// Joining the layer onto the path is what disarms a rooted one, because
    /// the separator that would have made it a root lands mid-string instead.
    #[test]
    fn a_rooted_layer_path_reads_the_layer_and_not_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let project = layer_project(tmp.path());

        let bytes = layer_ref(&project, "base", "/assets/icon.tex")
            .read(&Config::default(), &WadCache::default())
            .unwrap();

        assert_eq!(bytes, b"TEX\0");
    }

    #[test]
    fn reads_a_loose_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("loose.dds");
        fs::write(&path, b"DDS ").unwrap();

        let bytes = AssetRef::File {
            path: path.to_string_lossy().into_owned(),
        }
        .read(&Config::default(), &WadCache::default())
        .unwrap();

        assert_eq!(bytes, b"DDS ");
    }

    #[test]
    fn a_chunk_hash_that_is_not_hex_is_an_invalid_path() {
        let err = AssetRef::GameChunk {
            wad: "Champions/Aatrox.wad.client".to_owned(),
            path_hash: "not a hash".to_owned(),
        }
        .read(&Config::default(), &WadCache::default())
        .unwrap_err();

        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn a_name_is_the_basename_or_the_hash() {
        let project = "C:/projects/skin".to_owned();
        assert_eq!(
            layer_ref(&project, "base", "assets/characters/icon.tex").name(),
            "icon.tex"
        );
        assert_eq!(
            AssetRef::GameChunk {
                wad: "UI.wad.client".to_owned(),
                path_hash: "0123456789abcdef".to_owned(),
            }
            .name(),
            "0123456789abcdef"
        );
    }
}
