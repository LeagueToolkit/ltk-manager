//! Visibility flags for environment assets

use bitflags::bitflags;

bitflags! {
    /// Visibility layer flags for environment geometry.
    ///
    /// These flags control which visibility layers a mesh or face belongs to.
    /// Used for fog of war, layer-based rendering, and visibility queries.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
    pub struct EnvironmentVisibility: u8 {
        /// Layer 0 (typically default/always visible)
        const LAYER_0 = 1 << 0;
        /// Layer 1
        const LAYER_1 = 1 << 1;
        /// Layer 2
        const LAYER_2 = 1 << 2;
        /// Layer 3
        const LAYER_3 = 1 << 3;
        /// Layer 4
        const LAYER_4 = 1 << 4;
        /// Layer 5
        const LAYER_5 = 1 << 5;
        /// Layer 6
        const LAYER_6 = 1 << 6;
        /// Layer 7
        const LAYER_7 = 1 << 7;

        /// All layers visible (default)
        const ALL_LAYERS = 0xFF;
    }
}

bitflags! {
    /// Render flags for environment meshes.
    ///
    /// These flags control various rendering behaviors for the mesh.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
    pub struct EnvironmentMeshRenderFlags: u16 {
        /// Default rendering
        const DEFAULT = 0;
        /// The renderer will treat the mesh as a decal
        const IS_DECAL = 1 << 0;
        /// Tells the renderer to render distortion effects into a separate buffer
        const HAS_ENVIRONMENT_DISTORTION = 1 << 1;
        /// Mesh will be rendered only if "Hide Eye Candy" option is unchecked
        const RENDER_ONLY_IF_EYE_CANDY_ON = 1 << 2;
        /// Mesh will be rendered only if "Hide Eye Candy" option is checked
        const RENDER_ONLY_IF_EYE_CANDY_OFF = 1 << 3;
        /// Create shadow buffer
        const CREATE_SHADOW_BUFFER = 1 << 4;
        /// Create shadow map material
        const CREATE_SHADOW_MAP_MATERIAL = 1 << 5;
        /// Unknown depth buffer flag
        const UNK_CREATE_DEPTH_BUFFER_2 = 1 << 6;
        /// Create depth buffer
        const CREATE_DEPTH_BUFFER = 1 << 7;
    }
}

bitflags! {
    /// Quality flags for environment meshes.
    ///
    /// Controls which quality settings the mesh appears in.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
    pub struct EnvironmentQuality: u8 {
        /// Very low quality setting
        const VERY_LOW = 1 << 0;
        /// Low quality setting
        const LOW = 1 << 1;
        /// Medium quality setting
        const MEDIUM = 1 << 2;
        /// High quality setting
        const HIGH = 1 << 3;
        /// Very high quality setting
        const VERY_HIGH = 1 << 4;

        /// All quality levels
        const ALL = 0x1F;
    }
}

/// Visibility transition behavior for environment meshes.
///
/// Controls how the mesh behaves during layer visibility transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(u8)]
pub enum VisibilityTransitionBehavior {
    /// Default - Only if mesh layer mask matches both CURRENT and NEW layer masks
    #[default]
    Unaffected = 0,
    /// Only if unfilteredMeshNewLayerMaskMatch == 0
    TurnInvisibleDoesNotMatchNewLayerFilter = 1,
    /// Only if unfilteredMeshNewLayerMaskMatch != 0
    TurnVisibleDoesMatchNewLayerFilter = 2,
}

impl TryFrom<u8> for VisibilityTransitionBehavior {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Unaffected),
            1 => Ok(Self::TurnInvisibleDoesNotMatchNewLayerFilter),
            2 => Ok(Self::TurnVisibleDoesMatchNewLayerFilter),
            _ => Err(value),
        }
    }
}
