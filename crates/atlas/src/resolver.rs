//! Each element's position and look, read out of its fields with the class defaults filled.

use std::collections::HashMap;

use ltk_hash::{BinHash, WadHash};
use ltk_manager_core::bin_document::{
    AssetLookup, Fields, Namer, fields_of, hex, items, leaf, link, optional, struct_of, text,
};
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;

use super::fields::*;
use super::font::{FontBins, SheetAtlas};
use super::imaa::Manifest;
use super::model::{
    UiAnchor, UiButton, UiButtonState, UiEffect, UiFont, UiLayout, UiLayoutKind, UiLook, UiMeter,
    UiMeterTip, UiPosition, UiRect, UiRepeat, UiSlice, UiSliceKind, UiSprite, UiStyleSheet,
    UiTexture, UiTipStyle, UiViewWarning,
};
use super::sprite_key;

const WHITE: [u8; 4] = [255; 4];

/// The state one `resolve_view` call resolves elements against: the names, the assets and
/// the view's manifest, and the texture table and warnings it builds.
pub(super) struct ViewResolver<'a> {
    pub(super) namer: Namer<'a>,
    pub(super) assets: &'a dyn AssetLookup,
    pub(super) manifest: Option<Manifest>,
    pub(super) textures: Vec<UiTexture>,
    pub(super) fonts: Vec<UiFont>,
    pub(super) style_sheets: Vec<UiStyleSheet>,
    /// Where the icons of each of `style_sheets` sit, one for one.
    pub(super) sheet_atlases: Vec<SheetAtlas>,
    pub(super) warnings: Vec<UiViewWarning>,
    font_bins: FontBins<'a>,
    /// The index into `textures` of each texture's path hash.
    texture_index: HashMap<u64, usize>,
    /// The index into `fonts` or `style_sheets` of each linked object.
    font_index: HashMap<u32, Option<usize>>,
    style_sheet_index: HashMap<u32, Option<usize>>,
}

impl<'a> ViewResolver<'a> {
    pub(super) fn new(
        namer: Namer<'a>,
        assets: &'a dyn AssetLookup,
        manifest: Option<Manifest>,
        font_bins: FontBins<'a>,
    ) -> Self {
        Self {
            namer,
            assets,
            manifest,
            textures: Vec::new(),
            fonts: Vec::new(),
            style_sheets: Vec::new(),
            sheet_atlases: Vec::new(),
            warnings: Vec::new(),
            font_bins,
            texture_index: HashMap::new(),
            font_index: HashMap::new(),
            style_sheet_index: HashMap::new(),
        }
    }

    /// The look of an element of class `class` with the fields `fields`.
    pub(super) fn look(&mut self, key: BinHash, class: BinHash, fields: &Fields) -> UiLook {
        if class == ICON {
            return UiLook::Icon {
                sprite: self.sprite(key, fields),
                color: color(fields, COLOR).unwrap_or(WHITE),
                use_alpha: flag(fields, USE_ALPHA).unwrap_or(true),
                flip: [flag_or(fields, FLIP_X), flag_or(fields, FLIP_Y)],
                per_pixel_uvs: [
                    flag_or(fields, PER_PIXEL_UVS_X),
                    flag_or(fields, PER_PIXEL_UVS_Y),
                ],
                fill_type: number(fields, FILL_TYPE).unwrap_or(0.0) as u32,
                material: self.linked(fields, MATERIAL),
            };
        }

        if let Some(effect) = self.effect(class, fields) {
            let flip_x = flag(fields, M_FLIP_X).or_else(|| flag(fields, FLIP_X));
            let flip_y = flag(fields, M_FLIP_Y).or_else(|| flag(fields, FLIP_Y));
            let per_pixel =
                flag(fields, M_PER_PIXEL_UVS_X).or_else(|| flag(fields, PER_PIXEL_UVS_X));
            return UiLook::Effect {
                effect,
                sprite: self.sprite(key, fields),
                flip: [flip_x.unwrap_or(false), flip_y.unwrap_or(false)],
                per_pixel_uvs_x: per_pixel.unwrap_or(false),
            };
        }

        if class == TEXT {
            return UiLook::Text {
                font: self.font(key, fields),
                style_sheet: self.style_sheet(key, fields),
                tra_key: match leaf(fields.get(&TRA_KEY)) {
                    Some(Leaf::String(text)) => text.to_owned(),
                    _ => String::new(),
                },
                align: [
                    number(fields, ALIGN_HORIZONTAL).unwrap_or(0.0) as u8,
                    number(fields, ALIGN_VERTICAL).unwrap_or(1.0) as u8,
                ],
                wrap: number(fields, WRAPPING_MODE).unwrap_or(0.0) as u8,
                flip_for_rtl: flag_or(fields, FLIP_FOR_RTL),
                icon_scale: number(fields, ICON_SCALE).unwrap_or(1.0),
                min_scale: number(fields, MIN_TEXT_SCALE).unwrap_or(0.7),
                color: color(fields, COLOR),
            };
        }

        if class == PARTICLE {
            return UiLook::Particle {
                system: self.linked(fields, VFX_SYSTEM),
                scale: number(fields, VFX_SCALE).unwrap_or(1.0),
                at_element_layer: flag(fields, RENDER_AT_ELEMENT_LAYER).unwrap_or(true),
            };
        }

        if class == REGION {
            return UiLook::Region;
        }
        if class == SCISSOR {
            return UiLook::Scissor {
                scene: link(fields.get(&SCENE_TO_SCISSOR)).map(hex),
            };
        }
        if class == SPINE {
            return UiLook::Spine;
        }

        if GROUP_CLASSES.contains(&class) || fields.contains_key(&ELEMENTS) {
            return UiLook::Group {
                children: links(fields, ELEMENTS),
                states: self.button_states(fields),
                alpha: number(fields, ALPHA).unwrap_or(1.0),
                layout: layout(fields),
                button: (class == GROUP_BUTTON).then(|| button(fields)),
                meter: (class == GROUP_METER).then(|| meter(fields)),
            };
        }

        UiLook::Unknown
    }

    /// The effect class `class` is, with its fields, or none for a class that is no effect.
    fn effect(&mut self, class: BinHash, fields: &Fields) -> Option<UiEffect> {
        let float = |field, default| number(fields, field).unwrap_or(default);
        let colors = || {
            (
                color(fields, EFFECT_COLOR_0).unwrap_or(WHITE),
                color(fields, EFFECT_COLOR_1).unwrap_or(WHITE),
            )
        };

        let effect = match class {
            COOLDOWN => {
                let (color0, color1) = colors();
                UiEffect::Cooldown { color0, color1 }
            }
            AMMO => {
                let (color0, color1) = colors();
                UiEffect::Ammo { color0, color1 }
            }
            CIRCLE_MASK_COOLDOWN => {
                let (color0, color1) = colors();
                UiEffect::CircleMaskCooldown { color0, color1 }
            }
            COOLDOWN_RADIAL => UiEffect::CooldownRadial {
                fill: flag_or(fields, IS_FILL),
            },
            ARC_FILL => UiEffect::ArcFill,
            GLOW => UiEffect::Glow {
                cycle_time: float(CYCLE_TIME, 0.0),
                base_scale: float(BASE_SCALE, 0.0),
                cycle_scale: float(CYCLE_SCALE, 0.0),
                minimum_alpha: float(MINIMUM_ALPHA, 0.0),
            },
            GLOW_CONSTANT => UiEffect::GlowConstant {
                minimum: float(MINIMUM_GLOW, 0.0),
                maximum: float(MAXIMUM_GLOW, 2.0),
            },
            ANIMATION => UiEffect::Animation {
                frames: float(TOTAL_FRAMES, 0.0),
                per_row: float(FRAMES_PER_ROW, 0.0),
                fps: float(FRAMES_PER_SECOND, 0.0),
                finish: float(FINISH_BEHAVIOR, 0.0) as u8,
            },
            ANIMATED_ROTATING_ICON => UiEffect::AnimatedRotatingIcon {
                frames: float(TOTAL_FRAMES, 0.0),
                per_row: float(FRAMES_PER_ROW, 0.0),
                fps: float(FRAMES_PER_SECOND, 0.0),
            },
            FILL_PERCENTAGE => UiEffect::FillPercentage,
            DESATURATE => UiEffect::Desaturate {
                minimum: float(MINIMUM_SATURATION, 0.0),
                maximum: float(MAXIMUM_SATURATION, 1.0),
            },
            CIRCLE_MASK_DESATURATE => UiEffect::CircleMaskDesaturate {
                minimum: float(MINIMUM_SATURATION, 0.0),
                maximum: float(MAXIMUM_SATURATION, 1.0),
            },
            LINE => UiEffect::Line {
                thickness: float(THICKNESS, 1.0),
                right_slice: float(RIGHT_SLICE, 0.9),
            },
            ROTATING_ICON => UiEffect::RotatingIcon,
            GLOWING_ROTATING_ICON => UiEffect::GlowingRotatingIcon {
                brightness: float(BRIGHTNESS, 0.0),
                cycle_time: float(CYCLE_TIME, 0.0),
            },
            INSTANCED => UiEffect::Instanced {
                color: color(fields, M_COLOR).unwrap_or(WHITE),
            },
            CUSTOM_MATERIAL => UiEffect::CustomMaterial {
                material: self.linked(fields, M_MATERIAL),
            },
            _ => return None,
        };
        Some(effect)
    }

    /// Every `UiElementGroupButtonState` and `UiElementGroupSliderState` the group holds, by
    /// field name. A slider state lists its backdrop and its thumb.
    fn button_states(&mut self, fields: &Fields) -> Vec<UiButtonState> {
        fields
            .iter()
            .filter_map(|(field, value)| {
                let (class, state) = struct_of(Some(value))?;
                let (elements, text, text_frame) = if class == BUTTON_STATE {
                    (
                        links(state, DISPLAY_ELEMENT_LIST),
                        object(state.get(&STATE_TEXT)).map(hex),
                        object(state.get(&STATE_TEXT_FRAME)).map(hex),
                    )
                } else if class == SLIDER_STATE {
                    let elements = [SLIDER_BACKDROP, SLIDER_ICON]
                        .iter()
                        .filter_map(|part| object(state.get(part)).map(hex))
                        .collect();
                    (elements, None, None)
                } else {
                    return None;
                };

                Some(UiButtonState {
                    state: self.namer.field(*field).unwrap_or_else(|| hex(*field)),
                    elements,
                    text,
                    text_frame,
                })
            })
            .collect()
    }

    /// The object `field` links, by path where a table names it and as hex otherwise.
    fn linked(&mut self, fields: &Fields, field: BinHash) -> Option<String> {
        let target = link(fields.get(&field))?;
        Some(self.namer.entry(target).unwrap_or_else(|| hex(target)))
    }

    /// The sprite `TextureData` names, and none where it names none or its page is unknown.
    fn sprite(&mut self, element: BinHash, fields: &Fields) -> Option<UiSprite> {
        let (class, data) = struct_of(fields.get(&TEXTURE_DATA))?;

        match class {
            ATLAS | ATLAS_3_SLICE_H | ATLAS_3_SLICE_V | ATLAS_9_SLICE => {
                self.sheet_sprite(class, data)
            }
            LOOSE | LOOSE_3_SLICE_H | LOOSE_3_SLICE_V | LOOSE_9_SLICE => {
                self.page_sprite(element, class, data)
            }
            _ => None,
        }
    }

    /// An `AtlasData` sprite: a pixel rect on a sheet, normalized by the size it was
    /// authored against, and taken as normalized where either side of that size is 0.
    fn sheet_sprite(&mut self, class: BinHash, data: &Fields) -> Option<UiSprite> {
        let hash = file_hash(data.get(&TEXTURE_NAME_ATLAS))?;
        let width = number(data, TEXTURE_SOURCE_WIDTH).unwrap_or(0.0);
        let height = number(data, TEXTURE_SOURCE_HEIGHT).unwrap_or(0.0);
        let (scale_u, scale_v) = if width > 0.0 && height > 0.0 {
            (1.0 / width, 1.0 / height)
        } else {
            (1.0, 1.0)
        };
        let us = || vector(data, TEXTURE_US).map(|us| us.iter().map(|u| u * scale_u).collect());
        let vs = || vector(data, TEXTURE_VS).map(|vs| vs.iter().map(|v| v * scale_v).collect());
        let widths = pair(data, LEFT_RIGHT_WIDTHS);
        let heights = pair(data, TOP_BOTTOM_HEIGHTS);

        let slice = match class {
            ATLAS_3_SLICE_H => Some(UiSlice {
                kind: UiSliceKind::Horizontal,
                us: us(),
                vs: vs(),
                edges: [widths[0], widths[1], 0.0, 0.0],
            }),
            ATLAS_3_SLICE_V => Some(UiSlice {
                kind: UiSliceKind::Vertical,
                us: us(),
                vs: vs(),
                edges: [0.0, 0.0, heights[0], heights[1]],
            }),
            ATLAS_9_SLICE => Some(UiSlice {
                kind: UiSliceKind::Nine,
                us: us(),
                vs: vs(),
                edges: [widths[0], widths[1], heights[0], heights[1]],
            }),
            _ => None,
        };

        let uv = match &slice {
            Some(UiSlice {
                us: Some(us),
                vs: Some(vs),
                ..
            }) => [us[0], vs[0], us[us.len() - 1], vs[vs.len() - 1]],
            _ => {
                let rect = vector(data, TEXTURE_UV).unwrap_or_else(|| vec![0.0, 0.0, 1.0, 1.0]);
                [
                    rect[0] * scale_u,
                    rect[1] * scale_v,
                    rect[2] * scale_u,
                    rect[3] * scale_v,
                ]
            }
        };

        Some(UiSprite {
            texture: self.texture(hash, false),
            uv,
            name: None,
            slice,
        })
    }

    /// A `LooseUiTextureData` sprite, found in the view's manifest by the source path's hash.
    fn page_sprite(&mut self, element: BinHash, class: BinHash, data: &Fields) -> Option<UiSprite> {
        let key = file_hash(data.get(&TEXTURE_NAME_LOOSE))?;
        let name = self.namer.chunk(WadHash(key));
        let Some(entry) = self
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.find(key))
            .copied()
        else {
            self.warnings.push(UiViewWarning::MissingSprite {
                element: hex(element),
                name: name.unwrap_or_else(|| format!("{key:016x}")),
            });
            return None;
        };
        let page = self.manifest.as_ref()?.pages[entry.page as usize];

        let widths = pair(data, EDGE_SIZES_LEFT_RIGHT);
        let heights = pair(data, EDGE_SIZES_TOP_BOTTOM);
        let slice = |kind, edges| {
            Some(UiSlice {
                kind,
                us: None,
                vs: None,
                edges,
            })
        };
        let slice = match class {
            LOOSE_3_SLICE_H => slice(UiSliceKind::Horizontal, [widths[0], widths[1], 0.0, 0.0]),
            LOOSE_3_SLICE_V => slice(UiSliceKind::Vertical, [0.0, 0.0, heights[0], heights[1]]),
            LOOSE_9_SLICE => slice(
                UiSliceKind::Nine,
                [widths[0], widths[1], heights[0], heights[1]],
            ),
            _ => None,
        };

        Some(UiSprite {
            texture: self.texture(page, true),
            uv: entry.uv.map(finite),
            name,
            slice,
        })
    }

    /// The index of the font a text's `FontDescription` links, added on first use.
    fn font(&mut self, element: BinHash, fields: &Fields) -> Option<usize> {
        let target = link(fields.get(&FONT_DESCRIPTION))?;
        if let Some(&at) = self.font_index.get(&target.0) {
            return at;
        }

        let font = self.font_bins.font(target, &mut self.namer, self.assets);
        let at = font.map(|font| {
            self.fonts.push(font);
            self.fonts.len() - 1
        });
        self.font_index.insert(target.0, at);
        if at.is_none() {
            self.missing_font(element, target);
        }
        at
    }

    /// The index of the style sheet a text's `HTMLStyleSheet` links, added on first use.
    fn style_sheet(&mut self, element: BinHash, fields: &Fields) -> Option<usize> {
        let target = link(fields.get(&HTML_STYLE_SHEET))?;
        if let Some(&at) = self.style_sheet_index.get(&target.0) {
            return at;
        }

        let sheet = self
            .font_bins
            .style_sheet(target, &mut self.namer, self.assets);
        let at = sheet.map(|(sheet, atlas)| {
            self.style_sheets.push(sheet);
            self.sheet_atlases.push(atlas);
            self.style_sheets.len() - 1
        });
        self.style_sheet_index.insert(target.0, at);
        if at.is_none() {
            self.missing_font(element, target);
        }
        at
    }

    fn missing_font(&mut self, element: BinHash, target: BinHash) {
        let element = self.namer.entry(element).unwrap_or_else(|| hex(element));
        let link = self.namer.entry(target).unwrap_or_else(|| hex(target));
        self.warnings
            .push(UiViewWarning::MissingFont { element, link });
    }

    /// The index of the texture at the path hash `hash`, added on first use.
    fn texture(&mut self, hash: u64, page: bool) -> usize {
        if let Some(&at) = self.texture_index.get(&hash) {
            return at;
        }

        let (path, asset) = chunk(&mut self.namer, self.assets, WadHash(hash));
        self.textures.push(UiTexture { path, asset, page });
        self.texture_index.insert(hash, self.textures.len() - 1);
        self.textures.len() - 1
    }
}

/// The chunk at `hash` as its path and asset, found by path where a table names it.
pub(super) fn chunk(
    namer: &mut Namer<'_>,
    assets: &dyn AssetLookup,
    hash: WadHash,
) -> (String, Option<ltk_manager_core::preview::AssetRef>) {
    match namer.chunk(hash) {
        Some(path) => {
            let asset = assets.locate(&path).or_else(|| assets.locate_chunk(hash));
            (path, asset)
        }
        None => (format!("{:016x}", hash.0), assets.locate_chunk(hash)),
    }
}

/// Where an element sits, and none for a class without a position.
pub(super) fn position(fields: &Fields) -> Option<UiPosition> {
    let (class, position) = struct_of(fields.get(&POSITION))?;

    match class {
        POSITION_FULL_SCREEN => Some(UiPosition::FullScreen),
        POSITION_POLYGON => Some(UiPosition::Polygon {
            rect: rect(position),
            vertices: items(position.get(&POLYGON_VERTICES))
                .iter()
                .filter_map(|vertex| match leaf(Some(vertex)) {
                    Some(Leaf::Vector2(v)) => Some([finite(v.x), finite(v.y)]),
                    _ => None,
                })
                .collect(),
        }),
        POSITION_RECT => Some(UiPosition::Rect {
            rect: rect(position),
        }),
        _ => None,
    }
}

fn rect(position: &Fields) -> UiRect {
    let ui_rect = struct_of(position.get(&UI_RECT)).map(|(_, fields)| fields);
    let in_rect = |field| ui_rect.map_or([0.0; 2], |fields| pair(fields, field));
    let source = |field| {
        ui_rect
            .and_then(|fields| number(fields, field))
            .unwrap_or(0.0) as u32
    };

    UiRect {
        position: in_rect(RECT_POSITION),
        size: in_rect(RECT_SIZE),
        source: [source(SOURCE_WIDTH), source(SOURCE_HEIGHT)],
        anchor: anchor(position),
        ignore_global_scale: flag_or(position, IGNORE_GLOBAL_SCALE),
        ignore_safe_zone: flag_or(position, IGNORE_SAFE_ZONE),
        disable_resolution_downscale: flag_or(position, DISABLE_RESOLUTION_DOWNSCALE),
        disable_pixel_snapping: [
            flag_or(position, DISABLE_PIXEL_SNAPPING_X),
            flag_or(position, DISABLE_PIXEL_SNAPPING_Y),
        ],
        min_size: vector(position, MIN_SIZE).map_or([0.0; 2], |v| [v[0], v[1]]),
        max_size: vector(position, MAX_SIZE).map_or([1_000_000.0; 2], |v| [v[0], v[1]]),
    }
}

fn anchor(position: &Fields) -> UiAnchor {
    let Some((class, anchors)) = struct_of(position.get(&ANCHORS)) else {
        return UiAnchor::None;
    };
    let byte = |field| number(anchors, field).unwrap_or(0.0) as u8;

    match class {
        ANCHOR_SINGLE => UiAnchor::Single {
            anchor: pair(anchors, ANCHOR),
        },
        ANCHOR_DOUBLE => UiAnchor::Double {
            left: pair(anchors, ANCHOR_LEFT),
            right: pair(anchors, ANCHOR_RIGHT),
        },
        ANCHOR_HIERARCHY => UiAnchor::Hierarchy {
            align: [byte(ALIGN_X), byte(ALIGN_Y)],
            pivot: [byte(HIERARCHY_PIVOT_X), byte(HIERARCHY_PIVOT_Y)],
            margins: [
                pair(anchors, HIERARCHY_MARGINS_X),
                pair(anchors, HIERARCHY_MARGINS_Y),
            ],
        },
        _ => UiAnchor::None,
    }
}

/// A managed layout's style and region, and none for a group without a `LayoutStyle`.
pub(super) fn layout(fields: &Fields) -> Option<UiLayout> {
    let (class, style) = struct_of(fields.get(&LAYOUT_STYLE))?;
    let byte = |field| number(style, field).unwrap_or(0.0) as u8;

    let (kind, cross) = match class {
        HORIZONTAL_LIST => (
            UiLayoutKind::HorizontalList,
            [byte(ROW_VERTICAL_ALIGNMENT), 0],
        ),
        VERTICAL_LIST => (
            UiLayoutKind::VerticalList,
            [byte(COLUMN_HORIZONTAL_ALIGNMENT), 0],
        ),
        GRID => (
            UiLayoutKind::Grid,
            [byte(ROW_HORIZONTAL_ALIGNMENT), byte(ROW_VERTICAL_ALIGNMENT)],
        ),
        _ => return None,
    };

    Some(UiLayout {
        region: link(fields.get(&LAYOUT_REGION)).map(hex),
        kind,
        justify: [byte(HORIZONTAL_JUSTIFICATION), byte(VERTICAL_JUSTIFICATION)],
        fill: [
            byte(HORIZONTAL_FILL_DIRECTION),
            byte(VERTICAL_FILL_DIRECTION),
        ],
        fill_priority: byte(FILL_PRIORITY),
        cross,
        ignore_disabled: flag_or(fields, IGNORE_DISABLED_ELEMENTS),
    })
}

/// The links a list field holds, as hex.
pub(super) fn links(fields: &Fields, field: BinHash) -> Vec<String> {
    items(fields.get(&field))
        .iter()
        .filter_map(|item| link(Some(item)))
        .map(hex)
        .collect()
}

/// A file field's path hash: a `File` as written, or a string path hashed as the game hashes it.
pub(super) fn file_hash(value: Option<&ltk_meta::PropertyValueEnum>) -> Option<u64> {
    match leaf(value)? {
        Leaf::File(hash) if hash.0 != 0 => Some(hash.0),
        Leaf::String(path) if !path.is_empty() => Some(sprite_key(path)),
        _ => None,
    }
}

/// The layout fills a controller's fields hold.
pub(super) fn repeats(controller: &Fields) -> Vec<UiRepeat> {
    controller
        .values()
        .filter_map(|value| {
            let (class, fill) = struct_of(Some(value))?;
            if class != LAYOUT_FILL {
                return None;
            }

            let count = match leaf(fill.get(&FILL_COUNT))? {
                Leaf::U32(count) => count,
                Leaf::I32(count) => u32::try_from(count).ok()?,
                Leaf::U16(count) => u32::from(count),
                Leaf::U8(count) => u32::from(count),
                _ => return None,
            };
            Some(UiRepeat {
                template: hex(object(
                    fields_of(fill.get(&FILL_TEMPLATE))?.get(&FILL_TEMPLATE_GROUP),
                )?),
                layout: hex(object(fill.get(&FILL_LAYOUT))?),
                count,
            })
        })
        .collect()
}

/// The object `value` names, by a link or by a bare hash, and none for zero. A combo box and a
/// button state name their elements either way.
pub(super) fn object(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match leaf(value)? {
        Leaf::Link(hash) | Leaf::Hash(hash) if hash.0 != 0 => Some(hash),
        _ => None,
    }
}

/// What a `UiElementGroupButtonData` holds beyond its states.
fn button(fields: &Fields) -> UiButton {
    let key = |field| {
        text(fields.get(&field))
            .filter(|key| !key.is_empty())
            .map(str::to_owned)
    };
    UiButton {
        hit_region: object(fields.get(&HIT_REGION)).map(hex),
        text_size_in_hit_region: flag_or(fields, TEXT_SIZE_IN_HIT_REGION),
        selected: flag_or(fields, IS_SELECTED),
        enabled: flag_or(fields, IS_ENABLED),
        active: flag(fields, IS_ACTIVE).unwrap_or(true),
        click_particle: object(fields.get(&CLICK_PARTICLE)).map(hex),
        tooltip: key(ACTIVE_TOOLTIP),
        inactive_tooltip: key(INACTIVE_TOOLTIP),
        selected_tooltip: key(SELECTED_TOOLTIP),
    }
}

/// What a `UiElementGroupMeterData` holds.
fn meter(fields: &Fields) -> UiMeter {
    UiMeter {
        bars: links(fields, BAR_ELEMENTS),
        direction: number(fields, FILL_DIRECTION).unwrap_or(0.0) as u8,
        start: number(fields, START_PERCENTAGE).unwrap_or(0.0),
        enabled: flag(fields, IS_ENABLED).unwrap_or(true),
        tip: meter_tip(fields),
    }
}

fn meter_tip(fields: &Fields) -> Option<UiMeterTip> {
    let (class, tip) = struct_of(fields.get(&TIP_STYLE))?;
    let style = match class {
        BAR_EXTENSION_TIP => UiTipStyle::BarExtension,
        DOUBLE_SIDED_TIP => UiTipStyle::DoubleSided,
        GLOW_CENTERED_TIP => UiTipStyle::GlowCenteredOverlay,
        _ => return None,
    };

    Some(UiMeterTip {
        style,
        elements: links(tip, DIRECTIONAL_TIPS),
        reverse: links(tip, REVERSE_DIRECTIONAL_TIPS),
        sliver: link(tip.get(&SLIVER)).map(hex),
        glow: number(tip, GLOW_CENTER).unwrap_or(0.5),
    })
}

pub(super) fn flag(fields: &Fields, field: BinHash) -> Option<bool> {
    match leaf(optional(fields.get(&field)))? {
        Leaf::Bool(value) | Leaf::Flag(value) => Some(value),
        _ => None,
    }
}

pub(super) fn flag_or(fields: &Fields, field: BinHash) -> bool {
    flag(fields, field).unwrap_or(false)
}

/// Any numeric field as a float.
pub(super) fn number(fields: &Fields, field: BinHash) -> Option<f32> {
    Some(match leaf(optional(fields.get(&field)))? {
        Leaf::F32(value) => finite(value),
        Leaf::U8(value) => f32::from(value),
        Leaf::I8(value) => f32::from(value),
        Leaf::U16(value) => f32::from(value),
        Leaf::I16(value) => f32::from(value),
        Leaf::U32(value) => value as f32,
        Leaf::I32(value) => value as f32,
        _ => return None,
    })
}

/// A colour field as `r, g, b, a`.
///
/// A bin stores a colour as the bytes of a `0xAARRGGBB` word, so `ltk_meta`'s `r` is blue: the
/// fonts named `Blue1` and `Gold1` hold `{250, 250, 205}` and `{210, 230, 240}`, which are the
/// palette's `#CDFAFA` and `#F0E6D2` read in that order.
pub(super) fn color(fields: &Fields, field: BinHash) -> Option<[u8; 4]> {
    match leaf(optional(fields.get(&field)))? {
        Leaf::Color(c) => Some([c.b, c.g, c.r, c.a]),
        _ => None,
    }
}

/// A vector field's components, two to four.
fn vector(fields: &Fields, field: BinHash) -> Option<Vec<f32>> {
    let components = match leaf(fields.get(&field))? {
        Leaf::Vector2(v) => v.to_array().to_vec(),
        Leaf::Vector3(v) => v.to_array().to_vec(),
        Leaf::Vector4(v) => v.to_array().to_vec(),
        _ => return None,
    };
    Some(components.into_iter().map(finite).collect())
}

/// `value`, or 0 where it is not finite, which serde would write as `null`.
fn finite(value: f32) -> f32 {
    if value.is_finite() { value } else { 0.0 }
}

fn pair(fields: &Fields, field: BinHash) -> [f32; 2] {
    vector(fields, field).map_or([0.0; 2], |v| [v[0], v[1]])
}
