//! Spatial scene graph structures for environment assets.
//!
//! The scene graph provides spatial partitioning via bucketed geometry,
//! enabling efficient visibility queries, culling, and collision detection.

mod bucket;
mod bucketed_geometry;
mod build;
mod selection;

pub use bucket::*;
pub use bucketed_geometry::*;
pub use build::{BakeFace, BuildError, EdgeRounding, GridLayout, SceneGraphKey, BOUNDS_PADDING};
pub use selection::{
    FaceMask, SceneGraphSelection, MAIN_BUCKETS_PER_SIDE, REGION_BUCKETS_PER_SIDE,
    VISIBILITY_CONTROLLER_BUCKETS_PER_SIDE,
};
