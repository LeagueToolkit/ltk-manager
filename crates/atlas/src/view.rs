//! A view controller resolved into one [`UiView`], per section 4.1 of
//! docs/plans/atlas-renderer.md.

use std::collections::HashMap;

use ltk_hash::{BinHash, WadHash};
use ltk_manager_core::bin_document::{
    AssetLookup, BinDocument, GameCopy, Namer, RowNames, fields_of, hex, leaf, link, text,
};
use ltk_manager_core::error::AppResult;
use ltk_manager_core::preview::AssetRef;
use ltk_meta::path::PropertyPath;
use ltk_meta::walk::Leaf;
use ltk_meta::{ApplyReport, Bin, BinObject, PropertyPatch};

use super::fields::*;
use super::font::{FONTS_PATH, FontBins, SheetAtlas};
use super::imaa::Manifest;
use super::model::{
    UiAsset, UiBinding, UiComboBox, UiElement, UiFile, UiFileRole, UiRepeat, UiScene, UiStyleSheet,
    UiTextIcon, UiTooltip, UiVariant, UiVariantRecord, UiView, UiViewWarning,
};
use super::resolver::{self, ViewResolver, chunk, file_hash, flag, number, position};
use super::sprite_key;
use super::{bindings, tooltip};

/// Why an object cannot be read as a view.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum UiViewError {
    #[error("The document has no object {0}")]
    NoObject(String),
}

/// The variant a view draws over its base: the override loadable in `slot`, read from `open`
/// where that document is open.
#[derive(Debug, Clone, Copy)]
pub struct VariantChoice<'a> {
    /// The controller field that links it, as [`UiFile::slot`] names it.
    pub slot: &'a str,
    pub open: Option<&'a BinDocument>,
}

/// A view controller and everything its base loadable holds, or a `UiPropertyLoadable` drawn as
/// the base of the controller that links it.
///
/// A loadable no controller of `document` links draws alone, with the manifest of the folder its
/// file sits in. `read` answers the bytes of an asset `assets` locates, which is how the scene
/// bin and the manifest are reached. A reference the read cannot follow is a warning on the view.
///
/// `scene` is the base scene bin where it is open, so the view draws its edits before they are
/// saved. Without it the base is read through `read`. `variant` names a variant to lay over the
/// base, as the client lays a switched-on override. A base loadable another bin declares is read
/// from the chunk `game` answers for it.
///
/// # Errors
///
/// Fails with [`UiViewError::NoObject`] when `document` has no object at `entry`.
#[allow(clippy::too_many_arguments)]
pub fn resolve_view(
    document: &BinDocument,
    entry: BinHash,
    scene: Option<&BinDocument>,
    variant: Option<VariantChoice<'_>>,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    game: &dyn GameCopy,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Result<UiView, UiViewError> {
    let object = document
        .object_at(entry)
        .ok_or_else(|| UiViewError::NoObject(hex(entry)))?;
    let mut namer = Namer::new(names);
    let mut warnings = Vec::new();

    let (controller, base) = if object.class_hash == PROPERTY_LOADABLE {
        (controller_of(document, entry), Some(entry))
    } else {
        (Some(object), base_link(object))
    };
    let elsewhere = match base {
        Some(base) if controller.is_some() && document.object_at(base).is_none() => {
            declaring_bin(base, game, &mut warnings)
        }
        _ => None,
    };
    let files = match controller {
        Some(controller) => loadables(
            document,
            elsewhere.as_ref(),
            controller,
            base,
            &mut namer,
            assets,
        ),
        None => own_file(object, entry, &mut namer, assets)
            .into_iter()
            .collect(),
    };
    let folder_hash = match controller {
        Some(controller) => file_hash(controller.properties.get(&PATH_HASH_TO_SELF)),
        None => files.first().and_then(|file| folder_of(&file.path)),
    };
    let read_base;
    let base = match files.iter().find(|file| file.role == UiFileRole::Base) {
        Some(_) if scene.is_some() => scene,
        Some(file) => {
            read_base = read_bin(&file.path, file.asset.as_ref(), read, &mut warnings);
            read_base.as_ref()
        }
        None => {
            let unreached = warnings
                .iter()
                .any(|warning| matches!(warning, UiViewWarning::BaseElsewhere { .. }));
            if !unreached {
                warnings.push(UiViewWarning::NoBase);
            }
            None
        }
    };

    /* A declared variant is its base with the variant laid over already, so it draws as it
    stands in place of the base. */
    let declared = variant.and_then(|choice| {
        let open = choice.open?;
        let laid = open.laid_variant()?;
        let file = override_file(&files, choice.slot, &mut warnings)?;
        Some((open, drawn_of(file, &laid.records, laid.report.clone())))
    });
    let (merged, drawn, base) = match declared {
        Some((open, drawn)) => (None, Some(drawn), Some(open)),
        None => match variant
            .and_then(|choice| lay_variant(choice, base?, &files, read, &mut warnings))
        {
            Some((merged, drawn)) => (Some(merged), Some(drawn), base),
            None => (None, None, base),
        },
    };
    let objects = match &merged {
        Some(merged) => merged.objects.values().collect(),
        None => base.map(objects_of).unwrap_or_default(),
    };

    let head = ViewHead {
        entry,
        name: namer.entry(entry),
        class: namer
            .class(object.class_hash)
            .unwrap_or_else(|| hex(object.class_hash)),
        repeats: controller
            .map(|controller| resolver::repeats(&controller.properties))
            .unwrap_or_default(),
        bindings: controller
            .map(|controller| bindings::bindings(&controller.properties, controller.class_hash))
            .unwrap_or_default(),
        tooltip: controller.and_then(|controller| tooltip::tooltip(&controller.properties)),
    };
    Ok(assemble(
        head,
        &objects,
        files,
        drawn,
        folder_hash,
        namer,
        assets,
        read,
        warnings,
    ))
}

/// A scene bin drawn as a view of its own: every scene and element `document` declares, with
/// the manifest of the folder its file `path` sits in. `entry` is the object the view is read
/// for, which names it.
///
/// This is how one element previews without its controller, and it draws the open document as
/// it stands, edits included.
///
/// # Errors
///
/// Fails with [`UiViewError::NoObject`] when `document` has no object at `entry`.
pub fn resolve_scene_bin(
    document: &BinDocument,
    entry: BinHash,
    path: &str,
    asset: Option<AssetRef>,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Result<UiView, UiViewError> {
    let object = document
        .object_at(entry)
        .ok_or_else(|| UiViewError::NoObject(hex(entry)))?;
    let mut namer = Namer::new(names);

    let files = vec![UiFile {
        slot: String::new(),
        role: UiFileRole::Base,
        path: path.to_owned(),
        asset,
    }];
    let head = ViewHead {
        entry,
        name: namer.entry(entry),
        class: namer
            .class(object.class_hash)
            .unwrap_or_else(|| hex(object.class_hash)),
        repeats: Vec::new(),
        bindings: Vec::new(),
        tooltip: None,
    };
    Ok(assemble(
        head,
        &objects_of(document),
        files,
        None,
        folder_of(path),
        namer,
        assets,
        read,
        Vec::new(),
    ))
}

/// What a view is named for: the object it was read for, and what its controller clones.
struct ViewHead {
    entry: BinHash,
    name: Option<String>,
    class: String,
    repeats: Vec<UiRepeat>,
    bindings: Vec<UiBinding>,
    tooltip: Option<UiTooltip>,
}

/// The view the base's `objects` draw: its scenes and elements resolved against the manifest
/// `folder_hash` names and the game's fonts.
#[allow(clippy::too_many_arguments)]
fn assemble(
    head: ViewHead,
    objects: &[&BinObject],
    files: Vec<UiFile>,
    variant: Option<UiVariant>,
    folder_hash: Option<u64>,
    mut namer: Namer<'_>,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    mut warnings: Vec<UiViewWarning>,
) -> UiView {
    let folder = folder_hash.and_then(|hash| namer.chunk(WadHash(hash)));

    /* A view with no `LooseUiTextureData` ships no manifest, so an absent one is no warning. A
    sprite it would have held is. */
    let manifest = folder_hash.and_then(|hash| {
        let (path, asset) = chunk(&mut namer, assets, WadHash(hash));
        let bytes = read_file(&path, Some(&asset?), read, &mut warnings)?;
        Manifest::read(&bytes)
            .inspect_err(|e| {
                warnings.push(UiViewWarning::UnreadableFile {
                    path: path.clone(),
                    reason: e.to_string(),
                });
            })
            .ok()
    });

    let fonts = if objects.iter().any(|object| object.class_hash == TEXT) {
        read_bin(
            FONTS_PATH,
            assets.locate(FONTS_PATH).as_ref(),
            read,
            &mut warnings,
        )
    } else {
        None
    };

    let font_bins = FontBins::new(fonts.iter().collect());
    let mut resolver = ViewResolver::new(namer, assets, manifest, font_bins);
    let mut scenes = Vec::new();
    let mut elements = Vec::new();
    let mut combo_boxes = Vec::new();
    for &object in objects {
        if SCENE_CLASSES.contains(&object.class_hash) {
            scenes.push(scene(object, &mut resolver.namer));
        } else if object.class_hash == COMBO_BOX {
            combo_boxes.push(combo_box(object, &mut resolver.namer));
        } else if is_element(object) {
            elements.push(element(object, &mut resolver));
        }
    }

    let mut style_sheets = std::mem::take(&mut resolver.style_sheets);
    for (sheet, atlas) in style_sheets.iter_mut().zip(&resolver.sheet_atlases) {
        place_icons(
            sheet,
            atlas,
            &mut resolver.namer,
            assets,
            read,
            &mut warnings,
        );
    }

    warnings.append(&mut resolver.warnings);
    UiView {
        entry: hex(head.entry),
        name: head.name,
        class: head.class,
        folder,
        files,
        variant,
        scenes,
        elements,
        combo_boxes,
        tooltip: head.tooltip,
        textures: resolver.textures,
        fonts: resolver.fonts,
        style_sheets,
        repeats: head.repeats,
        bindings: head.bindings,
        warnings,
    }
}

/// The controller of `document` that links the loadable `entry` from one of its own fields.
fn controller_of(document: &BinDocument, entry: BinHash) -> Option<&BinObject> {
    document
        .entries()
        .filter_map(|at| document.object_at(at))
        .find(|object| {
            object.properties.contains_key(&PATH_HASH_TO_SELF)
                && object
                    .properties
                    .values()
                    .any(|value| link(Some(value)) == Some(entry))
        })
}

/// A lone loadable's own file, as the base.
fn own_file(
    loadable: &BinObject,
    entry: BinHash,
    namer: &mut Namer<'_>,
    assets: &dyn AssetLookup,
) -> Option<UiFile> {
    let hash = file_hash(loadable.properties.get(&FILEPATH_HASH))?;
    let (path, asset) = chunk(namer, assets, WadHash(hash));
    Some(UiFile {
        slot: namer.entry(entry).unwrap_or_else(|| hex(entry)),
        role: UiFileRole::Base,
        path,
        asset,
    })
}

/// The manifest hash of the folder a named scene bin sits in, which is the path a controller's
/// `PathHashToSelf` names.
fn folder_of(path: &str) -> Option<u64> {
    let (folder, _) = path.rsplit_once('/')?;
    Some(sprite_key(folder))
}

/// The loadable a controller draws as its base: its `BaseLoadable`, else its `Loadable`.
fn base_link(controller: &BinObject) -> Option<BinHash> {
    link(controller.properties.get(&BASE_LOADABLE))
        .or_else(|| link(controller.properties.get(&LOADABLE)))
}

/// The bin `game` answers as declaring `entry`, a base loadable the controller's own bin does
/// not hold, with a warning where it answers none or the bin cannot be read.
fn declaring_bin(
    entry: BinHash,
    game: &dyn GameCopy,
    warnings: &mut Vec<UiViewWarning>,
) -> Option<BinDocument> {
    let unreadable = |reason: String| UiViewWarning::UnreadableFile {
        path: hex(entry),
        reason,
    };
    let bytes = match game.declaring_chunk(entry) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            warnings.push(UiViewWarning::BaseElsewhere { entry: hex(entry) });
            return None;
        }
        Err(e) => {
            warnings.push(unreadable(e.to_string()));
            return None;
        }
    };

    BinDocument::parse(bytes)
        .inspect_err(|e| warnings.push(unreadable(e.to_string())))
        .ok()
}

/// Every loadable the controller links, `base` first and the rest in field order. A link
/// `document` does not hold is looked up in `elsewhere`, the bin declaring the base.
fn loadables(
    document: &BinDocument,
    elsewhere: Option<&BinDocument>,
    controller: &BinObject,
    base: Option<BinHash>,
    namer: &mut Namer<'_>,
    assets: &dyn AssetLookup,
) -> Vec<UiFile> {
    let mut files: Vec<UiFile> = controller
        .properties
        .iter()
        .filter_map(|(field, value)| {
            let target = link(Some(value))?;
            let loadable = document
                .object_at(target)
                .or_else(|| elsewhere?.object_at(target))?;
            let role = match loadable.class_hash {
                _ if Some(target) == base => UiFileRole::Base,
                PROPERTY_LOADABLE => UiFileRole::Loadable,
                OVERRIDE_LOADABLE => UiFileRole::Override,
                _ => return None,
            };
            let hash = file_hash(loadable.properties.get(&FILEPATH_HASH))?;
            let (path, asset) = chunk(namer, assets, WadHash(hash));
            Some(UiFile {
                slot: namer.field(*field).unwrap_or_else(|| hex(*field)),
                role,
                path,
                asset,
            })
        })
        .collect();

    files.sort_by_key(|file| file.role != UiFileRole::Base);
    files
}

/// The bytes of a chunk, or none with a warning where it is missing or unreadable.
fn read_file(
    path: &str,
    asset: Option<&AssetRef>,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    warnings: &mut Vec<UiViewWarning>,
) -> Option<Vec<u8>> {
    let Some(asset) = asset else {
        warnings.push(UiViewWarning::MissingFile {
            path: path.to_owned(),
        });
        return None;
    };

    read(asset)
        .inspect_err(|e| {
            warnings.push(UiViewWarning::UnreadableFile {
                path: path.to_owned(),
                reason: e.to_string(),
            });
        })
        .ok()
}

/// `sheet`'s icons that no file holds, placed on the pages of the sprite manifest the sheet
/// packs them into, as the client draws them.
fn place_icons(
    sheet: &mut UiStyleSheet,
    atlas: &SheetAtlas,
    namer: &mut Namer<'_>,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    warnings: &mut Vec<UiViewWarning>,
) {
    let unplaced = |icon: &UiTextIcon| {
        icon.texture
            .as_ref()
            .is_none_or(|file| file.asset.is_none())
    };
    if !sheet.icons.iter().any(unplaced) {
        return;
    }
    let Some(hash) = atlas.manifest else {
        return;
    };

    let (path, asset) = chunk(namer, assets, WadHash(hash));
    let Some(bytes) = read_file(&path, asset.as_ref(), read, warnings) else {
        return;
    };
    let Ok(manifest) = Manifest::read(&bytes) else {
        warnings.push(UiViewWarning::UnreadableFile {
            path,
            reason: "not a sprite manifest".to_owned(),
        });
        return;
    };

    for (icon, key) in sheet.icons.iter_mut().zip(&atlas.keys) {
        if !unplaced(icon) {
            continue;
        }
        let Some(entry) = key.and_then(|key| manifest.find(key)) else {
            continue;
        };
        let Some(&page) = manifest.pages.get(entry.page as usize) else {
            continue;
        };

        let (path, asset) = chunk(namer, assets, WadHash(page));
        icon.texture = Some(UiAsset { path, asset });
        icon.uv = Some(
            entry
                .uv
                .map(|value| if value.is_finite() { value } else { 0.0 }),
        );
    }
}

/// The bin at `path`, and a warning where it cannot be read or parsed.
fn read_bin(
    path: &str,
    asset: Option<&AssetRef>,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    warnings: &mut Vec<UiViewWarning>,
) -> Option<BinDocument> {
    let bytes = read_file(path, asset, read, warnings)?;
    BinDocument::parse(bytes)
        .inspect_err(|e| {
            warnings.push(UiViewWarning::UnreadableFile {
                path: path.to_owned(),
                reason: e.to_string(),
            });
        })
        .ok()
}

/// Every object of `document`, in file order.
fn objects_of(document: &BinDocument) -> Vec<&BinObject> {
    document
        .entries()
        .filter_map(|at| document.object_at(at))
        .collect()
}

/// `base` with the variant `choice` names laid over it, and what laying it did.
fn lay_variant(
    choice: VariantChoice<'_>,
    base: &BinDocument,
    files: &[UiFile],
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    warnings: &mut Vec<UiViewWarning>,
) -> Option<(Bin, UiVariant)> {
    let file = override_file(files, choice.slot, warnings)?;
    let read_variant;
    let variant = match choice.open {
        Some(open) => open,
        None => {
            read_variant = read_bin(&file.path, file.asset.as_ref(), read, warnings)?;
            &read_variant
        }
    };
    let Some((merged, report)) = base.with_variant(variant) else {
        warnings.push(UiViewWarning::NotAPatch {
            path: file.path.clone(),
        });
        return None;
    };

    Some((merged, drawn_of(file, variant.records(), report)))
}

/// The override loadable in `slot`, and a warning where the controller has none there.
fn override_file<'a>(
    files: &'a [UiFile],
    slot: &str,
    warnings: &mut Vec<UiViewWarning>,
) -> Option<&'a UiFile> {
    let file = files
        .iter()
        .find(|file| file.role == UiFileRole::Override && file.slot == slot);
    if file.is_none() {
        warnings.push(UiViewWarning::UnknownVariant {
            slot: slot.to_owned(),
        });
    }
    file
}

/// The variant in `file` as drawn: its `records`, and what laying them did.
fn drawn_of(file: &UiFile, records: &[PropertyPatch], report: ApplyReport) -> UiVariant {
    let mut skipped: HashMap<usize, String> = report
        .skipped
        .into_iter()
        .map(|record| (record.index, record.error.to_string()))
        .collect();
    let records = records
        .iter()
        .enumerate()
        .map(|(index, record)| UiVariantRecord {
            object: hex(record.object_hash),
            path: record.path.as_str().to_owned(),
            fields: hash_fields(&record.path),
            skipped: skipped.remove(&index),
        })
        .collect();

    UiVariant {
        slot: file.slot.clone(),
        records,
        added: report.added.into_iter().map(hex).collect(),
        deleted: report.deleted.into_iter().map(hex).collect(),
    }
}

/// A record's property path in hash path segments: each field as eight hex digits, each subscript as
/// written.
fn hash_fields(path: &PropertyPath) -> String {
    let segments: Vec<String> = path
        .segments()
        .map(|segment| {
            let field = &hex(segment.name_hash())[2..];
            match &segment.subscript {
                Some(subscript) => format!("{field}{subscript}"),
                None => field.to_owned(),
            }
        })
        .collect();
    segments.join(".")
}

/// An object of a scene bin that is an element: one that names a scene or a position, or is
/// of a class the read knows.
fn is_element(object: &BinObject) -> bool {
    let fields = &object.properties;
    fields.contains_key(&SCENE)
        || fields.contains_key(&POSITION)
        || GROUP_CLASSES.contains(&object.class_hash)
        || [ICON, TEXT, PARTICLE, REGION, SCISSOR, SPINE].contains(&object.class_hash)
}

fn combo_box(object: &BinObject, namer: &mut Namer<'_>) -> UiComboBox {
    let fields = &object.properties;
    let element = |field| resolver::object(fields.get(&field)).map(hex);
    let named = |text: Option<&str>| text.filter(|text| !text.is_empty()).map(str::to_owned);
    let sounds = fields_of(fields.get(&COMBO_SOUNDS));

    UiComboBox {
        key: hex(object.path_hash),
        path: namer.entry(object.path_hash),
        button: element(COMBO_BUTTON),
        backdrop: element(COMBO_BACKDROP),
        hover: element(COMBO_HOVER),
        highlight: element(COMBO_HIGHLIGHT),
        option_text: element(COMBO_OPTION_TEXT),
        option_hit_area: element(COMBO_OPTION_HIT_AREA),
        upward: number(fields, COMBO_DIRECTION) == Some(1.0),
        label_key: named(text(fields.get(&COMBO_LABEL_KEY))),
        selection_sound: named(sounds.and_then(|sounds| text(sounds.get(&COMBO_SELECTION_SOUND)))),
    }
}

fn scene(object: &BinObject, namer: &mut Namer<'_>) -> UiScene {
    let fields = &object.properties;
    UiScene {
        key: hex(object.path_hash),
        path: namer.entry(object.path_hash),
        label: label(object),
        class: namer
            .class(object.class_hash)
            .unwrap_or_else(|| hex(object.class_hash)),
        parent: link(fields.get(&PARENT_SCENE)).map(hex),
        layer: number(fields, LAYER).unwrap_or(0.0) as u32,
        enabled: flag(fields, ENABLED).unwrap_or(false),
        inherit_scissoring: flag(fields, INHERIT_SCISSORING).unwrap_or(true),
    }
}

fn element(object: &BinObject, resolver: &mut ViewResolver<'_>) -> UiElement {
    let fields = &object.properties;
    UiElement {
        key: hex(object.path_hash),
        path: resolver.namer.entry(object.path_hash),
        label: label(object),
        class: resolver
            .namer
            .class(object.class_hash)
            .unwrap_or_else(|| hex(object.class_hash)),
        scene: link(fields.get(&SCENE)).map(hex),
        layer: number(fields, LAYER).unwrap_or(0.0) as u32,
        enabled: flag(fields, ENABLED).unwrap_or(false),
        position: position(fields),
        look: resolver.look(object.path_hash, object.class_hash, fields),
    }
}

fn label(object: &BinObject) -> String {
    match leaf(object.properties.get(&NAME)) {
        Some(Leaf::String(name)) => name.to_owned(),
        _ => String::new(),
    }
}
