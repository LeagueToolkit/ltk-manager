//! The format of one line of the log file.

use std::fmt;

use ltk_manager_runtime::diagnostics::ids::LogIds;
use tracing::{Event, Subscriber};
use tracing_log::NormalizeEvent;
use tracing_subscriber::{
    fmt::{
        format::Writer,
        time::{FormatTime, SystemTime},
        FmtContext, FormatEvent, FormatFields,
    },
    registry::LookupSpan,
};

/// Formats a log event as `<time> <level> <ids>: <target>: <fields>`.
///
/// The ids are the run, the patcher session and the game of the process at the time of the
/// event, so every thread writes them. A line has no ids before the run starts.
pub struct LineFormat {
    ids: &'static LogIds,
}

impl LineFormat {
    /// Returns the format that writes `ids` on each line.
    pub fn new(ids: &'static LogIds) -> Self {
        Self { ids }
    }
}

impl<S, N> FormatEvent<S, N> for LineFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        // An event of the `log` crate holds its level and its target in fields.
        let normalized = event.normalized_metadata();
        let metadata = normalized.as_ref().unwrap_or_else(|| event.metadata());

        SystemTime.format_time(&mut writer)?;
        write!(writer, " {:>5} ", metadata.level())?;
        if self.ids.run().is_some() {
            write!(writer, "{}: ", self.ids)?;
        }
        write!(writer, "{}: ", metadata.target())?;
        ctx.field_format().format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io,
        sync::{Arc, Mutex},
    };

    use tracing_subscriber::fmt::MakeWriter;

    use super::*;

    /// A writer that keeps what the subscriber writes.
    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl io::Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Buffer {
        type Writer = Self;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    /// Returns the line that `LineFormat` writes for one warning while `ids` are current.
    fn line(ids: &'static LogIds) -> String {
        let buffer = Buffer::default();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .event_format(LineFormat::new(ids))
            .with_writer(buffer.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            tracing::warn!(target: "ltk_dll", code = 8, "refusing overlay");
        });
        let bytes = buffer.0.lock().unwrap().clone();
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn line_format_writes_the_ids_between_the_level_and_the_target() {
        static IDS: LogIds = LogIds::new();
        let run = IDS.start_run().to_owned();
        let _session = IDS.begin_session();
        IDS.set_game(Some("2026-11-11T19-02-04".to_owned()));

        let line = line(&IDS);
        let (time, rest) = line.split_once(' ').unwrap();

        assert!(time.ends_with('Z'), "{line}");
        assert_eq!(
            rest,
            format!(
                " WARN run{{id={run}}}:session{{n=1}}:game{{id=2026-11-11T19-02-04}}: ltk_dll: refusing overlay code=8\n"
            )
        );
        assert_eq!(LogIds::run_of(&line), Some(run.as_str()));
    }

    #[test]
    fn line_format_writes_no_ids_before_the_run_starts() {
        static IDS: LogIds = LogIds::new();
        let line = line(&IDS);
        let (_, rest) = line.split_once(' ').unwrap();

        assert_eq!(rest, " WARN ltk_dll: refusing overlay code=8\n");
    }

    #[test]
    fn redaction_keeps_the_ids_of_a_line() {
        static IDS: LogIds = LogIds::new();
        IDS.start_run();
        let _session = IDS.begin_session();
        IDS.set_game(Some("2026-11-11T19-02-04".to_owned()));

        let line = line(&IDS);

        assert_eq!(ltk_redact::redact(&line), line);
    }
}
