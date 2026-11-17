//! One patching session over the mod library: its thread and its incident pipeline.

pub mod pipeline;
pub mod thread;

pub use pipeline::{IncidentPipeline, SessionStores};
pub use thread::{PatcherThread, PrepareHost, PreparedHost, SessionParams, workshop_tests};
