//! The UI classes and fields a view read matches, hashed from their names.

use ltk_hash::BinHash;
pub(super) use ltk_manager_core::hashing::named;

pub(super) const PATH_HASH_TO_SELF: BinHash = named("PathHashToSelf");
pub(super) const BASE_LOADABLE: BinHash = named("BaseLoadable");
/// The field a `LogicDriverViewController` and a few others link their base through.
pub(super) const LOADABLE: BinHash = named("Loadable");
pub(super) const FILEPATH_HASH: BinHash = named("FilepathHash");
pub(super) const PROPERTY_LOADABLE: BinHash = named("UiPropertyLoadable");
pub(super) const OVERRIDE_LOADABLE: BinHash = named("UiPropertyOverrideLoadable");

pub(super) const SCENE_CLASSES: [BinHash; 3] = [
    named("UISceneData"),
    named("UiSceneViewPaneData"),
    /* The unnamed scene class under `UiSceneViewPaneData`, with `BufferRegionElement`. */
    BinHash(0x3531_7d3f),
];

pub(super) const NAME: BinHash = named("name");
pub(super) const SCENE: BinHash = named("Scene");
pub(super) const PARENT_SCENE: BinHash = named("ParentScene");
pub(super) const LAYER: BinHash = named("Layer");
pub(super) const ENABLED: BinHash = named("Enabled");
pub(super) const INHERIT_SCISSORING: BinHash = named("InheritScissoring");
pub(super) const ELEMENTS: BinHash = named("Elements");
pub(super) const POSITION: BinHash = named("Position");

pub(super) const POSITION_RECT: BinHash = named("UiPositionRect");
pub(super) const POSITION_POLYGON: BinHash = named("UiPositionPolygon");
pub(super) const POSITION_FULL_SCREEN: BinHash = named("UiPositionFullScreen");
pub(super) const UI_RECT: BinHash = named("UIRect");
pub(super) const RECT_POSITION: BinHash = named("Position");
pub(super) const RECT_SIZE: BinHash = named("Size");
pub(super) const SOURCE_WIDTH: BinHash = named("SourceResolutionWidth");
pub(super) const SOURCE_HEIGHT: BinHash = named("SourceResolutionHeight");
pub(super) const ANCHORS: BinHash = named("Anchors");
pub(super) const IGNORE_GLOBAL_SCALE: BinHash = named("IgnoreGlobalScale");
pub(super) const IGNORE_SAFE_ZONE: BinHash = named("IgnoreSafeZone");
pub(super) const DISABLE_RESOLUTION_DOWNSCALE: BinHash = named("DisableResolutionDownscale");
pub(super) const DISABLE_PIXEL_SNAPPING_X: BinHash = named("DisablePixelSnappingX");
pub(super) const DISABLE_PIXEL_SNAPPING_Y: BinHash = named("DisablePixelSnappingY");
pub(super) const MIN_SIZE: BinHash = named("MinSize");
pub(super) const MAX_SIZE: BinHash = named("MaxSize");
pub(super) const POLYGON_VERTICES: BinHash = named("PolygonVertices");

pub(super) const ANCHOR_SINGLE: BinHash = named("AnchorSingle");
pub(super) const ANCHOR_DOUBLE: BinHash = named("AnchorDouble");
/// `AnchorHierarchy`, which CommunityDragon's tables do not name.
pub(super) const ANCHOR_HIERARCHY: BinHash = named("AnchorHierarchy");
pub(super) const ANCHOR: BinHash = named("Anchor");
pub(super) const ANCHOR_LEFT: BinHash = named("anchorLeft");
pub(super) const ANCHOR_RIGHT: BinHash = named("anchorRight");
pub(super) const ALIGN_X: BinHash = named("AlignX");
pub(super) const ALIGN_Y: BinHash = named("AlignY");
pub(super) const HIERARCHY_PIVOT_X: BinHash = BinHash(0x0a56_7dbd);
pub(super) const HIERARCHY_PIVOT_Y: BinHash = BinHash(0x0956_7c2a);
pub(super) const HIERARCHY_MARGINS_X: BinHash = BinHash(0xf00a_15b2);
pub(super) const HIERARCHY_MARGINS_Y: BinHash = BinHash(0x8ecb_313b);

pub(super) const TEXTURE_DATA: BinHash = named("TextureData");
pub(super) const ATLAS: BinHash = named("AtlasData");
pub(super) const ATLAS_3_SLICE_H: BinHash = named("AtlasData3SliceH");
pub(super) const ATLAS_3_SLICE_V: BinHash = named("AtlasData3SliceV");
pub(super) const ATLAS_9_SLICE: BinHash = named("AtlasData9Slice");
pub(super) const LOOSE: BinHash = named("LooseUiTextureData");
pub(super) const LOOSE_3_SLICE_H: BinHash = named("LooseUiTextureData3SliceH");
pub(super) const LOOSE_3_SLICE_V: BinHash = named("LooseUiTextureData3SliceV");
pub(super) const LOOSE_9_SLICE: BinHash = named("LooseUiTextureData9Slice");
pub(super) const TEXTURE_NAME_ATLAS: BinHash = named("mTextureName");
pub(super) const TEXTURE_SOURCE_WIDTH: BinHash = named("mTextureSourceResolutionWidth");
pub(super) const TEXTURE_SOURCE_HEIGHT: BinHash = named("mTextureSourceResolutionHeight");
pub(super) const TEXTURE_UV: BinHash = named("mTextureUV");
pub(super) const TEXTURE_US: BinHash = named("TextureUs");
pub(super) const TEXTURE_VS: BinHash = named("TextureVs");
pub(super) const LEFT_RIGHT_WIDTHS: BinHash = named("LeftRightWidths");
pub(super) const TOP_BOTTOM_HEIGHTS: BinHash = named("TopBottomHeights");
pub(super) const TEXTURE_NAME_LOOSE: BinHash = named("TextureName");
pub(super) const EDGE_SIZES_LEFT_RIGHT: BinHash = named("EdgeSizesLeftRight");
pub(super) const EDGE_SIZES_TOP_BOTTOM: BinHash = named("EdgeSizesTopBottom");

pub(super) const ICON: BinHash = named("UiElementIconData");
pub(super) const COLOR: BinHash = named("Color");
pub(super) const USE_ALPHA: BinHash = named("UseAlpha");
pub(super) const FLIP_X: BinHash = named("FlipX");
pub(super) const FLIP_Y: BinHash = named("FlipY");
pub(super) const PER_PIXEL_UVS_X: BinHash = named("PerPixelUvsX");
pub(super) const PER_PIXEL_UVS_Y: BinHash = named("PerPixelUVsY");
pub(super) const FILL_TYPE: BinHash = named("FillType");
pub(super) const MATERIAL: BinHash = named("Material");

pub(super) const TEXT: BinHash = named("UiElementTextData");
pub(super) const FONT_DESCRIPTION: BinHash = named("FontDescription");
pub(super) const TRA_KEY: BinHash = named("TRAKey");
pub(super) const ALIGN_HORIZONTAL: BinHash = named("TextAlignmentHorizontal");
pub(super) const ALIGN_VERTICAL: BinHash = named("TextAlignmentVertical");
pub(super) const WRAPPING_MODE: BinHash = named("WrappingMode");
pub(super) const HTML_STYLE_SHEET: BinHash = named("HTMLStyleSheet");
pub(super) const FLIP_FOR_RTL: BinHash = named("FlipForRTL");
pub(super) const ICON_SCALE: BinHash = named("IconScale");
/* The unnamed float a shrinking `WrappingMode` scales a text down to at most. */
pub(super) const MIN_TEXT_SCALE: BinHash = BinHash(0x2497_2bb9);

pub(super) const GAME_FONT_DESCRIPTION: BinHash = named("GameFontDescription");
pub(super) const FONT_TYPE_CLASS: BinHash = named("FontType");
pub(super) const FONT_TYPE: BinHash = named("typeData");
pub(super) const FONT_RESOLUTIONS: BinHash = named("resolutionData");
pub(super) const OUTLINE_COLOR: BinHash = named("outlineColor");
pub(super) const SHADOW_COLOR: BinHash = named("shadowColor");
pub(super) const GLOW_COLOR: BinHash = named("glowColor");
pub(super) const FONT_FILL: BinHash = named("fillTextureName");
pub(super) const LOCALE_TYPES: BinHash = named("localeTypes");
pub(super) const LOCALE_NAME: BinHash = named("localeName");
pub(super) const FONT_FILE: BinHash = named("mFontFilePath");
pub(super) const FONT_FILE_BOLD: BinHash = named("FontFilePathBold");
pub(super) const AUTO_SCALE: BinHash = named("autoScale");
pub(super) const LOCALE_RESOLUTIONS: BinHash = named("localeResolutions");
pub(super) const RESOLUTIONS: BinHash = named("resolutions");
pub(super) const SCREEN_HEIGHT: BinHash = named("screenHeight");
pub(super) const FONT_SIZE: BinHash = named("fontSize");
pub(super) const OUTLINE_SIZE: BinHash = named("outlineSize");
pub(super) const SHADOW_DEPTH_X: BinHash = named("shadowDepthX");
pub(super) const SHADOW_DEPTH_Y: BinHash = named("shadowDepthY");

pub(super) const STYLES: BinHash = named("styles");
pub(super) const ICONS: BinHash = named("icons");
pub(super) const STYLE_BOLD: BinHash = named("bold");
pub(super) const STYLE_ITALICS: BinHash = named("italics");
pub(super) const STYLE_UNDERLINE: BinHash = named("underline");
pub(super) const ICON_TEXTURE: BinHash = named("texture");
pub(super) const ICON_Y_ADJUSTMENT: BinHash = named("YAdjustment");

pub(super) const PARTICLE: BinHash = named("UiElementParticleSystemData");
pub(super) const VFX_SYSTEM: BinHash = named("VfxSystem");
pub(super) const VFX_SCALE: BinHash = named("VFXAdjustmentScale");
pub(super) const RENDER_AT_ELEMENT_LAYER: BinHash = named("RenderAtElementLayer");

pub(super) const REGION: BinHash = named("UiElementRegionData");
pub(super) const SCISSOR: BinHash = named("UiElementScissorRegionData");
pub(super) const SCENE_TO_SCISSOR: BinHash = named("SceneToScissor");
pub(super) const SPINE: BinHash = named("UiElementSpineAnimationData");

pub(super) const GROUP_CLASSES: [BinHash; 9] = [
    named("UiElementGroupData"),
    named("UiElementGroupButtonData"),
    named("UiElementGroupFramedData"),
    named("UiElementGroupManagedLayoutData"),
    named("UiElementGroupMeterData"),
    named("UiElementGroupSliderData"),
    named("UiElementComponentInstanceData"),
    /* The unnamed group with `Alpha`, `transform` and `ScrollSettings`, and the one under it. */
    BinHash(0x8ffd_7c61),
    BinHash(0x857c_08ad),
];
pub(super) const ALPHA: BinHash = named("Alpha");
pub(super) const LAYOUT_REGION: BinHash = named("Region");
pub(super) const LAYOUT_STYLE: BinHash = named("LayoutStyle");
pub(super) const IGNORE_DISABLED_ELEMENTS: BinHash = named("IgnoreDisabledElements");
pub(super) const HORIZONTAL_LIST: BinHash = named("LayoutStyleHorizontalList");
pub(super) const VERTICAL_LIST: BinHash = named("LayoutStyleVerticalList");
pub(super) const GRID: BinHash = named("LayoutStyleGrid");
pub(super) const HORIZONTAL_JUSTIFICATION: BinHash = named("HorizontalJustification");
pub(super) const VERTICAL_JUSTIFICATION: BinHash = named("VerticalJustification");
pub(super) const HORIZONTAL_FILL_DIRECTION: BinHash = named("HorizontalFillDirection");
pub(super) const VERTICAL_FILL_DIRECTION: BinHash = named("VerticalFillDirection");
pub(super) const FILL_PRIORITY: BinHash = named("FillPriority");
pub(super) const ROW_VERTICAL_ALIGNMENT: BinHash = named("RowVerticalAlignment");
pub(super) const ROW_HORIZONTAL_ALIGNMENT: BinHash = named("RowHorizontalAlignment");
pub(super) const COLUMN_HORIZONTAL_ALIGNMENT: BinHash = named("ColumnHorizontalAlignment");
pub(super) const BUTTON_STATE: BinHash = named("UiElementGroupButtonState");
pub(super) const DISPLAY_ELEMENT_LIST: BinHash = named("DisplayElementList");
pub(super) const STATE_TEXT: BinHash = named("TextElement");
pub(super) const STATE_TEXT_FRAME: BinHash = named("TextFrameElement");
pub(super) const SLIDER_STATE: BinHash = named("UiElementGroupSliderState");
pub(super) const SLIDER_BACKDROP: BinHash = named("BarBackdrop");
pub(super) const SLIDER_ICON: BinHash = named("SliderIcon");

pub(super) const GROUP_BUTTON: BinHash = named("UiElementGroupButtonData");
pub(super) const HIT_REGION: BinHash = named("HitRegionElement");
pub(super) const TEXT_SIZE_IN_HIT_REGION: BinHash = named("AddTextSizeToHitRegion");
pub(super) const IS_SELECTED: BinHash = named("IsSelected");
pub(super) const IS_ENABLED: BinHash = named("IsEnabled");
pub(super) const IS_ACTIVE: BinHash = named("IsActive");
pub(super) const CLICK_PARTICLE: BinHash = named("ClickReleaseParticleElement");
pub(super) const ACTIVE_TOOLTIP: BinHash = named("ActiveTooltipTraKey");
pub(super) const INACTIVE_TOOLTIP: BinHash = named("InactiveTooltipTraKey");
pub(super) const SELECTED_TOOLTIP: BinHash = named("SelectedTooltipTraKey");

pub(super) const GROUP_METER: BinHash = named("UiElementGroupMeterData");
pub(super) const BAR_ELEMENTS: BinHash = named("BarElements");
pub(super) const FILL_DIRECTION: BinHash = named("FillDirection");
pub(super) const START_PERCENTAGE: BinHash = named("StartPercentage");
pub(super) const TIP_STYLE: BinHash = named("TipStyle");
pub(super) const BAR_EXTENSION_TIP: BinHash = named("BarExtensionTipStyle");
pub(super) const DOUBLE_SIDED_TIP: BinHash = named("DoubleSidedTipStyle");
pub(super) const GLOW_CENTERED_TIP: BinHash = named("GlowCenteredOverlayTipStyle");
pub(super) const DIRECTIONAL_TIPS: BinHash = named("DirectionalTipElements");
pub(super) const REVERSE_DIRECTIONAL_TIPS: BinHash = named("ReverseDirectionalTipElements");
pub(super) const SLIVER: BinHash = named("Sliver");
pub(super) const GLOW_CENTER: BinHash = BinHash(0xcc4c_6d1d);

/// The unnamed struct a controller names a template, the managed layout its copies fill and how
/// many it makes with, as the player frame's buff rows do.
pub(super) const LAYOUT_FILL: BinHash = BinHash(0x3427_0fce);
pub(super) const FILL_TEMPLATE: BinHash = BinHash(0x6258_0dd4);
/// The template struct's field naming the group it clones.
pub(super) const FILL_TEMPLATE_GROUP: BinHash = BinHash(0x5fb9_1e8c);
pub(super) const FILL_LAYOUT: BinHash = BinHash(0xcac1_7cff);
pub(super) const FILL_COUNT: BinHash = BinHash(0xd829_fd95);

pub(super) const COMBO_BOX: BinHash = named("UiComboBoxDefinition");
pub(super) const COMBO_BUTTON: BinHash = named("buttonDefinition");
pub(super) const COMBO_BACKDROP: BinHash = named("DropdownBackdropElementData");
pub(super) const COMBO_HOVER: BinHash = named("DropdownHoverElementData");
pub(super) const COMBO_HIGHLIGHT: BinHash = named("SelectedHighlightElementData");
pub(super) const COMBO_OPTION_TEXT: BinHash = named("ListOptionTextElementData");
pub(super) const COMBO_OPTION_HIT_AREA: BinHash = named("ListOptionHitAreaElementData");
pub(super) const COMBO_DIRECTION: BinHash = named("ListDisplayDirection");
pub(super) const COMBO_LABEL_KEY: BinHash = named("DropdownDisplayTraKey");
pub(super) const COMBO_SOUNDS: BinHash = named("SoundEvents");
pub(super) const COMBO_SELECTION_SOUND: BinHash = named("OnSelectionEvent");

pub(super) const COOLDOWN: BinHash = named("UiElementEffectCooldownData");
pub(super) const AMMO: BinHash = named("UiElementEffectAmmoData");
pub(super) const CIRCLE_MASK_COOLDOWN: BinHash = named("UiElementEffectCircleMaskCooldownData");
pub(super) const COOLDOWN_RADIAL: BinHash = named("UiElementEffectCooldownRadialData");
pub(super) const ARC_FILL: BinHash = named("UiElementEffectArcFillData");
pub(super) const GLOW: BinHash = named("UiElementEffectGlowData");
pub(super) const GLOW_CONSTANT: BinHash = named("UiElementEffectGlowConstantData");
pub(super) const ANIMATION: BinHash = named("UiElementEffectAnimationData");
pub(super) const ANIMATED_ROTATING_ICON: BinHash = named("UiElementEffectAnimatedRotatingIconData");
pub(super) const FILL_PERCENTAGE: BinHash = named("UiElementEffectFillPercentageData");
pub(super) const DESATURATE: BinHash = named("UiElementEffectDesaturateData");
pub(super) const CIRCLE_MASK_DESATURATE: BinHash = named("UiElementEffectCircleMaskDesaturateData");
pub(super) const LINE: BinHash = named("UiElementEffectLineData");
pub(super) const ROTATING_ICON: BinHash = named("UiElementEffectRotatingIconData");
pub(super) const GLOWING_ROTATING_ICON: BinHash = named("UiElementEffectGlowingRotatingIconData");
pub(super) const INSTANCED: BinHash = named("UiElementEffectInstancedData");
pub(super) const CUSTOM_MATERIAL: BinHash = named("UiElementEffectCustomMaterialData");

pub(super) const EFFECT_COLOR_0: BinHash = named("mEffectColor0");
pub(super) const EFFECT_COLOR_1: BinHash = named("mEffectColor1");
pub(super) const IS_FILL: BinHash = named("mIsFill");
pub(super) const M_FLIP_X: BinHash = named("mFlipX");
pub(super) const M_FLIP_Y: BinHash = named("mFlipY");
pub(super) const M_PER_PIXEL_UVS_X: BinHash = named("mPerPixelUvsX");
pub(super) const CYCLE_TIME: BinHash = named("CycleTime");
pub(super) const BASE_SCALE: BinHash = named("BaseScale");
pub(super) const CYCLE_SCALE: BinHash = named("CycleBasedScaleAddition");
pub(super) const MINIMUM_ALPHA: BinHash = named("MinimumAlpha");
pub(super) const MINIMUM_GLOW: BinHash = named("MinimumGlowMod");
pub(super) const MAXIMUM_GLOW: BinHash = named("MaximumGlowMod");
pub(super) const TOTAL_FRAMES: BinHash = named("TotalNumberOfFrames");
pub(super) const FRAMES_PER_ROW: BinHash = named("NumberOfFramesPerRowInAtlas");
pub(super) const FRAMES_PER_SECOND: BinHash = named("FramesPerSecond");
pub(super) const FINISH_BEHAVIOR: BinHash = named("mFinishBehavior");
pub(super) const MINIMUM_SATURATION: BinHash = named("MinimumSaturation");
pub(super) const MAXIMUM_SATURATION: BinHash = named("MaximumSaturation");
pub(super) const THICKNESS: BinHash = named("mThickness");
pub(super) const RIGHT_SLICE: BinHash = named("mRightSlicePercentage");
pub(super) const BRIGHTNESS: BinHash = named("BrightnessMod");
pub(super) const M_COLOR: BinHash = named("mColor");
pub(super) const M_MATERIAL: BinHash = named("mMaterial");
