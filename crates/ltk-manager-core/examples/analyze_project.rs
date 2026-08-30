//! Run the problems rules over a project on disk, and print what they found.
//!
//! ```text
//! cargo run -p ltk-manager-core --example analyze_project -- <project> [league path]
//! ```

use std::path::PathBuf;

use ltk_manager_core::config::Config;
use ltk_manager_core::problems::{Severity, analyze};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(project) = args.next() else {
        eprintln!("usage: analyze_project <project directory> [league path]");
        std::process::exit(2);
    };

    let config = Config {
        league_path: args.next().map(PathBuf::from),
        ..Config::default()
    };

    let started = std::time::Instant::now();
    let run = match analyze(std::path::Path::new(&project), &config, None) {
        Ok(run) => run,
        Err(e) => {
            eprintln!("{project}: {e}");
            std::process::exit(1);
        }
    };
    let elapsed = started.elapsed();

    let counts = run.counts();
    println!(
        "{project}\n  {} fatal, {} errors, {} warnings, {} infos, {} unreadable, in {elapsed:?}",
        counts.fatals,
        counts.errors,
        counts.warnings,
        counts.infos,
        run.failed.len()
    );

    for object in run.objects.iter().take(6) {
        println!("  object 0x{:08x} = {}", object.entry.0, object.name);
    }

    for failure in &run.failed {
        let where_ = failure
            .site
            .as_ref()
            .map_or_else(|| "-".to_owned(), ToString::to_string);
        println!("  ! {where_}: {}", failure.message);
    }

    for problem in run.problems.iter().take(6) {
        let glyph = match problem.severity {
            Severity::Fatal => "X",
            Severity::Error => "x",
            Severity::Warning => "!",
            Severity::Info => "i",
        };
        let label = problem
            .site
            .node
            .as_ref()
            .and_then(|node| node.label.as_deref());
        println!("  {glyph} {}", problem.site);
        if let Some(label) = label {
            println!("    reads: {label}");
        }
        if let Some(mismatch) = &problem.mismatch {
            println!(
                "    expected {}, found {}",
                mismatch.expected, mismatch.found
            );
        }
        if let Some(message) = &problem.message {
            println!("    {message}");
        }
        if let Some(fix) = &problem.fix {
            match (&fix.before, &fix.after) {
                (Some(before), Some(after)) => println!("    {before} -> {after}"),
                (Some(before), None) => println!("    {before}"),
                _ => {}
            }
            if let Some(note) = &fix.note {
                println!("    {note}");
            }
        }
    }

    if run.problems.len() > 6 {
        println!("  ... {} more", run.problems.len() - 6);
    }
}
