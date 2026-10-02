//! The client's UI and font shader pairs, per section 2.2 of docs/plans/atlas-renderer.md.

use hexshade::{Defines, ShaderCache, ShaderPath, TranslationCache};
use ltk_manager_core::bin_document::AssetLookup;
use ltk_manager_core::error::AppResult;
use ltk_manager_core::preview::AssetRef;
use serde::{Deserialize, Serialize};

use ltk_manager_game::program::{AssetChunks, ProgramRead, program_read};

const UI: &str = "ASSETS/Shaders/HLSL/UI/";
const FONT: &str = "ASSETS/Shaders/HLSL/Font/";

/// A shader pair the client draws a UI command with. The client pairs them in code, so a
/// vertex stage can serve several pixel stages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum UiShader {
    Blend,
    Opaque,
    Copy,
    Cooldown,
    CooldownLine,
    Ammo,
    AmmoLine,
    CircleMaskCooldown,
    CooldownRadial,
    CooldownRadialFill,
    ArcFill,
    Glow,
    GlowConstant,
    Animation,
    FillPercentage,
    Desaturate,
    CircleMaskDesaturate,
    Line,
    LineGraph,
    RotatingIcon,
    GlowingRotatingIcon,
    AnimatedRotatingIcon,
    Gradient,
    Font,
    FontOutline,
    FontIcon,
}

impl UiShader {
    /// Every pair, in declaration order.
    pub const ALL: [Self; 26] = [
        Self::Blend,
        Self::Opaque,
        Self::Copy,
        Self::Cooldown,
        Self::CooldownLine,
        Self::Ammo,
        Self::AmmoLine,
        Self::CircleMaskCooldown,
        Self::CooldownRadial,
        Self::CooldownRadialFill,
        Self::ArcFill,
        Self::Glow,
        Self::GlowConstant,
        Self::Animation,
        Self::FillPercentage,
        Self::Desaturate,
        Self::CircleMaskDesaturate,
        Self::Line,
        Self::LineGraph,
        Self::RotatingIcon,
        Self::GlowingRotatingIcon,
        Self::AnimatedRotatingIcon,
        Self::Gradient,
        Self::Font,
        Self::FontOutline,
        Self::FontIcon,
    ];

    /// The vertex and pixel file names, without the folder and the stage extension.
    #[must_use]
    pub const fn stages(self) -> (&'static str, &'static str) {
        match self {
            Self::Blend => ("UI", "UI_Alpha"),
            Self::Opaque => ("UI", "UI_Opaque"),
            Self::Copy => ("UI", "UI_CopyFromOffscreen"),
            Self::Cooldown => ("Cooldown", "Cooldown"),
            Self::CooldownLine => ("CooldownLine", "CooldownLine"),
            Self::Ammo => ("Ammo", "Ammo"),
            Self::AmmoLine => ("AmmoLine", "AmmoLine"),
            Self::CircleMaskCooldown => ("CircleMaskCooldown", "CircleMaskCooldown"),
            Self::CooldownRadial => ("CooldownRadial", "CooldownRadial"),
            Self::CooldownRadialFill => ("CooldownRadial", "CooldownRadialFill"),
            Self::ArcFill => ("ArcFill", "ArcFill"),
            Self::Glow => ("Glow", "Glow"),
            Self::GlowConstant => ("GlowConstant", "Glow"),
            Self::Animation => ("Animation", "UI_Alpha"),
            Self::FillPercentage => ("FillPercentage", "FillPercentage"),
            Self::Desaturate => ("Desaturate", "Desaturate"),
            Self::CircleMaskDesaturate => ("CircleMaskDesaturate", "CircleMaskDesaturate"),
            Self::Line => ("Line", "Line"),
            Self::LineGraph => ("LineGraph", "LineGraph"),
            Self::RotatingIcon => ("TransformMesh", "TransformMesh"),
            Self::GlowingRotatingIcon => ("TransformMesh", "UI_Brightness"),
            Self::AnimatedRotatingIcon => ("AnimationTransformMesh", "TransformMesh"),
            Self::Gradient => ("Gradient", "Gradient"),
            Self::Font => ("Font", "Font"),
            Self::FontOutline => ("Font", "FontWithOutline"),
            Self::FontIcon => ("Font", "FontIcon"),
        }
    }

    /// Whether the pair is a font program, which lives under `Font/` and reads glyph pages.
    #[must_use]
    pub const fn is_font(self) -> bool {
        matches!(self, Self::Font | Self::FontOutline | Self::FontIcon)
    }

    /// The full HLSL paths of both stages.
    #[must_use]
    pub fn paths(self) -> (String, String) {
        let folder = if self.is_font() { FONT } else { UI };
        let (vertex, pixel) = self.stages();
        (
            format!("{folder}{vertex}.vs"),
            format!("{folder}{pixel}.ps"),
        )
    }
}

/// The programs of `shaders`, one for one and in that order.
///
/// Each file has one permutation, so no define selects it. `read` answers asset bytes as
/// [`crate::program::read_programs`] reads them, so a layer's copy of a shader wins.
pub fn read_ui_programs(
    assets: &dyn AssetLookup,
    shaders: &[UiShader],
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Vec<ProgramRead> {
    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);
    let defines = Defines::default();

    shaders
        .iter()
        .map(|shader| {
            let (vertex, pixel) = shader.paths();
            let path = ShaderPath::Hlsl {
                vertex: &vertex,
                pixel: &pixel,
            };
            let program = program_read(&mut cache, path, &defines);
            if let ProgramRead::Failed { reason } = &program {
                tracing::warn!(?shader, "No UI program: {reason}");
            }
            program
        })
        .collect()
}
