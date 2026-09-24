//! The LoL Meta Wiki's documentation, cached for the session and looked up through a class's
//! bases.

use std::sync::Arc;
use std::time::SystemTime;

use ltk_hash::BinHash;
use ltk_meta_docs::{DocsCache, MetaDocs, PublishedDocs, Refresh};
use parking_lot::Mutex;

pub use ltk_meta_docs::{ClassDocs, Doc, PropertyDocs};

use crate::meta_schema::MetaSchema;
use crate::meta_schema::cache::MetaSchemaCache;
use crate::problems::GameBuild;

/// The documentation for `class`, including the property documentation of its bases.
///
/// Reads the cache only, never the network. `None` when neither the class nor any of its bases
/// is documented, or when nothing was fetched yet.
#[must_use]
pub fn class_docs(
    schema: &MetaSchema,
    class: BinHash,
    build: Option<GameBuild>,
) -> Option<ClassDocs> {
    let docs = OPEN.docs()?;
    docs.class_docs(&schema.lineage(class, build))
}

/// Refresh the cached documentation once per session, and return the session's revision.
///
/// The revision increases each time a newer copy is installed, so a query keyed on it fetches
/// again. The cache sends at most one request per [`ltk_meta_docs::REFRESH_INTERVAL`] across
/// sessions. A failure is logged, and the cached copy stays in place.
pub fn sync(user_agent: &str) -> u32 {
    let mut synced = SYNCED.lock();
    if !*synced {
        *synced = true;
        if let Some(docs) = refresh(user_agent) {
            OPEN.install(docs);
        }
    }
    OPEN.revision()
}

fn refresh(user_agent: &str) -> Option<MetaDocs> {
    let cache = cache()?;
    let fetch = PublishedDocs::new(user_agent)
        .inspect_err(|e| tracing::warn!("Could not build the meta wiki documentation client: {e}"))
        .ok()?;

    match cache.refresh(&fetch, SystemTime::now()) {
        Ok(Refresh::Installed(docs)) => Some(docs),
        Ok(Refresh::NotDue | Refresh::Unchanged) => None,
        Err(e) => {
            tracing::warn!("Could not refresh the meta wiki documentation: {e}");
            None
        }
    }
}

/// The documentation cache, in the meta schema database's directory because both come from
/// the same publisher.
fn cache() -> Option<DocsCache> {
    MetaSchemaCache::discover()
        .inspect_err(|e| tracing::debug!("No meta wiki documentation cache: {e}"))
        .ok()
        .map(|schema| DocsCache::at(schema.dir()))
}

static OPEN: Slot = Slot(Mutex::new(None));

/// Whether this session has refreshed. Locked during a refresh, so concurrent callers send one
/// request.
static SYNCED: Mutex<bool> = Mutex::new(false);

/// The session's documentation, loaded from the cache on first use.
#[derive(Debug)]
struct Slot(Mutex<Option<Open>>);

#[derive(Debug)]
struct Open {
    docs: Option<Arc<MetaDocs>>,
    revision: u32,
}

impl Slot {
    fn docs(&self) -> Option<Arc<MetaDocs>> {
        self.0
            .lock()
            .get_or_insert_with(|| Open {
                docs: cache().and_then(|cache| cache.load()).map(Arc::new),
                revision: 0,
            })
            .docs
            .clone()
    }

    fn install(&self, docs: MetaDocs) {
        let mut open = self.0.lock();
        let revision = open.as_ref().map_or(0, |open| open.revision) + 1;
        *open = Some(Open {
            docs: Some(Arc::new(docs)),
            revision,
        });
    }

    fn revision(&self) -> u32 {
        self.0.lock().as_ref().map_or(0, |open| open.revision)
    }
}
