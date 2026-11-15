use super::*;

const TEXT: &str = "first\nsecond\nthird\nfourth\nfifth\n";

#[test]
fn first_ends_at_the_end_of_a_line() {
    assert_eq!(first(TEXT, 64), TEXT);
    assert_eq!(first(TEXT, 15), "first\nsecond\n");
    assert_eq!(first(TEXT, 3), "");
}

#[test]
fn last_starts_at_the_start_of_a_line() {
    assert_eq!(last(TEXT, 64), TEXT);
    assert_eq!(last(TEXT, 15), "fourth\nfifth\n");
    assert_eq!(last(TEXT, 3), "");
}

#[test]
fn first_and_last_keep_a_character_of_several_bytes_whole() {
    let text = "é\nmiddle\né\n";

    assert_eq!(first(text, 4), "é\n");
    assert_eq!(last(text, 4), "é\n");
}

#[test]
fn first_and_last_states_the_bytes_that_are_left_out() {
    assert_eq!(first_and_last(TEXT, 64), TEXT);
    assert_eq!(
        first_and_last(TEXT, 14),
        "first\n[20 bytes left out]\nfifth\n"
    );
}
