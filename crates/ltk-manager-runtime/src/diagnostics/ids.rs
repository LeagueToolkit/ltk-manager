//! The ids of the run, the patcher session and the game that a log line belongs to.
//!
//! A manager process is one run, runs one patcher session at a time and follows one game at
//! a time, so the ids are process-wide. The log file formatter writes them on every line of
//! every thread. A tracing span cannot do that, because a span belongs to the thread that
//! entered it, and the lines of a session come from several threads.

use std::{
    fmt,
    sync::{
        OnceLock,
        atomic::{AtomicU32, Ordering},
    },
};

use chrono::{DateTime, Utc};
use parking_lot::{Mutex, const_mutex};

/// The text before the run id on a log line.
const RUN_PREFIX: &str = "run{id=";

/// One run of the manager.
#[derive(Debug)]
struct Run {
    /// Eight random hex characters.
    id: String,
    started_at: DateTime<Utc>,
}

/// The ids that the log file formatter writes on each line.
///
/// Formats as `run{id=4be1c07a}:session{n=2}:game{id=2026-11-11T19-02-04}`, without the
/// session if no session runs and without the game if no game is open. Formats as nothing
/// before [`Self::start_run`].
#[derive(Debug)]
pub struct LogIds {
    run: OnceLock<Run>,
    /// The number of sessions that started in this run.
    sessions: AtomicU32,
    /// The number of the running session, or 0 if no session runs.
    session: AtomicU32,
    game: Mutex<Option<String>>,
}

static GLOBAL: LogIds = LogIds::new();

impl LogIds {
    /// Returns ids with no run, no session and no game.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            run: OnceLock::new(),
            sessions: AtomicU32::new(0),
            session: AtomicU32::new(0),
            game: const_mutex(None),
        }
    }

    /// Returns the ids of this process.
    #[must_use]
    pub fn global() -> &'static Self {
        &GLOBAL
    }

    /// Starts the run with an id of eight random hex characters, and returns the id.
    ///
    /// Returns the id of the first call if the run already started.
    pub fn start_run(&self) -> &str {
        let run = self.run.get_or_init(|| {
            let mut id = uuid::Uuid::new_v4().simple().to_string();
            id.truncate(8);
            Run {
                id,
                started_at: Utc::now(),
            }
        });
        &run.id
    }

    /// Returns the id of the run, or `None` before [`Self::start_run`].
    #[must_use]
    pub fn run(&self) -> Option<&str> {
        self.run.get().map(|run| run.id.as_str())
    }

    /// Returns the time of the first [`Self::start_run`], or `None` before it.
    #[must_use]
    pub fn run_started_at(&self) -> Option<DateTime<Utc>> {
        self.run.get().map(|run| run.started_at)
    }

    /// Starts the next patcher session of the run. The session ends when the returned scope
    /// is dropped.
    ///
    /// Starts the run first if it has not started. The first session of a run has the
    /// number 1.
    pub fn begin_session(&self) -> SessionScope<'_> {
        self.start_run();
        let number = self.sessions.fetch_add(1, Ordering::SeqCst) + 1;
        self.session.store(number, Ordering::SeqCst);
        SessionScope { ids: self, number }
    }

    /// Returns the number of the running session, or `None` if no session runs.
    #[must_use]
    pub fn session(&self) -> Option<u32> {
        Some(self.session.load(Ordering::SeqCst)).filter(|number| *number != 0)
    }

    /// Sets the id of the open game. `None` closes the game.
    pub fn set_game(&self, id: Option<String>) {
        let mut game = self.game.lock();
        if *game != id {
            *game = id;
        }
    }

    /// Returns the id of the open game, or `None` if no game is open.
    #[must_use]
    pub fn game(&self) -> Option<String> {
        self.game.lock().clone()
    }

    /// Returns the run id of the log line `line`, as the ids are formatted after the time
    /// and the level. Returns `None` if the line carries no run id.
    #[must_use]
    pub fn run_of(line: &str) -> Option<&str> {
        let ids = line.split_whitespace().nth(2)?;
        let (run, _) = ids.strip_prefix(RUN_PREFIX)?.split_once('}')?;
        Some(run)
    }
}

impl Default for LogIds {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for LogIds {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Some(run) = self.run() else {
            return Ok(());
        };
        write!(f, "{RUN_PREFIX}{run}}}")?;
        if let Some(session) = self.session() {
            write!(f, ":session{{n={session}}}")?;
        }
        if let Some(game) = self.game.lock().as_deref() {
            write!(f, ":game{{id={game}}}")?;
        }
        Ok(())
    }
}

/// One patcher session of a run. Dropping the scope ends the session and closes its game.
#[derive(Debug)]
pub struct SessionScope<'a> {
    ids: &'a LogIds,
    number: u32,
}

impl SessionScope<'_> {
    /// Returns the number of the session inside its run.
    #[must_use]
    pub fn number(&self) -> u32 {
        self.number
    }

    /// Returns the ids of the session, for the game records of the session.
    #[must_use]
    pub fn ids(&self) -> SessionIds {
        SessionIds {
            run: self.ids.start_run().to_owned(),
            session: self.number,
        }
    }
}

/// The run and the patcher session that a game belongs to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionIds {
    /// The id of the run of the manager.
    pub run: String,
    /// The number of the session inside the run.
    pub session: u32,
}

impl Drop for SessionScope<'_> {
    fn drop(&mut self) {
        // A later session can have started, and then the ids are its own.
        let ended =
            self.ids
                .session
                .compare_exchange(self.number, 0, Ordering::SeqCst, Ordering::SeqCst);
        if ended.is_ok() {
            self.ids.set_game(None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_writes_nothing_before_the_run_starts() {
        let ids = LogIds::new();
        assert_eq!(ids.run(), None);
        ids.set_game(Some("2026-11-11T19-02-04".to_owned()));

        assert_eq!(ids.to_string(), "");
    }

    #[test]
    fn display_writes_the_ids_that_are_open() {
        let ids = LogIds::new();
        let run = ids.start_run().to_owned();
        assert_eq!(run.len(), 8);
        assert_eq!(ids.start_run(), run);
        assert_eq!(ids.to_string(), format!("run{{id={run}}}"));

        let session = ids.begin_session();
        assert_eq!(session.number(), 1);
        assert_eq!(ids.to_string(), format!("run{{id={run}}}:session{{n=1}}"));

        ids.set_game(Some("2026-11-11T19-02-04".to_owned()));
        assert_eq!(
            ids.to_string(),
            format!("run{{id={run}}}:session{{n=1}}:game{{id=2026-11-11T19-02-04}}")
        );
    }

    #[test]
    fn dropping_the_scope_ends_the_session_and_closes_its_game() {
        let ids = LogIds::new();
        let first = ids.begin_session();
        ids.set_game(Some("2026-11-11T19-02-04".to_owned()));
        drop(first);

        assert_eq!(ids.session(), None);
        assert_eq!(ids.game(), None);
        assert_eq!(ids.begin_session().number(), 2);
    }

    #[test]
    fn dropping_an_older_scope_keeps_the_running_session() {
        let ids = LogIds::new();
        let first = ids.begin_session();
        let second = ids.begin_session();
        ids.set_game(Some("2026-11-11T19-02-04".to_owned()));
        drop(first);

        assert_eq!(ids.session(), Some(second.number()));
        assert!(ids.game().is_some());
    }

    #[test]
    fn run_of_reads_the_id_after_the_time_and_the_level() {
        let line = "2026-11-11T19:02:11.412Z  WARN run{id=4be1c07a}:session{n=2}:game{id=2026-11-11T19-02-04}: ltk_dll: refused";
        assert_eq!(LogIds::run_of(line), Some("4be1c07a"));
        assert_eq!(
            LogIds::run_of("2026-11-11T19:02:11.412Z  INFO run{id=4be1c07a}: ltk_manager: started"),
            Some("4be1c07a")
        );
    }

    #[test]
    fn run_of_returns_none_for_a_line_without_a_run_id() {
        assert_eq!(
            LogIds::run_of(
                "2026-11-11T19:02:11.412Z  INFO ltk_manager: a line of an older release"
            ),
            None
        );
        assert_eq!(
            LogIds::run_of(
                "2026-11-11T19:02:11.412Z  INFO ltk_manager: the text run{id=4be1c07a} in a message"
            ),
            None
        );
        assert_eq!(LogIds::run_of(""), None);
    }
}
