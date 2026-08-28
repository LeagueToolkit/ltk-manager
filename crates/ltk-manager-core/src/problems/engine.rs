//! One pass of every rule over one project.
//!
//! A run walks each layer's content directory, hands the files to each rule and
//! collects what the rules report. A rule that throws does not take the run
//! with it: a project with one unreadable `.bin` still gets every problem in
//! the other forty, and the panel names the file it could not read.

use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::Utc;
use ltk_file::LeagueFileKind;
use walkdir::WalkDir;

use crate::config::Config;
use crate::error::AppResult;
use crate::workshop::layer;
use crate::workshop::{ProjectDir, WorkshopFileKind};

use super::budget::Budget;
use super::{BinNames, GameBuild, ObjectInfo, Report, RuleState, Run};

/// The directory a project keeps its layers under.
const CONTENT_DIR: &str = "content";

/// The files of one project, and what else a run hands every rule.
///
/// Built once for a run and shared by every rule, because walking the content
/// directory is the one cost worth paying exactly once. Reading a file's bytes
/// is each rule's own business.
///
/// The installed build and the hash tables ride here too. A rule needs all
/// three to decide what it has to say, and each of them costs the same
/// whichever rule reads it.
#[derive(Debug)]
pub struct ProjectFiles {
    root: PathBuf,
    layers: Vec<LayerFiles>,
    build: Option<GameBuild>,
    names: BinNames,
    budget: Budget,
}

impl ProjectFiles {
    /// Walk `project_root`'s content directory, in every layer.
    ///
    /// # Errors
    ///
    /// Reports a project whose `content/` directory cannot be read at all. An
    /// unreadable file inside it is skipped and logged, never fatal.
    pub fn read(project_root: &Path, config: &Config) -> AppResult<Self> {
        Self::within(project_root, config, Budget::repair())
    }

    /// [`read`](Self::read) under a caller's own budget.
    ///
    /// # Errors
    ///
    /// The same as [`read`](Self::read).
    pub fn within(project_root: &Path, config: &Config, budget: Budget) -> AppResult<Self> {
        let content_dir = project_root.join(CONTENT_DIR);
        let layers = if content_dir.exists() {
            layer::dirs_in(&content_dir)?
                .iter()
                .map(|dir| {
                    let name = dir
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default();
                    LayerFiles::read(dir, name)
                })
                .collect()
        } else {
            Vec::new()
        };

        Ok(Self {
            root: project_root.to_path_buf(),
            layers,
            build: GameBuild::installed(config),
            names: BinNames::open(),
            budget,
        })
    }

    /// The project's own directory.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The layers, in the order the content directory lists them.
    #[must_use]
    pub fn layers(&self) -> &[LayerFiles] {
        &self.layers
    }

    /// The installed game's content build, where one could be read.
    #[must_use]
    pub fn build(&self) -> Option<GameBuild> {
        self.build
    }

    /// The names a row can give the hashes a bin holds.
    #[must_use]
    pub fn names(&self) -> &BinNames {
        &self.names
    }

    /// The memory this run may hold parsed at once, and its cancel flag.
    ///
    /// A rule fans its own files out through this rather than over a pool of
    /// its own, so every rule of every mod in flight spends one allowance.
    #[must_use]
    pub fn budget(&self) -> &Budget {
        &self.budget
    }

    /// Every file of every layer that reports `kind`.
    pub fn by_kind(
        &self,
        kind: WorkshopFileKind,
    ) -> impl Iterator<Item = (&LayerFiles, &ProjectFile)> {
        self.layers.iter().flat_map(move |layer| {
            layer
                .files
                .iter()
                .filter(move |file| file.kind == kind)
                .map(move |file| (layer, file))
        })
    }

    /// Every property bin of every layer, override bins included.
    ///
    /// The seam a bin rule reads through: it names the files and hands back a
    /// handle rather than the bytes, so the day `ltk_meta` can read a bin
    /// lazily, [`BinHandle::read`] is the only thing that changes.
    pub fn bins(&self) -> impl Iterator<Item = BinHandle<'_>> {
        self.by_kind(WorkshopFileKind::PropertyBin)
            .chain(self.by_kind(WorkshopFileKind::PropertyBinOverride))
            .map(|(layer, file)| BinHandle { layer, file })
    }

    /// How many files the whole project holds.
    fn file_count(&self) -> usize {
        self.layers.iter().map(|layer| layer.files.len()).sum()
    }
}

/// The files inside one layer's content directory.
#[derive(Debug, Clone)]
pub struct LayerFiles {
    /// The layer's own name, such as `base`.
    pub name: String,
    /// The layer's content directory.
    pub root: PathBuf,
    pub files: Vec<ProjectFile>,
}

impl LayerFiles {
    /// Walk one layer's content directory, recursively.
    ///
    /// An entry the walk cannot read is logged and skipped, because one
    /// unreadable directory is no reason to report nothing about the rest.
    fn read(dir: &Path, name: &str) -> Self {
        let walk = WalkDir::new(dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                // The walk starts at the layer root, whose basename is out of
                // the project's hands - a temp directory may begin with a dot.
                entry.depth() == 0
                    || entry
                        .file_name()
                        .to_str()
                        .is_some_and(|name| !name.starts_with('.'))
            });

        let mut files = Vec::new();
        for entry in walk {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    tracing::warn!("Skipping unreadable entry in {}: {e}", dir.display());
                    continue;
                }
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or_else(|_| entry.path())
                .components()
                .filter_map(|part| part.as_os_str().to_str())
                .collect::<Vec<_>>()
                .join("/");

            let extension = entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("");

            files.push(ProjectFile {
                path,
                kind: WorkshopFileKind::from(LeagueFileKind::from_extension(extension)),
                size_bytes: entry.metadata().map(|meta| meta.len()).unwrap_or(0),
            });
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));

        Self {
            name: name.to_owned(),
            root: dir.to_path_buf(),
            files,
        }
    }

    /// Where one of this layer's files is on disk.
    #[must_use]
    pub fn absolute(&self, file: &ProjectFile) -> PathBuf {
        self.root
            .join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR))
    }
}

/// One property bin of one layer, not yet read.
///
/// Names where the bin is and opens it on demand. A rule holds one per file and
/// parses at most once, which is what keeps a check and the repair that follows
/// it to a single read.
#[derive(Debug, Clone, Copy)]
pub struct BinHandle<'a> {
    layer: &'a LayerFiles,
    file: &'a ProjectFile,
}

impl<'a> BinHandle<'a> {
    /// The layer this bin sits in, such as `base`.
    #[must_use]
    pub fn layer(&self) -> &'a str {
        &self.layer.name
    }

    /// The bin's path, POSIX-style and relative to the layer root.
    #[must_use]
    pub fn path(&self) -> &'a str {
        &self.file.path
    }

    /// The bin's size on disk, which is what a budget is spent in.
    #[must_use]
    pub fn size_bytes(&self) -> u64 {
        self.file.size_bytes
    }

    /// Where the bin sits on disk.
    #[must_use]
    pub fn absolute(&self) -> PathBuf {
        self.layer.absolute(self.file)
    }

    /// Parse the bin.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open or parse, as one sentence a panel
    /// can draw.
    pub fn read(&self) -> Result<ltk_meta::Bin, String> {
        let bytes = std::fs::read(self.absolute()).map_err(|e| e.to_string())?;
        ltk_meta::Bin::from_reader(&mut std::io::Cursor::new(&bytes)).map_err(|e| e.to_string())
    }
}

/// One file of one layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFile {
    /// Relative to the layer root, always POSIX-style.
    pub path: String,
    pub kind: WorkshopFileKind,
    pub size_bytes: u64,
}

/// Run every rule over one project.
///
/// # Errors
///
/// Reports a project that cannot be opened or whose content directory cannot
/// be read. A rule that fails is recorded in [`Run::failed`] rather than
/// failing the run.
pub fn analyze(project_root: &Path, config: &Config) -> AppResult<Run> {
    analyze_within(project_root, config, Budget::repair())
}

/// [`analyze`] under a caller's own budget.
///
/// # Errors
///
/// The same as [`analyze`].
pub fn analyze_within(project_root: &Path, config: &Config, budget: Budget) -> AppResult<Run> {
    let started = Instant::now();

    let project = ProjectDir::open(project_root)?;
    let files = ProjectFiles::within(project.path(), config, budget)?;
    let at = Utc::now();

    let mut report = Report::default();
    let mut rules = Vec::new();
    for rule in super::rules::all() {
        let mut info = rule.info();
        if let Some(dormancy) = rule.dormant(&files) {
            info.state = RuleState::Dormant {
                waiting: dormancy.waiting,
                reason: dormancy.reason,
                detail: dormancy.detail,
            };
        }
        rules.push(info);
        rule.check(&files, &mut report);
    }
    let (mut problems, failed) = report.finish();

    // The panel draws this list in the order it arrives, so the order is the
    // engine's to decide: worst first, then by where the problem is.
    problems.sort_by(|a, b| {
        a.severity
            .cmp(&b.severity)
            .then_with(|| a.site.layer.cmp(&b.site.layer))
            .then_with(|| a.site.path.cmp(&b.site.path))
            .then_with(|| {
                let a = a.site.node.as_ref().map(|node| node.path.as_str());
                let b = b.site.node.as_ref().map(|node| node.path.as_str());
                a.cmp(&b)
            })
    });

    let objects = ObjectInfo::catalogue(&problems, files.names());

    tracing::trace!(
        "Analyzed {} files of {}: {} problems, {} rule failures, in {:?}",
        files.file_count(),
        project.path().display(),
        problems.len(),
        failed.len(),
        started.elapsed()
    );

    Ok(Run {
        at,
        rules,
        objects,
        problems,
        failed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Write `contents` to `path`, creating every directory above it.
    fn touch(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn layer(files: &ProjectFiles, name: &str) -> LayerFiles {
        files
            .layers()
            .iter()
            .find(|layer| layer.name == name)
            .unwrap_or_else(|| panic!("no layer named {name}"))
            .clone()
    }

    fn paths(layer: &LayerFiles) -> Vec<&str> {
        layer.files.iter().map(|file| file.path.as_str()).collect()
    }

    #[test]
    fn every_layer_on_disk_is_read_with_base_first() {
        let tmp = tempfile::tempdir().unwrap();
        for name in ["zephyr", "base", "alt"] {
            touch(
                &tmp.path().join(CONTENT_DIR).join(name).join("a.bin"),
                b"bin",
            );
        }

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        let names: Vec<&str> = files
            .layers()
            .iter()
            .map(|layer| layer.name.as_str())
            .collect();
        assert_eq!(names, ["base", "alt", "zephyr"]);
    }

    #[test]
    fn a_dot_directory_under_content_is_not_a_layer() {
        let tmp = tempfile::tempdir().unwrap();
        touch(
            &tmp.path().join(CONTENT_DIR).join("base").join("a.bin"),
            b"bin",
        );
        touch(
            &tmp.path().join(CONTENT_DIR).join(".git").join("HEAD"),
            b"ref",
        );

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        assert_eq!(files.layers().len(), 1);
        assert_eq!(files.layers()[0].name, "base");
    }

    #[test]
    fn a_dot_file_inside_a_layer_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join(CONTENT_DIR).join("base");
        touch(&base.join("a.bin"), b"bin");
        touch(&base.join(".hidden.bin"), b"bin");
        touch(&base.join(".tools").join("b.bin"), b"bin");

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
    }

    /// A site's path crosses IPC and keys a fix, so it has to read the same on
    /// Windows as it does anywhere else.
    #[test]
    fn a_path_is_posix_style_and_relative_to_the_layer_root() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join(CONTENT_DIR).join("base");
        touch(
            &base
                .join("Smolder.wad.client")
                .join("data")
                .join("characters")
                .join("x.bin"),
            b"bin",
        );

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        assert_eq!(
            paths(&layer(&files, "base")),
            ["Smolder.wad.client/data/characters/x.bin"]
        );
    }

    #[test]
    fn a_kind_comes_from_the_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join(CONTENT_DIR).join("base");
        touch(&base.join("skin0.bin"), b"bin");
        touch(&base.join("notes.txt"), b"hello");

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        let base = layer(&files, "base");
        assert_eq!(paths(&base), ["notes.txt", "skin0.bin"]);
        assert_ne!(base.files[0].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(base.files[1].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(base.files[1].size_bytes, 3);
    }

    #[test]
    fn a_project_with_no_content_directory_reports_no_layers() {
        let tmp = tempfile::tempdir().unwrap();
        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();

        assert!(files.layers().is_empty());
        assert_eq!(files.root(), tmp.path());
    }

    #[test]
    fn by_kind_pairs_each_matching_file_with_its_layer() {
        let tmp = tempfile::tempdir().unwrap();
        let content = tmp.path().join(CONTENT_DIR);
        touch(&content.join("base").join("skin0.bin"), b"bin");
        touch(&content.join("base").join("notes.txt"), b"hello");
        touch(&content.join("chroma").join("skin1.bin"), b"bin");

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        let found: Vec<(&str, &str)> = files
            .by_kind(WorkshopFileKind::PropertyBin)
            .map(|(layer, file)| (layer.name.as_str(), file.path.as_str()))
            .collect();

        assert_eq!(found, [("base", "skin0.bin"), ("chroma", "skin1.bin")]);
    }

    #[test]
    fn an_absolute_path_rebuilds_a_file_a_rule_can_open() {
        let tmp = tempfile::tempdir().unwrap();
        touch(
            &tmp.path()
                .join(CONTENT_DIR)
                .join("base")
                .join("data")
                .join("x.bin"),
            b"bin",
        );

        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();
        let base = layer(&files, "base");
        let absolute = base.absolute(&base.files[0]);

        assert_eq!(fs::metadata(&absolute).unwrap().len(), 3);
    }

    #[test]
    fn a_config_with_no_league_path_names_no_build() {
        let tmp = tempfile::tempdir().unwrap();
        let files = ProjectFiles::read(tmp.path(), &Config::default()).unwrap();

        assert_eq!(files.build(), None);
    }

    #[test]
    fn analyzing_a_directory_that_is_not_a_project_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("charizard-smolder-x");

        assert_matches::assert_matches!(
            analyze(&missing, &Config::default()),
            Err(crate::error::AppError::ProjectNotFound(_))
        );
    }

    #[test]
    fn analyzing_a_project_with_nothing_to_report_finds_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        touch(
            &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
            b"hello",
        );

        let run = analyze(tmp.path(), &Config::default()).unwrap();
        assert!(run.problems.is_empty());
        assert!(run.failed.is_empty());
    }

    /// A run over a project with nothing to gate on lists every rule as
    /// speaking, which is what a panel needs to tell a clean project from a
    /// quiet one.
    #[test]
    fn a_rule_with_nothing_to_wait_for_is_listed_as_active() {
        let tmp = tempfile::tempdir().unwrap();
        touch(
            &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
            b"hello",
        );

        let run = analyze(tmp.path(), &Config::default()).unwrap();
        assert!(!run.rules.is_empty());
        assert!(run.rules.iter().all(|info| info.state == RuleState::Active));
    }

    /// A game install from before the one shipped table, so every rule keyed
    /// on that build reports what it is waiting for.
    fn project_on_an_older_game() -> (tempfile::TempDir, Config) {
        let tmp = tempfile::tempdir().unwrap();
        touch(
            &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
            b"hello",
        );

        let league = tmp.path().join("league");
        touch(
            &league.join("Game").join("content-metadata.json"),
            br#"{ "version": "16.16.8049184+branch.releases-16-16.content.release" }"#,
        );

        let config = Config {
            league_path: Some(league),
            ..Config::default()
        };
        (tmp, config)
    }

    #[test]
    fn a_rule_waiting_on_a_newer_game_says_so_on_the_run() {
        let (tmp, config) = project_on_an_older_game();

        let run = analyze(tmp.path(), &config).unwrap();
        let dormant: Vec<_> = run
            .rules
            .iter()
            .filter(|info| info.state != RuleState::Active)
            .collect();

        assert_eq!(dormant.len(), 1, "the bin retype rule is the keyed one");
        let RuleState::Dormant {
            waiting,
            reason,
            detail,
        } = &dormant[0].state
        else {
            unreachable!("filtered on it")
        };
        assert_eq!(waiting, "Patch 16.17");
        assert!(reason.contains("16.17"), "{reason}");
        let detail = detail.as_deref().expect("the rule names both builds");
        assert!(detail.contains("16.17.8087655"), "{detail}");
        assert!(detail.contains("16.16.8049184"), "{detail}");
    }
}
