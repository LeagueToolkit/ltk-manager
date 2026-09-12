//! What every rule declares about itself, pinned so a change is a deliberate
//! edit rather than a badge that quietly moves.

use super::*;
use crate::problems::Severity;

/// The severity each rule answers with, and who answers.
///
/// A stored verdict takes a declared severity from the running build, so this
/// is the list of what the badge draws - and one rule cannot be on it, because
/// what a type mismatch costs is a question about the machine.
#[test]
fn each_rule_declares_who_answers_for_its_severity() {
    let declared: Vec<(String, Option<Severity>)> = all()
        .iter()
        .map(|rule| (rule.id().to_string(), rule.severity()))
        .collect();

    assert_eq!(
        declared,
        vec![
            ("bin/property-type".to_owned(), None),
            ("audio/bank-version".to_owned(), Some(Severity::Warning)),
            ("audio/bank-id".to_owned(), Some(Severity::Info)),
            ("tex/block-alignment".to_owned(), Some(Severity::Fatal)),
            ("bin/resolver-key-loss".to_owned(), Some(Severity::Info)),
        ]
    );
}

/// The catalogue a run carries repeats the declaration, since that is what
/// every surface reads rather than asking the rule again.
#[test]
fn the_catalogue_carries_what_the_rule_declared() {
    for rule in all() {
        assert_eq!(rule.info().severity, rule.severity(), "{}", rule.id());
    }
}
