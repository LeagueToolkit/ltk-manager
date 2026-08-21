//! The name Windows gives the code a crashed game exits with.
//!
//! A process that dies on an unhandled exception exits with the exception's
//! `NTSTATUS`, so `-1073741819` is the reader's only clue that the game took an
//! access violation. These are public Windows constants, and the table holds
//! the ones a game crash actually reaches rather than all of them.

/// The codes worth naming, newest lookup first is not worth it at this size.
const NAMES: &[(u32, &str)] = &[
    (0x4001_0004, "DBG_TERMINATE_PROCESS"),
    (0x8000_0003, "STATUS_BREAKPOINT"),
    (0xC000_0005, "STATUS_ACCESS_VIOLATION"),
    (0xC000_0006, "STATUS_IN_PAGE_ERROR"),
    (0xC000_0017, "STATUS_NO_MEMORY"),
    (0xC000_001D, "STATUS_ILLEGAL_INSTRUCTION"),
    (0xC000_0025, "STATUS_NONCONTINUABLE_EXCEPTION"),
    (0xC000_008C, "STATUS_ARRAY_BOUNDS_EXCEEDED"),
    (0xC000_008E, "STATUS_FLOAT_DIVIDE_BY_ZERO"),
    (0xC000_0090, "STATUS_FLOAT_INVALID_OPERATION"),
    (0xC000_0094, "STATUS_INTEGER_DIVIDE_BY_ZERO"),
    (0xC000_0095, "STATUS_INTEGER_OVERFLOW"),
    (0xC000_0096, "STATUS_PRIVILEGED_INSTRUCTION"),
    (0xC000_009A, "STATUS_INSUFFICIENT_RESOURCES"),
    (0xC000_00FD, "STATUS_STACK_OVERFLOW"),
    (0xC000_0135, "STATUS_DLL_NOT_FOUND"),
    (0xC000_013A, "STATUS_CONTROL_C_EXIT"),
    (0xC000_0142, "STATUS_DLL_INIT_FAILED"),
    (0xC000_0374, "STATUS_HEAP_CORRUPTION"),
    (0xC000_0409, "STATUS_STACK_BUFFER_OVERRUN"),
    (0xC000_041D, "STATUS_FATAL_USER_CALLBACK_EXCEPTION"),
    (0xC000_0602, "STATUS_FAIL_FAST_EXCEPTION"),
];

/// The `NTSTATUS` name for `code`, for a code the table knows.
pub fn name(code: i64) -> Option<&'static str> {
    let bits = bits(code);
    NAMES
        .iter()
        .find_map(|(known, name)| (*known == bits).then_some(*name))
}

/// `0xC0000005 STATUS_ACCESS_VIOLATION`, or what is left when the table has no
/// name for it.
///
/// A code with the high bit set is an `NTSTATUS` whether or not it is named, so
/// it reads as hex. Anything else is a plain exit code and reads as a number.
pub fn describe(code: i64) -> String {
    let bits = bits(code);
    match name(code) {
        Some(name) => format!("0x{bits:08X} {name}"),
        None if code < 0 => format!("0x{bits:08X}"),
        None => code.to_string(),
    }
}

/// The low 32 bits, which is what a Windows exit code is however it was widened.
fn bits(code: i64) -> u32 {
    code as i32 as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_access_violation_reads_as_its_name() {
        assert_eq!(describe(-1073741819), "0xC0000005 STATUS_ACCESS_VIOLATION");
        assert_eq!(name(-1073741819), Some("STATUS_ACCESS_VIOLATION"));
    }

    /// The client may hand the same value back unsigned, and it is the same
    /// crash either way.
    #[test]
    fn the_unsigned_spelling_is_the_same_code() {
        assert_eq!(describe(0xC000_0005), "0xC0000005 STATUS_ACCESS_VIOLATION");
    }

    #[test]
    fn a_status_with_no_row_keeps_its_hex() {
        assert_eq!(describe(-1073741000), "0xC0000338");
        assert_eq!(name(-1073741000), None);
    }

    /// A small code is an ordinary exit status, and hex would only obscure it.
    #[test]
    fn a_plain_exit_code_reads_as_a_number() {
        assert_eq!(describe(0), "0");
        assert_eq!(describe(1), "1");
    }

    #[test]
    fn the_table_holds_no_duplicates() {
        let mut codes: Vec<u32> = NAMES.iter().map(|(code, _)| *code).collect();
        codes.sort_unstable();
        let before = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), before);
        for (_, name) in NAMES {
            assert_eq!(*name, name.to_uppercase(), "a name reads as a constant");
        }
    }
}
