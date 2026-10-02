//! A mod archive opened for reading, by its format.

use std::path::{Path, PathBuf};

use fs_err as fs;
use ltk_fantome::FantomeReader;
use ltk_mod_project::ModProject;
use ltk_modpkg::Modpkg;

use crate::error::{AppError, AppResult};
use crate::mods::index::ModArchiveFormat;

/// Open `path` as a `.fantome`, naming the archive in the failure.
///
/// # Errors
///
/// Fails when the file does not open or holds no fantome.
pub(crate) fn open_fantome(path: &Path) -> AppResult<FantomeReader<fs::File>> {
    FantomeReader::new(fs::File::open(path)?)
        .map_err(|e| AppError::Fantome(format!("Failed to open {}: {e}", path.display())))
}

/// Mount `path` as a `.modpkg`.
///
/// # Errors
///
/// Fails when the file does not open or holds no package.
pub(crate) fn open_modpkg(path: &Path) -> AppResult<Modpkg<fs::File>> {
    Ok(Modpkg::mount_from_reader(fs::File::open(path)?)?)
}

/// A mod archive, opened by its format.
pub(crate) enum ModArchive {
    Modpkg(Box<Modpkg<fs::File>>),
    Fantome(FantomeReader<fs::File>),
}

impl ModArchive {
    /// Open `path` as `format`. An `Unknown` opens as a fantome, the one format with an
    /// unpacked form.
    ///
    /// # Errors
    ///
    /// Fails when the file does not open as that format.
    pub(crate) fn open(path: &Path, format: ModArchiveFormat) -> AppResult<Self> {
        Ok(match format {
            ModArchiveFormat::Modpkg => Self::Modpkg(Box::new(open_modpkg(path)?)),
            ModArchiveFormat::Fantome | ModArchiveFormat::Unknown => {
                Self::Fantome(open_fantome(path)?)
            }
        })
    }

    /// The mod project the archive's own metadata describes. A fantome's `WAD_<layer>/`
    /// directory its metadata does not declare gets a layer.
    ///
    /// # Errors
    ///
    /// Fails when the metadata does not read.
    pub(crate) fn project(&mut self) -> AppResult<ModProject> {
        match self {
            Self::Modpkg(modpkg) => Ok(ltk_mod_project::modpkg::read_project(modpkg)?),
            Self::Fantome(reader) => {
                let mut info = reader
                    .read_info()
                    .map_err(|e| AppError::Other(format!("Failed to read META/info.json: {e}")))?;
                info.declare_layers(reader.layer_names().iter().map(String::as_str));
                Ok(ModProject::from(info))
            }
        }
    }

    /// Write the archive's thumbnail into `dir`, answering the file written, or `None` for
    /// an archive that carries none.
    ///
    /// # Errors
    ///
    /// Fails when a fantome's thumbnail does not read, or the file cannot be written.
    pub(crate) fn write_thumbnail(&mut self, dir: &Path) -> AppResult<Option<PathBuf>> {
        let (bytes, name) = match self {
            Self::Modpkg(modpkg) => match modpkg.load_thumbnail() {
                Ok(bytes) => (bytes, "thumbnail.webp"),
                Err(_) => return Ok(None),
            },
            Self::Fantome(reader) => match reader
                .read_image_png()
                .map_err(|e| AppError::Other(format!("Failed to read the thumbnail: {e}")))?
            {
                Some(png) => (png, "thumbnail.png"),
                None => return Ok(None),
            },
        };

        let dest = dir.join(name);
        fs::write(&dest, bytes)?;
        Ok(Some(dest))
    }
}
