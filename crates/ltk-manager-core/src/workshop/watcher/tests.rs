use std::sync::mpsc::{self, Receiver, Sender};

use super::*;
use crate::events::NullEventSink;
use crate::workshop::LayerFile;

/// Where the tests keep a project's Atlas sources.
const SOURCES_DIR: &str = "sources";

/// A sink that hands every layer file change to the test.
struct ChangeSink(Mutex<Sender<LayerFilesChanged>>);

impl EventSink for ChangeSink {
    fn emit(&self, event: BackendEvent) {
        if let BackendEvent::LayerFilesChanged(change) = event {
            let _ = self.0.lock().send(change);
        }
    }
}

fn project_with_layer() -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join(CONTENT_DIR).join("base")).unwrap();
    project
}

fn watches_reporting() -> (LayerWatches, Receiver<LayerFilesChanged>) {
    let (sender, receiver) = mpsc::channel();
    let sink = ChangeSink(Mutex::new(sender));
    (
        LayerWatches::new(Arc::new(sink), SandboxState::default()),
        receiver,
    )
}

fn refs(watches: &LayerWatches, project: &str) -> Option<usize> {
    watches.watches.lock().get(project).map(|watch| watch.refs)
}

#[test]
fn a_path_still_being_written_is_held_back() {
    let dir = tempfile::tempdir().unwrap();
    let done = dir.path().join("done.tex");
    let writing = dir.path().join("writing.tex");
    let batch = [
        DebouncedEvent::new(done.clone(), DebouncedEventKind::Any),
        DebouncedEvent::new(writing, DebouncedEventKind::AnyContinuous),
    ];

    assert_eq!(settled_files(&batch), vec![done]);
}

#[test]
fn a_directory_is_left_out_and_a_removed_file_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("assets");
    fs::create_dir(&folder).unwrap();
    let removed = dir.path().join("icon.tex");
    let batch = [
        DebouncedEvent::new(folder, DebouncedEventKind::Any),
        DebouncedEvent::new(removed.clone(), DebouncedEventKind::Any),
    ];

    assert_eq!(settled_files(&batch), vec![removed]);
}

#[test]
fn a_watch_runs_until_its_last_reference_is_released() {
    let project = project_with_layer();
    let path = project.path().to_str().unwrap();
    let watches = LayerWatches::new(Arc::new(NullEventSink), SandboxState::default());

    watches.acquire(path).unwrap();
    watches.acquire(path).unwrap();
    assert_eq!(refs(&watches, path), Some(2));

    watches.release(path);
    assert_eq!(refs(&watches, path), Some(1));

    watches.release(path);
    assert_eq!(refs(&watches, path), None);

    watches.release(path);
    assert_eq!(refs(&watches, path), None, "a stray release is a no-op");
}

#[test]
fn a_project_without_content_cannot_be_watched() {
    let project = tempfile::tempdir().unwrap();
    let watches = LayerWatches::new(Arc::new(NullEventSink), SandboxState::default());

    assert!(watches.acquire(project.path().to_str().unwrap()).is_err());
    assert!(watches.watches.lock().is_empty());
}

#[test]
fn a_file_saved_into_a_layer_is_announced() {
    let project = project_with_layer();
    let path = project.path().to_str().unwrap();
    let (watches, changes) = watches_reporting();
    watches.acquire(path).unwrap();

    fs::write(
        project
            .path()
            .join(CONTENT_DIR)
            .join("base")
            .join("icon.tex"),
        b"pixels",
    )
    .unwrap();

    let change = changes.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(change.project, path);
    assert_eq!(
        change.files,
        vec![LayerFile {
            layer: "base".to_owned(),
            path: "icon.tex".to_owned(),
        }]
    );
}

#[test]
fn an_atlas_source_saved_goes_to_the_rebuild_and_is_no_layer_file() {
    let project = project_with_layer();
    let path = project.path().to_str().unwrap();
    let (sender, rebuilt) = mpsc::channel();
    let sender = Mutex::new(sender);
    let (watches, changes) = watches_reporting();
    let watches = watches.with_sources(
        SOURCES_DIR,
        Arc::new(move |_: &str, changed: &[PathBuf]| {
            let _ = sender.lock().send(changed.to_vec());
        }),
    );
    /* A sheet's folder exists before its sources are edited. Inotify reports nothing written
    into a folder made under a watch before it watches that folder too. */
    let sheet = project.path().join(SOURCES_DIR).join("hud");
    fs::create_dir_all(&sheet).unwrap();
    watches.acquire(path).unwrap();

    fs::write(sheet.join("icon.png"), b"pixels").unwrap();

    let changed = rebuilt.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(changed.iter().any(|file| file.ends_with("icon.png")));
    assert!(changes.recv_timeout(Duration::from_secs(1)).is_err());
}
