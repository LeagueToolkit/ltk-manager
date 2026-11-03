//! The outline values that character inking writes, and the material and category objects that
//! carry them.

use ltk_manager_base::config::{CharacterInking as InkingSettings, InkingColorMode, Rgb8};
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;

/// `Outline_CameraDepthOffset` of every shipped outline material. A negative offset puts the
/// shell behind the body, so only the silhouette shows.
const DEPTH_OFFSET: f32 = -20.0;

/// The mask texture of every shipped outline material, read on its red channel.
const MASK_TEXTURE: &str = "assets/shared/materials/white.tex";

/// Reads the mask on its red channel, for the white texture.
const RED: [f32; 4] = [1.0, 0.0, 0.0, 0.0];

/// Reads the mask on its alpha channel, for a submesh's own texture.
pub(super) const ALPHA: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

/// A texture that masks an outline, and the weight of each of its channels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(super) struct Mask {
    /// The texture's path hash.
    pub(super) texture: u64,
    /// `Outline_Mask_ChannelMask`.
    pub(super) channels: [f32; 4],
}

/// The side of the player that a champion is on, which picks the color with team colors on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum InkingSide {
    /// The player's own champion and its allies.
    #[default]
    Ally,
    /// The champions of the other team.
    Enemy,
}

/// The `Jade_CharacterOutline` parameters that character inking writes for one side.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkingOutline {
    /// `Outline_Color`, each channel the sRGB byte over 255. The shader does not read alpha.
    pub color: [f32; 4],
    /// `Outline_Width`, in world units at `camera_distance` from the camera.
    pub width: f32,
    /// `Outline_CameraDistanceMod`, the camera distance at which the outline is `width` wide.
    pub camera_distance: f32,
    /// `Outline_CameraDepthOffset`, in world units toward the camera.
    pub depth_offset: f32,
    /// `Outline_FinalAlphaMult`, which scales the masked alpha.
    pub alpha: f32,
    /// The seconds that the outline takes to fade out when the champion dies.
    pub death_fade: f32,
}

/// Returns the outline that `settings` give a champion on `side`.
///
/// Every value is clamped to the range that [`InkingSettings`] documents. A side does not change
/// the color unless team colors are on.
#[must_use]
pub fn outline_values(settings: &InkingSettings, side: InkingSide) -> InkingOutline {
    let color = match (settings.color_mode, side) {
        (InkingColorMode::Single, _) => settings.color,
        (InkingColorMode::Team, InkingSide::Ally) => settings.ally_color,
        (InkingColorMode::Team, InkingSide::Enemy) => settings.enemy_color,
    };

    InkingOutline {
        color: rgba(color),
        width: f32::from(settings.width.clamp(10, 150)) / 10.0,
        camera_distance: f32::from(settings.camera_distance.clamp(1000, 9000)),
        depth_offset: DEPTH_OFFSET,
        alpha: f32::from(settings.opacity.clamp(10, 100)) / 100.0,
        death_fade: f32::from(settings.death_fade.min(2000)) / 1000.0,
    }
}

/// `color` as an opaque RGBA vector with each channel over 255.
fn rgba(color: Rgb8) -> [f32; 4] {
    let [r, g, b] = color.0.map(|channel| f32::from(channel) / 255.0);
    [r, g, b, 1.0]
}

/// The `CharacterOutlineCategory` body that links `material`.
pub(super) fn category_body(material: &str) -> String {
    format!("class: CharacterOutlineCategory\nset:\n  Material: \"{material}\"\n")
}

/// The `StaticMaterialDef` body of the outline material that `settings` describe.
///
/// The pass state and the techniques are those of the shipped League Classic material. With
/// team colors on, a `ColorChooserMaterialDriver` on `IsEnemyDynamicMaterialBoolDriver` picks
/// the enemy color.
///
/// With a `mask`, the path hash of the texture a submesh draws with, the outline is masked by
/// that texture's alpha, as the League Classic materials of capes and props are. Without one it
/// reads a white texture and covers the whole submesh.
pub(super) fn material_body(settings: &InkingSettings, mask: Option<Mask>) -> String {
    let ally = outline_values(settings, InkingSide::Ally);
    let enemy = outline_values(settings, InkingSide::Enemy);

    let mut text = String::from("class: StaticMaterialDef\nset:\n");
    text.push_str("  samplerValues:\n");
    text.push_str("    - !embed(StaticMaterialShaderSamplerDef)\n");
    text.push_str("      TextureName: Outline_Mask\n");
    match mask {
        Some(Mask { texture, .. }) => {
            let _ = writeln!(text, "      texturePath: \"0x{texture:016x}\"");
        }
        None => {
            let _ = writeln!(text, "      texturePath: {MASK_TEXTURE}");
        }
    }

    text.push_str("  paramValues:\n");
    let params = [
        ("Outline_CameraDepthOffset", scalar(ally.depth_offset)),
        ("Outline_CameraDistanceMod", scalar(ally.camera_distance)),
        ("Outline_Color", ally.color),
        ("Outline_FinalAlphaMult", scalar(ally.alpha)),
        (
            "Outline_Mask_ChannelMask",
            mask.map_or(RED, |mask| mask.channels),
        ),
        ("Outline_Width", scalar(ally.width)),
    ];
    for (name, value) in params {
        let _ = writeln!(
            text,
            "    - !embed(StaticMaterialShaderParamDef) {{name: {name}, value: {}}}",
            vector(value)
        );
    }

    text.push_str(concat!(
        "  shaderMacros:\n",
        "    NUM_BLEND_WEIGHTS: \"4\"\n",
        "  techniques:\n",
        "    - !embed(StaticMaterialTechniqueDef)\n",
        "      name: normal\n",
        "      passes:\n",
        "        - !embed(StaticMaterialPassDef)\n",
        "          shader: Shaders/SkinnedMesh/Jade_CharacterOutline\n",
        "          blendEnable: true\n",
        "          cullEnable: false\n",
        "          srcColorBlendFactor: 6\n",
        "          srcAlphaBlendFactor: 6\n",
        "          dstColorBlendFactor: 7\n",
        "          dstAlphaBlendFactor: 7\n",
        "  childTechniques:\n",
        "    - !embed(StaticMaterialChildTechniqueDef)\n",
        "      name: transition\n",
        "      parentName: normal\n",
        "      shaderMacros:\n",
        "        TRANSITION: \"1\"\n",
        "  dynamicMaterial: !pointer(DynamicMaterialDef)\n",
        "    parameters:\n",
        "      - !embed(DynamicMaterialParameterDef)\n",
        "        name: Outline_FinalAlphaMult\n",
        "        driver: !pointer(LerpMaterialDriver)\n",
        "          mBoolDriver: !pointer(IsDeadDynamicMaterialBoolDriver) {}\n",
        "          mOnValue: 0.0\n",
    ));
    let _ = writeln!(text, "          mOffValue: {}", number(ally.alpha));
    let _ = writeln!(
        text,
        "          mTurnOnTimeSec: {}",
        number(ally.death_fade)
    );
    text.push_str("          mTurnOffTimeSec: 0.0\n");

    if settings.color_mode == InkingColorMode::Team {
        text.push_str(concat!(
            "      - !embed(DynamicMaterialParameterDef)\n",
            "        name: Outline_Color\n",
            "        driver: !pointer(ColorChooserMaterialDriver)\n",
            "          mBoolDriver: !pointer(IsEnemyDynamicMaterialBoolDriver) {}\n",
        ));
        let _ = writeln!(text, "          mColorOn: {}", vector(enemy.color));
        let _ = writeln!(text, "          mColorOff: {}", vector(ally.color));
    }
    text
}

fn scalar(value: f32) -> [f32; 4] {
    [value, 0.0, 0.0, 0.0]
}

fn vector(value: [f32; 4]) -> String {
    let [x, y, z, w] = value.map(number);
    format!("[{x}, {y}, {z}, {w}]")
}

/// `value` as a YAML float, always with a decimal point so it never reads as an integer.
fn number(value: f32) -> String {
    let text = value.to_string();
    if text.contains(['.', 'e', 'E']) {
        text
    } else {
        format!("{text}.0")
    }
}
