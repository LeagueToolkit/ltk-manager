//! Atlas's writes into a project: a sprite or surface onto a sheet, a sprite pasted over a game
//! page, a font file, and a sprite exported for an image editor.

use std::path::Path;

use atlas::{
    import_font_file, import_sprite, import_surface, patch_sprite, patchable, png_pixels,
    read_sheet, sprite_pixels, sprite_png, PagePatch, PatchTarget, SheetImport, SheetSpec,
    SheetTarget,
};
use ltk_manager_core::bin_document::{BinDocumentError, BinDocumentId, BinDocuments};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::{SandboxRef, SandboxState};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult, IpcResult};
use crate::services::game::index::game_file;
use crate::services::shared::{off_thread, read_asset};

/// Where an edit of the document `document` writes: the project it opens in, the layer it writes
/// to, and its own asset.
struct WriteTarget {
    project: String,
    layer: String,
    asset: AssetRef,
}

impl WriteTarget {
    /// The target of `document`.
    ///
    /// # Errors
    ///
    /// Fails when the document is closed, opens in no project or writes to no layer.
    fn of(documents: &BinDocuments, document: BinDocumentId) -> AppResult<Self> {
        let project = project_of(documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or(BinDocumentError::NotOpen(document))?;
        let layer = layer_of(documents, document, &asset)?;

        Ok(Self {
            project,
            layer,
            asset,
        })
    }

    /// The archive folder the document's own asset sits under.
    ///
    /// # Errors
    ///
    /// Fails for a document in no archive.
    fn archive(&self) -> AppResult<String> {
        archive_of(&self.asset)
            .ok_or_else(|| AppError::ValidationFailed("The document is in no archive".to_owned()))
    }
}

/// Import the PNG at `source` into the sheet `sheet` of the project `document` opens in, or put
/// it in place of the sprite `replace`, per section 5 of docs/plans/atlas-ui-editor.md.
///
/// A new sheet's page lands in the layer the document declares into, and in the archive folder
/// its own bin comes from.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, when the image cannot be read, and
/// when the sheet would outgrow one page.
#[tauri::command]
#[specta::specta]
pub async fn atlas_import_sprite(
    document: BinDocumentId,
    sheet: String,
    source: String,
    replace: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<SheetImport> {
    off_thread(move || {
        let target = WriteTarget::of(&app_handle.state::<BinDocuments>(), document)?;
        let archive = target.archive()?;
        let WriteTarget { project, layer, .. } = &target;

        let target = SheetTarget {
            project: Path::new(project),
            sheet: &sheet,
            layer,
            archive: &archive,
        };
        let imported = import_sprite(&target, Path::new(&source), replace.as_deref())?;
        app_handle.state::<SandboxState>().invalidate(project);
        Ok(imported)
    })
    .await
}

/// Copy the `.ttf` or `.otf` at `source` into the layer and archive the document `document`
/// writes to, answering the path a `FontType` names it by.
///
/// # Errors
///
/// Fails when the document opens in no project or writes to no layer, for a file of another
/// type, and when the copy cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_import_font_file(
    document: BinDocumentId,
    source: String,
    app_handle: AppHandle,
) -> IpcResult<String> {
    off_thread(move || {
        let target = WriteTarget::of(&app_handle.state::<BinDocuments>(), document)?;
        let archive = target.archive()?;
        let WriteTarget { project, layer, .. } = &target;

        let named = import_font_file(Path::new(project), layer, &archive, Path::new(&source))?;
        app_handle.state::<SandboxState>().invalidate(project);
        Ok(named)
    })
    .await
}

/// What a surface is made from: an image file, or a sprite an element already draws.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SurfaceSource {
    File { path: String },
    Sprite { texture: AssetRef, uv: [f32; 4] },
}

/// Make a surface named `name` on the sheet `sheet` of the project `document` opens in, per
/// section 5 of docs/plans/atlas-ui-editor.md: the image of `source`, its slice lines found in it,
/// so it stretches to any element's size.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, when the image cannot be read, and
/// when the sheet would outgrow one page.
#[tauri::command]
#[specta::specta]
pub async fn atlas_make_surface(
    document: BinDocumentId,
    sheet: String,
    name: String,
    source: SurfaceSource,
    app_handle: AppHandle,
) -> IpcResult<SheetImport> {
    off_thread(move || {
        let target = WriteTarget::of(&app_handle.state::<BinDocuments>(), document)?;
        let archive = target.archive()?;
        let WriteTarget { project, layer, .. } = &target;

        let image = match source {
            SurfaceSource::File { path } => png_pixels(Path::new(&path))?,
            SurfaceSource::Sprite { texture, uv } => {
                sprite_pixels(&read_asset(&app_handle, &texture)?, uv)?
            }
        };
        let target = SheetTarget {
            project: Path::new(project),
            sheet: &sheet,
            layer,
            archive: &archive,
        };
        let made = import_surface(&target, &name, image)?;
        app_handle.state::<SandboxState>().invalidate(project);
        Ok(made)
    })
    .await
}

/// Paste the PNG at `source` over the sprite at `uv` of the game texture `page`, and rebuild the
/// page into the layer the document `document` writes to, per section 5 of
/// docs/plans/atlas-ui-editor.md. Every element naming a sprite of the page keeps its rect.
///
/// Answers none, writing nothing, where the game holds no `.tex` at `page` or the image is not the
/// sprite's size, which an import onto the project's sheet takes instead.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, and when the page or the image
/// cannot be read or the page cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_patch_sprite(
    document: BinDocumentId,
    page: String,
    uv: [f32; 4],
    source: String,
    app_handle: AppHandle,
) -> IpcResult<Option<PagePatch>> {
    off_thread(move || {
        if !patchable(&page) {
            return Ok(None);
        }

        let WriteTarget { project, layer, .. } =
            &WriteTarget::of(&app_handle.state::<BinDocuments>(), document)?;
        let Some((base, bytes)) = game_file(&app_handle, &page)? else {
            return Ok(None);
        };
        let archive = archive_of(&base)
            .ok_or_else(|| AppError::ValidationFailed("The page is in no archive".to_owned()))?;

        let path = page.to_lowercase();
        let target = PatchTarget {
            project: Path::new(project),
            path: &path,
            layer,
            archive: &archive,
        };
        let patched = patch_sprite(&target, &bytes, uv, Path::new(&source))?;
        if patched.is_some() {
            app_handle.state::<SandboxState>().invalidate(project);
        }
        Ok(patched)
    })
    .await
}

/// The spec of the sheet `sheet` of the project `document` opens in, none where it has not made
/// that sheet.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, and when the spec cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn atlas_sheet(
    document: BinDocumentId,
    sheet: String,
    app_handle: AppHandle,
) -> IpcResult<Option<SheetSpec>> {
    off_thread(move || {
        let project = project_of(&app_handle.state::<BinDocuments>(), document)?;
        read_sheet(Path::new(&project), &sheet)
    })
    .await
}

/// Write the sprite at `uv` on the page `texture` to `destination` as a PNG, at the page's own
/// resolution, for an image editor to open and the import to take back.
///
/// # Errors
///
/// Fails when the page cannot be read or decoded, when `uv` covers none of it, and when
/// `destination` cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_export_sprite(
    texture: AssetRef,
    uv: [f32; 4],
    destination: String,
    app_handle: AppHandle,
) -> IpcResult<()> {
    off_thread(move || {
        let page = read_asset(&app_handle, &texture)?;
        let png = sprite_png(&page, uv)?;
        fs_err::write(&destination, png)?;
        tracing::info!(destination = %destination, "Exported a sprite");
        Ok(())
    })
    .await
}

/// The layer an edit of the document `document` writes to: the one it declares into, else the
/// layer its own file sits in.
fn layer_of(
    documents: &BinDocuments,
    document: BinDocumentId,
    asset: &AssetRef,
) -> AppResult<String> {
    match (documents.declared_state(document)?, asset) {
        (Some(declared), _) => Ok(declared.layer),
        (None, AssetRef::Layer { layer, .. }) => Ok(layer.clone()),
        (None, _) => Err(AppError::ValidationFailed(
            "The document writes to no layer".to_owned(),
        )),
    }
}

fn project_of(documents: &BinDocuments, document: BinDocumentId) -> AppResult<String> {
    match documents.sandbox_of(document) {
        Some(SandboxRef::Project { project } | SandboxRef::Layer { project, .. }) => Ok(project),
        Some(SandboxRef::Game) => Err(AppError::ValidationFailed(
            "The document opens in no project".to_owned(),
        )),
        None => Err(BinDocumentError::NotOpen(document).into()),
    }
}

/// The archive folder a layer keeps an asset's archive under: a game chunk's archive file name,
/// or the first folder of a layer file's path.
fn archive_of(asset: &AssetRef) -> Option<String> {
    match asset {
        AssetRef::GameChunk { wad, .. } => {
            wad.replace('\\', "/").rsplit('/').next().map(str::to_owned)
        }
        AssetRef::Layer { path, .. } => path
            .replace('\\', "/")
            .split('/')
            .next()
            .filter(|archive| archive.contains(".wad"))
            .map(str::to_owned),
        AssetRef::File { .. } => None,
        AssetRef::LcuChunk { .. } => unreachable!("the bin store holds no client chunk"),
    }
}
