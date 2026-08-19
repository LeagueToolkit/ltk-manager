pub mod elevation;
pub mod error;
pub mod events;
pub mod host;
pub mod injector;
pub mod session;
pub mod state;
pub mod thread;

pub use elevation::should_elevate;
pub use error::{InjectionStage, PatcherError};
pub use events::PatcherEvents;
pub use state::{
    PatcherPhase, PatcherSession, PatcherStateInner, SessionOrigin, StoredPatcherConfig,
};
pub use thread::{PatcherThread, SessionParams};
