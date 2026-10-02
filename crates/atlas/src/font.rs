//! The fonts and style sheets a text names, read out of the bins that declare them.

use ltk_hash::{BinHash, WadHash};
use ltk_manager_core::bin_document::{
    AssetLookup, BinDocument, Fields, Namer, RowNames, entries, fields_of, hex, items, link, text,
};
use ltk_meta::{BinObject, PropertyValueEnum};

use super::fields::*;
use super::model::{
    UiAsset, UiFont, UiFontCatalog, UiFontChoice, UiFontFace, UiFontResolution, UiFontSizes,
    UiStyleSheet, UiTextIcon, UiTextStyle,
};
use super::resolver::{chunk, color, file_hash, flag, number};
use super::view::UiViewError;

/// The bin every shipped `GameFontDescription`, `FontType` and `CSSSheet` sits in.
pub const FONTS_PATH: &str = "ux/fonts";

/// The locale a `FontLocaleType` or a `FontLocaleResolutions` names when it names none.
const DEFAULT_LOCALE: &str = "en_us";

/// The class default of every `GameFontDescription` colour.
const BLACK: [u8; 4] = [0, 0, 0, 255];

/// The `GameFontDescription` at `entry` of `document`, its links followed into `document` and
/// then into `fonts`, the game's `ux/fonts` where the caller could read it.
///
/// # Errors
///
/// Fails with [`UiViewError::NoObject`] when neither holds an object at `entry`.
pub fn resolve_font(
    document: &BinDocument,
    entry: BinHash,
    fonts: Option<&BinDocument>,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<UiFont, UiViewError> {
    let bins = FontBins::new([Some(document), fonts].into_iter().flatten().collect());
    bins.font(entry, &mut Namer::new(names), assets)
        .ok_or_else(|| UiViewError::NoObject(hex(entry)))
}

/// The bins a font link is looked up in, the first that holds it winning.
pub(super) struct FontBins<'d> {
    documents: Vec<&'d BinDocument>,
}

impl<'d> FontBins<'d> {
    pub(super) fn new(documents: Vec<&'d BinDocument>) -> Self {
        Self { documents }
    }

    fn object(&self, hash: BinHash) -> Option<&'d BinObject> {
        self.documents
            .iter()
            .find_map(|document| document.object_at(hash))
    }

    fn fields(&self, value: Option<&PropertyValueEnum>) -> Option<&'d Fields> {
        Some(&self.object(link(value)?)?.properties)
    }

    /// The `GameFontDescription` at `hash`, with its type and sizes followed.
    pub(super) fn font(
        &self,
        hash: BinHash,
        namer: &mut Namer<'_>,
        assets: &dyn AssetLookup,
    ) -> Option<UiFont> {
        let fields = &self.object(hash)?.properties;
        let type_data = self.fields(fields.get(&FONT_TYPE));
        let resolution_data = self.fields(fields.get(&FONT_RESOLUTIONS));

        Some(UiFont {
            path: namer.entry(hash).unwrap_or_else(|| hex(hash)),
            name: text(fields.get(&NAME)).unwrap_or_default().to_owned(),
            color: color(fields, COLOR).unwrap_or(BLACK),
            outline_color: color(fields, OUTLINE_COLOR).unwrap_or(BLACK),
            shadow_color: color(fields, SHADOW_COLOR).unwrap_or(BLACK),
            glow_color: color(fields, GLOW_COLOR).unwrap_or(BLACK),
            fill: file(fields.get(&FONT_FILL), namer, assets),
            faces: type_data.map_or_else(Vec::new, |fields| faces(fields, assets)),
            auto_scale: resolution_data
                .and_then(|fields| flag(fields, AUTO_SCALE))
                .unwrap_or(true),
            sizes: resolution_data.map_or_else(Vec::new, sizes),
        })
    }

    /// The `CSSSheet` at `hash`, and where its icons sit when no file holds them.
    pub(super) fn style_sheet(
        &self,
        hash: BinHash,
        namer: &mut Namer<'_>,
        assets: &dyn AssetLookup,
    ) -> Option<(UiStyleSheet, SheetAtlas)> {
        let fields = &self.object(hash)?.properties;

        let styles = entries(fields.get(&STYLES))
            .iter()
            .filter_map(|(key, value)| {
                let style = fields_of(Some(value))?;
                Some(UiTextStyle {
                    name: text(Some(key))?.to_owned(),
                    color: color(style, COLOR),
                    bold: flag(style, STYLE_BOLD),
                    italics: flag(style, STYLE_ITALICS),
                    underline: flag(style, STYLE_UNDERLINE),
                })
            })
            .collect();
        let (icons, keys) = entries(fields.get(&ICONS))
            .iter()
            .filter_map(|(key, value)| {
                let icon = fields_of(Some(value))?;
                let texture = icon.get(&ICON_TEXTURE);
                let read = UiTextIcon {
                    name: text(Some(key))?.to_owned(),
                    texture: file(texture, namer, assets),
                    uv: None,
                    y_adjustment: number(icon, ICON_Y_ADJUSTMENT).unwrap_or(0.0),
                };
                Some((read, file_hash(texture)))
            })
            .unzip();
        let manifest = file_hash(fields.get(&PATH_HASH_TO_SELF));

        let sheet = UiStyleSheet {
            path: namer.entry(hash).unwrap_or_else(|| hex(hash)),
            styles,
            icons,
        };
        Some((sheet, SheetAtlas { manifest, keys }))
    }
}

/// The sprite manifest a `CSSSheet` packs its icons into, its `PathHashToSelf`, and the sprite
/// key of each icon in the order the sheet lists them.
pub(super) struct SheetAtlas {
    pub(super) manifest: Option<u64>,
    pub(super) keys: Vec<Option<u64>>,
}

fn faces(type_data: &Fields, assets: &dyn AssetLookup) -> Vec<UiFontFace> {
    items(type_data.get(&LOCALE_TYPES))
        .iter()
        .filter_map(|item| {
            let fields = fields_of(Some(item))?;
            Some(UiFontFace {
                locale: locale(fields),
                regular: named_file(fields.get(&FONT_FILE), assets)?,
                bold: named_file(fields.get(&FONT_FILE_BOLD), assets),
            })
        })
        .collect()
}

fn sizes(resolution_data: &Fields) -> Vec<UiFontSizes> {
    items(resolution_data.get(&LOCALE_RESOLUTIONS))
        .iter()
        .filter_map(|item| {
            let fields = fields_of(Some(item))?;
            let resolutions = items(fields.get(&RESOLUTIONS))
                .iter()
                .filter_map(|item| fields_of(Some(item)))
                .map(|fields| UiFontResolution {
                    screen_height: number(fields, SCREEN_HEIGHT).map_or(1080, |n| n as u32),
                    font_size: number(fields, FONT_SIZE).map_or(10, |n| n as u32),
                    outline_size: number(fields, OUTLINE_SIZE).map_or(0, |n| n as u32),
                    shadow_depth: [
                        number(fields, SHADOW_DEPTH_X).map_or(0, |n| n as i32),
                        number(fields, SHADOW_DEPTH_Y).map_or(0, |n| n as i32),
                    ],
                })
                .collect();
            Some(UiFontSizes {
                locale: locale(fields),
                resolutions,
            })
        })
        .collect()
}

fn locale(fields: &Fields) -> String {
    text(fields.get(&LOCALE_NAME))
        .unwrap_or(DEFAULT_LOCALE)
        .to_lowercase()
}

/// A `file` field, found by the name a table gives its hash.
fn file(
    value: Option<&PropertyValueEnum>,
    namer: &mut Namer<'_>,
    assets: &dyn AssetLookup,
) -> Option<UiAsset> {
    let (path, asset) = chunk(namer, assets, WadHash(file_hash(value)?));
    Some(UiAsset { path, asset })
}

/// A path written as a string, found as written.
fn named_file(value: Option<&PropertyValueEnum>, assets: &dyn AssetLookup) -> Option<UiAsset> {
    let path = text(value).filter(|path| !path.is_empty())?;
    Some(UiAsset {
        path: path.to_owned(),
        asset: assets.locate(path),
    })
}

/// The fonts and faces of `document` and then of `fonts`, the game's `ux/fonts` where the
/// caller could read it. An object both hold is listed once, as the document's.
#[must_use]
pub fn font_catalog(
    document: &BinDocument,
    fonts: Option<&BinDocument>,
    names: &dyn RowNames,
) -> UiFontCatalog {
    let bins = FontBins::new([Some(document), fonts].into_iter().flatten().collect());
    let mut namer = Namer::new(names);
    let mut catalog = UiFontCatalog::default();
    let mut seen = std::collections::HashSet::new();

    for (at, bin) in bins.documents.iter().enumerate() {
        for entry in bin.entries() {
            let Some(object) = bin.object_at(entry) else {
                continue;
            };
            let list = match object.class_hash {
                class if class == GAME_FONT_DESCRIPTION => &mut catalog.fonts,
                class if class == FONT_TYPE_CLASS => &mut catalog.types,
                _ => continue,
            };
            if !seen.insert(entry) {
                continue;
            }

            let fields = &object.properties;
            let type_data = if object.class_hash == FONT_TYPE_CLASS {
                Some(fields)
            } else {
                bins.fields(fields.get(&FONT_TYPE))
            };
            list.push(UiFontChoice {
                entry: hex(entry),
                path: namer.entry(entry).unwrap_or_else(|| hex(entry)),
                name: text(fields.get(&NAME)).unwrap_or_default().to_owned(),
                face: type_data.and_then(first_face),
                locales: type_data.map_or(0, |fields| {
                    u32::try_from(items(fields.get(&LOCALE_TYPES)).len()).unwrap_or(u32::MAX)
                }),
                type_data: (object.class_hash == GAME_FONT_DESCRIPTION)
                    .then(|| link(fields.get(&FONT_TYPE)))
                    .flatten()
                    .map(hex),
                project: at == 0,
            });
        }
    }
    catalog
}

/// The regular file of the first locale `type_data` lists.
fn first_face(type_data: &Fields) -> Option<String> {
    items(type_data.get(&LOCALE_TYPES)).iter().find_map(|item| {
        let path = text(fields_of(Some(item))?.get(&FONT_FILE))?;
        (!path.is_empty()).then(|| path.to_owned())
    })
}
