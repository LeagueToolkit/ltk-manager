use super::*;

fn mode(args: &[&str]) -> Option<ReportMode> {
    ReportMode::from_args(args.iter().map(OsString::from))
}

#[test]
fn from_args_returns_none_without_the_report_argument() {
    assert_eq!(mode(&[]), None);
    assert_eq!(
        mode(&["C:\\mods\\skin.fantome", "--shell-relaunched"]),
        None
    );
    assert_eq!(mode(&["--start-failure", "no window"]), None);
}

#[test]
fn from_args_reads_the_request_of_the_user() {
    assert_eq!(mode(&["--report"]), Some(ReportMode { failure: None }));
}

#[test]
fn from_args_reads_the_failure_as_one_argument() {
    assert_eq!(
        mode(&["--report", "--start-failure", "--report failed: no window"]),
        Some(ReportMode {
            failure: Some("--report failed: no window".to_owned()),
        })
    );
}
