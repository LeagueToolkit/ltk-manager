//! Unit tests for how a lockfile is read.

use super::*;

fn lockfile(port: u16, password: &str) -> Option<Lockfile> {
    Some(Lockfile {
        port,
        password: password.to_owned(),
    })
}

#[test]
fn a_current_lockfile_names_the_port_after_the_pid() {
    assert_eq!(
        parse_lockfile("LeagueClient:1234:56789:secret:https\n"),
        lockfile(56789, "secret")
    );
}

#[test]
fn an_older_lockfile_names_the_port_after_the_process() {
    assert_eq!(
        parse_lockfile("LeagueClient:56789:secret:https"),
        lockfile(56789, "secret")
    );
}

#[test]
fn a_longer_lockfile_is_read_as_the_current_format() {
    assert_eq!(
        parse_lockfile("LeagueClient:1234:56789:secret:https:extra"),
        lockfile(56789, "secret")
    );
}

#[test]
fn a_short_lockfile_or_a_bad_port_reads_as_none() {
    assert_eq!(parse_lockfile("LeagueClient:56789:https"), None);
    assert_eq!(parse_lockfile("LeagueClient:1234:port:secret:https"), None);
}
