//! Planar reflector definition

use glam::{Mat4, Vec3};
use ltk_primitives::AABB;

/// A planar reflector defines a reflection plane in the environment.
///
/// Used for rendering reflections on flat surfaces like water or mirrors.
/// Only one planar reflector can be active in a scene at a time (determined by frustum culling).
///
/// # Rendering Process
///
/// The game uses the reflector's transform and plane to:
/// 1. Check if the reflector is visible in the camera frustum
/// 2. Create a mirrored camera using the plane's normal
/// 3. Render the scene from the mirrored perspective to a texture
/// 4. Apply the reflection texture to surfaces within the plane bounds
#[derive(Debug, Clone, PartialEq)]
pub struct PlanarReflector {
    /// The reflector's world transform
    transform: Mat4,
    /// Bounding box defining the reflection plane's area
    plane: AABB,
    /// The reflection plane normal
    normal: Vec3,
}

impl PlanarReflector {
    /// Creates a new planar reflector
    pub fn new(transform: Mat4, plane: AABB, normal: Vec3) -> Self {
        Self {
            transform,
            plane,
            normal,
        }
    }

    /// The reflector's world transform, ready to multiply a position by.
    ///
    /// The matrix is affine and carries its translation in `w_axis`.
    #[inline]
    pub fn transform(&self) -> &Mat4 {
        &self.transform
    }

    /// Bounding box defining the reflection plane's area
    #[inline]
    pub fn plane(&self) -> &AABB {
        &self.plane
    }

    /// The reflection plane normal
    #[inline]
    pub fn normal(&self) -> Vec3 {
        self.normal
    }

    /// Computes the plane equation coefficient `d` (for ax + by + cz + d = 0)
    ///
    /// This is calculated as `-dot(normalize(normal), transform.translation)`
    #[inline]
    pub fn plane_distance(&self) -> f32 {
        let normalized = self.normal.normalize();
        let translation = self.transform.w_axis.truncate();
        -normalized.dot(translation)
    }

    /// Returns the plane equation coefficients (a, b, c, d) where ax + by + cz + d = 0
    #[inline]
    pub fn plane_equation(&self) -> (f32, f32, f32, f32) {
        let normalized = self.normal.normalize();
        (
            normalized.x,
            normalized.y,
            normalized.z,
            self.plane_distance(),
        )
    }
}
