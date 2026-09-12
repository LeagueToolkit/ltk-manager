//! What the cache installs, what it declines to install, and what it serves.

use fs_err as fs;

use super::*;

/// A published database whose newest build is `latest`, cut to one property.
fn published(latest: u32) -> Vec<u8> {
    published_at("2026-08-24T03:56:00Z", latest)
}

/// The same, under the publisher's stamp for the tables behind it.
fn published_at(fetched_at: &str, latest: u32) -> Vec<u8> {
    format!(
        r#"{{
          "formatVersion": 1,
          "hashSource": {{ "fetchedAt": "{fetched_at}" }},
          "latest": {latest},
          "versions": [{{ "patch": "16.17", "build": {latest} }}],
          "classes": {{
            "0x16d88f43": {{
              "name": "FloatTextIconData",
              "properties": {{
                "0x10537b0c": {{
                  "name": "mIconFileName",
                  "revisions": [
                    {{ "from": 5229820, "type": ["File", "0x0", "0x0", "0x0"] }}
                  ]
                }}
              }}
            }}
          }}
        }}"#
    )
    .into_bytes()
}

/// Serves one answer, and records what it was asked with.
struct Serving {
    answer: Fetched,
    asked_with: parking_lot::Mutex<Option<Option<String>>>,
}

impl Serving {
    fn body(json: Vec<u8>, etag: &str) -> Self {
        Self::answering(Fetched::Body {
            json,
            etag: Some(etag.to_owned()),
        })
    }

    fn unchanged() -> Self {
        Self::answering(Fetched::Unchanged)
    }

    fn answering(answer: Fetched) -> Self {
        Self {
            answer,
            asked_with: parking_lot::Mutex::new(None),
        }
    }

    /// The tag it was handed, and `None` where it was never called.
    fn asked_with(&self) -> Option<Option<String>> {
        self.asked_with.lock().clone()
    }
}

impl FetchDb for Serving {
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDbError> {
        *self.asked_with.lock() = Some(known.map(str::to_owned));
        Ok(match &self.answer {
            Fetched::Unchanged => Fetched::Unchanged,
            Fetched::Body { json, etag } => Fetched::Body {
                json: json.clone(),
                etag: etag.clone(),
            },
        })
    }
}

/// Story: a machine that has never synced fetches the published database, and
/// from then on the schema a check reads is the one it fetched rather than the
/// snapshot this build shipped.
#[test]
fn a_first_refresh_installs_the_published_database() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());

    let report = cache.refresh(&Serving::body(published(9_000_000), "etag-1"));

    assert!(report.unwrap().installed, "an empty cache had nothing yet");
    assert_eq!(
        cache.load(None).latest(),
        9_000_000,
        "the fetched database, not the shipped snapshot"
    );
}

/// Story: a sync on a machine already holding the published copy sends the tag
/// of what it holds, the publisher answers that nothing moved, and 3.7 MB is
/// not downloaded to arrive at the file already on disk.
#[test]
fn a_database_that_has_not_moved_is_not_downloaded_again() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());
    cache
        .refresh(&Serving::body(published(9_000_000), "etag-1"))
        .unwrap();

    let again = Serving::unchanged();
    let report = cache.refresh(&again).unwrap();

    assert!(!report.installed, "nothing to install");
    assert_eq!(
        again.asked_with(),
        Some(Some("etag-1".to_owned())),
        "asked with the tag of the copy it holds"
    );
    assert_eq!(
        cache.load(None).latest(),
        9_000_000,
        "the copy it held stands"
    );
}

/// Story: a truncated download, or an error page served where the database
/// should be, must never replace a copy that reads - a cache a check cannot
/// parse is every bin rule gone quiet. The tag must not be adopted either, or
/// the next sync asks with the rejected body's tag and is told nothing moved.
#[test]
fn a_body_that_is_not_the_database_leaves_the_cache_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());
    cache
        .refresh(&Serving::body(published(9_000_000), "etag-1"))
        .unwrap();

    let refused = cache.refresh(&Serving::body(
        b"<html>502 Bad Gateway</html>".to_vec(),
        "etag-2",
    ));

    assert!(refused.is_err(), "{refused:?}");
    assert_eq!(
        cache.load(None).latest(),
        9_000_000,
        "the copy it held stands"
    );

    let again = Serving::unchanged();
    cache.refresh(&again).unwrap();
    assert_eq!(
        again.asked_with(),
        Some(Some("etag-1".to_owned())),
        "the refused body's tag was never adopted"
    );
}

/// Story: a cached database describes builds up to the patch it was fetched at.
/// When the game has since moved past it and the snapshot this build ships has
/// not, every check would stand down against the cache while the snapshot could
/// answer - so the copy that covers the install is the one that is read.
#[test]
fn a_cached_database_the_game_has_outrun_loses_to_one_that_covers_it() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());
    let shipped = MetaSchema::shipped().latest();
    cache
        .refresh(&Serving::body(published(shipped - 1), "fetched-long-ago"))
        .unwrap();

    let outrun = GameBuild::new(16, 99, shipped);
    let covered = GameBuild::new(16, 98, shipped - 1);

    assert_eq!(
        cache.load(Some(outrun)).latest(),
        shipped,
        "only the shipped snapshot describes this install"
    );
    assert_eq!(
        cache.load(Some(covered)).latest(),
        shipped - 1,
        "the cache describes this install, so the cache stands"
    );
    assert_eq!(
        cache.load(None).latest(),
        shipped - 1,
        "no install to judge against is no reason to drop the cache"
    );
}

/// Story: the app asks unasked whether an update is out, and that question must
/// not answer itself - pressing Sync stays the only thing that moves what a
/// verdict is a claim about.
#[test]
fn a_check_reports_the_database_behind_and_installs_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());

    assert!(
        cache
            .check(&Serving::body(published(9_000_000), "etag-1"))
            .unwrap()
            .is_some(),
        "a cache holding nothing is behind whatever is published"
    );

    cache
        .refresh(&Serving::body(published(9_000_000), "etag-1"))
        .unwrap();
    assert_eq!(
        cache.check(&Serving::unchanged()).unwrap(),
        None,
        "the copy it holds is the published one"
    );

    let newer = Serving::body(published(9_100_000), "etag-2");
    assert!(
        cache.check(&newer).unwrap().is_some(),
        "a newer database is published"
    );
    assert_eq!(
        newer.asked_with(),
        Some(Some("etag-1".to_owned())),
        "asked with the tag of the copy it holds"
    );
    assert_eq!(
        cache.load(None).latest(),
        9_000_000,
        "and the check installed none of it"
    );
}

/// Story: a Settings row saying an update is out names which database is held
/// and which is coming. Reading 3.7 MB of JSON to answer that on a timer is not
/// something a check may do, so the stamp beside the copy carries what it is.
#[test]
fn a_check_names_the_database_held_and_the_one_published() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());

    assert_eq!(
        cache.generation(),
        None,
        "a cache holding nothing names none"
    );

    cache
        .refresh(&Serving::body(published(9_000_000), "etag-1"))
        .unwrap();
    assert_eq!(cache.generation().as_deref(), Some("2026-08-24T03:56:00Z"));

    let published_now = published_at("2026-09-01T00:00:00Z", 9_100_000);
    let coming = cache
        .check(&Serving::body(published_now, "etag-2"))
        .unwrap()
        .expect("the database that is out");
    assert_eq!(coming.build, 9_100_000, "how far the one published reaches");
    assert_eq!(coming.patch.as_deref(), Some("16.17"));
    assert_eq!(coming.generation, "2026-09-01T00:00:00Z");
    assert_eq!(
        cache.check(&Serving::unchanged()).unwrap(),
        None,
        "nothing is out"
    );
}

/// The database lands beside the tables rather than under the manager's own
/// data, which is the whole of what sharing it across LeagueToolkit tools means
/// on disk.
#[test]
fn the_cache_sits_beside_the_hashtables() {
    let tables = HashtableCache::discover().expect("this machine has a data directory");
    let meta = MetaSchemaCache::discover().expect("so it has a place for the database");

    assert_eq!(meta.dir().parent(), tables.dir().parent());
    assert_eq!(meta.dir().file_name().unwrap(), "meta");
}

/// The transport, against the publisher itself.
///
/// Ignored by default because it reaches the network, and kept because it is
/// the one part of this module the fakes above cannot speak for: the URL, the
/// conditional header and the tag that comes back are only ever exercised here.
/// Run it with `cargo test -p ltk-manager-core -- --ignored`.
#[test]
#[ignore = "reaches the LTK Meta Wiki"]
fn the_publisher_serves_a_database_and_then_a_not_modified() {
    let tmp = tempfile::tempdir().unwrap();
    let cache = MetaSchemaCache::at(tmp.path());
    let fetch = PublishedDb::new("ltk-manager-tests").unwrap();

    assert!(cache.refresh(&fetch).unwrap().installed, "first fetch");
    assert!(cache.generation().is_some(), "stamped with what it holds");
    assert!(
        cache.load(None).class_count() > 5_000,
        "the published database, not the shipped snapshot"
    );

    assert!(
        !cache.refresh(&fetch).unwrap().installed,
        "the tag it just stored is the published one"
    );
    assert_eq!(cache.check(&fetch).unwrap(), None, "nothing is out");
}

/// Story: a full disk, or a cache directory that cannot be created, must not
/// leave a stamp claiming a database that is not on disk. A stamp written
/// anyway would go out as the tag of the next conditional fetch, and the
/// publisher would answer that nothing moved - stranding the machine on the
/// shipped snapshot until something else forced a refetch.
#[test]
fn a_cache_that_cannot_be_written_reports_it_and_stamps_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let blocking = tmp.path().join("a-file-where-the-directory-would-go");
    fs::write(&blocking, b"not a directory").unwrap();
    let cache = MetaSchemaCache::at(blocking.join("meta"));

    let refused = cache.refresh(&Serving::body(published(9_000_000), "etag-1"));

    assert!(
        matches!(refused, Err(RefreshError::Write(_))),
        "{refused:?}"
    );
    assert_eq!(cache.generation(), None, "nothing was stamped");
}
