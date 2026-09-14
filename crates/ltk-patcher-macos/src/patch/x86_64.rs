//! x86-64 specifics of the patch, ported from `patcher_macos_amd64.cpp`.

use super::PatchError;
use crate::macho::CPU_TYPE_X86_64;

pub const CPU_TYPE: u32 = CPU_TYPE_X86_64;

/// `mov eax, 1 ; ret 0` — a `wad_verify` that always returns true.
const WAD_VERIFY_RETURN_TRUE: [u8; 8] =
    [0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x00, 0x00];

pub const WAD_VERIFY_PROLOGUE_LEN: usize = WAD_VERIFY_RETURN_TRUE.len();

pub fn wad_verify_payload() -> &'static [u8] {
    &WAD_VERIFY_RETURN_TRUE
}

/// Find `wad_verify` by the call site cslol keys on:
/// `MOV ecx,0x126 ; MOV r8d,0x100 ; MOV rsi,r14 ; CALL wad_verify`. Returns
/// the vmaddr of the CALL's target.
pub fn find_wad_verify(text: &[u8], text_addr: u64) -> Option<u64> {
    const PATTERN: [u8; 15] = [
        0xB9, 0x26, 0x01, 0x00, 0x00, 0x41, 0xB8, 0x00, 0x01, 0x00, 0x00, 0x4C, 0x89, 0xF6, 0xE8,
    ];

    let i = text.windows(PATTERN.len()).position(|w| w == PATTERN)?;
    if text.len() - i < PATTERN.len() + 4 {
        return None;
    }

    let disp_at = i + PATTERN.len();
    let disp = i32::from_le_bytes(text[disp_at..disp_at + 4].try_into().ok()?) as i64;
    let call_end = text_addr + (disp_at + 4) as u64;
    Some((call_end as i64 + disp) as u64)
}

/// Encode `jmp [rip + rel32]` so the rewritten `fopen` stub jumps through the
/// pointer stored at `to`.
pub fn import_stub(from: u64, to: u64) -> Result<Vec<u8>, PatchError> {
    let offset = to as i64 - (from as i64 + 6);
    if offset < i32::MIN as i64 || offset > i32::MAX as i64 {
        return Err(PatchError::StubOffsetTooBig);
    }
    let rel = offset as i32 as u32;
    let mut out = Vec::with_capacity(6);
    out.push(0xFF);
    out.push(0x25);
    out.extend_from_slice(&rel.to_le_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_wad_verify_resolves_a_forward_call() {
        let mut text = vec![0u8; 64];
        let base = 8;
        text[base..base + 15].copy_from_slice(&[
            0xB9, 0x26, 0x01, 0x00, 0x00, 0x41, 0xB8, 0x00, 0x01, 0x00, 0x00, 0x4C, 0x89, 0xF6,
            0xE8,
        ]);
        let disp: i32 = 0x10;
        text[base + 15..base + 19].copy_from_slice(&disp.to_le_bytes());

        let text_addr = 0x1_0000_2000;
        let found = find_wad_verify(&text, text_addr).unwrap();
        let call_end = text_addr + (base + 15 + 4) as u64;
        assert_eq!(found, call_end + disp as u64);
    }

    #[test]
    fn import_stub_encodes_rip_relative_jump() {
        let from = 0x1_0000_4000u64;
        let to = 0x1_0000_5008u64;
        let bytes = import_stub(from, to).unwrap();
        assert_eq!(&bytes[0..2], &[0xFF, 0x25]);
        let rel = i32::from_le_bytes(bytes[2..6].try_into().unwrap()) as i64;
        assert_eq!(from as i64 + 6 + rel, to as i64);
    }
}
