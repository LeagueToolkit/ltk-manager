use std::cell::RefCell;

use super::*;

const PAYLOAD: &str = r#"{ "A": { "class": { "description": "A class." }, "properties": {} } }"#;

/// A fake publisher that returns scripted responses and records the tag each request sent.
struct Scripted {
    answers: RefCell<Vec<Fetched>>,
    asked: RefCell<Vec<Option<String>>>,
}

impl Scripted {
    fn new(answers: Vec<Fetched>) -> Self {
        Self {
            answers: RefCell::new(answers),
            asked: RefCell::new(Vec::new()),
        }
    }

    fn body(json: &str, etag: &str) -> Fetched {
        Fetched::Body {
            json: json.as_bytes().to_vec(),
            etag: Some(etag.to_owned()),
        }
    }

    fn asked(&self) -> Vec<Option<String>> {
        self.asked.borrow().clone()
    }
}

impl FetchDocs for Scripted {
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDocsError> {
        self.asked.borrow_mut().push(known.map(str::to_owned));
        Ok(self.answers.borrow_mut().remove(0))
    }
}

fn at(hours: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_800_000_000 + hours * 60 * 60)
}

#[test]
fn a_first_refresh_installs_the_published_documentation() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = DocsCache::at(dir.path());
    let publisher = Scripted::new(vec![Scripted::body(PAYLOAD, "W/\"one\"")]);

    let refresh = cache.refresh(&publisher, at(0)).expect("the refresh lands");

    assert!(matches!(refresh, Refresh::Installed(_)));
    assert_eq!(publisher.asked(), [None]);
    assert_eq!(cache.load().map(|docs| docs.class_count()), Some(1));
}

#[test]
fn a_copy_checked_within_the_interval_asks_nothing() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = DocsCache::at(dir.path());
    let publisher = Scripted::new(vec![Scripted::body(PAYLOAD, "W/\"one\"")]);
    cache
        .refresh(&publisher, at(0))
        .expect("the first refresh lands");

    let refresh = cache
        .refresh(&publisher, at(5))
        .expect("the refresh answers");

    assert!(matches!(refresh, Refresh::NotDue));
    assert_eq!(publisher.asked().len(), 1);
}

#[test]
fn a_due_copy_is_asked_about_with_its_tag() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = DocsCache::at(dir.path());
    let publisher = Scripted::new(vec![
        Scripted::body(PAYLOAD, "W/\"one\""),
        Fetched::Unchanged,
        Fetched::Unchanged,
    ]);
    cache
        .refresh(&publisher, at(0))
        .expect("the first refresh lands");

    let refresh = cache
        .refresh(&publisher, at(6))
        .expect("the refresh answers");
    let again = cache
        .refresh(&publisher, at(7))
        .expect("the refresh answers");

    assert!(matches!(refresh, Refresh::Unchanged));
    assert!(matches!(again, Refresh::NotDue));
    assert_eq!(publisher.asked(), [None, Some("W/\"one\"".to_owned())]);
}

#[test]
fn a_body_that_is_not_the_documentation_leaves_the_cache_alone() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = DocsCache::at(dir.path());
    let publisher = Scripted::new(vec![
        Scripted::body(PAYLOAD, "W/\"one\""),
        Scripted::body("<html>", "W/\"two\""),
        Fetched::Unchanged,
    ]);
    cache
        .refresh(&publisher, at(0))
        .expect("the first refresh lands");

    let refused = cache.refresh(&publisher, at(6));
    cache
        .refresh(&publisher, at(6))
        .expect("the refresh answers");

    assert!(matches!(refused, Err(RefreshError::Unusable(_))));
    assert_eq!(cache.load().map(|docs| docs.class_count()), Some(1));
    assert_eq!(publisher.asked()[2].as_deref(), Some("W/\"one\""));
}

#[test]
fn a_stamp_without_its_payload_fetches_the_body_again() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = DocsCache::at(dir.path());
    let publisher = Scripted::new(vec![
        Scripted::body(PAYLOAD, "W/\"one\""),
        Scripted::body(PAYLOAD, "W/\"one\""),
    ]);
    cache
        .refresh(&publisher, at(0))
        .expect("the first refresh lands");
    fs::remove_file(dir.path().join(DOCS_FILENAME)).expect("the payload is removed");

    let refresh = cache.refresh(&publisher, at(1)).expect("the refresh lands");

    assert!(matches!(refresh, Refresh::Installed(_)));
    assert_eq!(publisher.asked(), [None, None]);
}

#[test]
fn a_clock_moved_back_past_the_check_reads_as_due() {
    let stamp = Stamp {
        etag: None,
        checked_at: seconds(at(10)),
    };

    assert!(stamp.is_due(at(0)));
    assert!(!stamp.is_due(at(11)));
}
