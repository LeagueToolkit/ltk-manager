//! arm64 specifics of the patch, ported from `patcher_macos_arm64.cpp`.

use super::PatchError;
use crate::macho::CPU_TYPE_ARM64;

pub const CPU_TYPE: u32 = CPU_TYPE_ARM64;

/// `mov x0, #1 ; ret` — a `wad_verify` that always returns true.
const WAD_VERIFY_RETURN_TRUE: [u8; 8] = [0x20, 0x00, 0x80, 0xD2, 0xC0, 0x03, 0x5F, 0xD6];

/// Bytes of the patched prologue; the trampoline pointer follows immediately.
pub const WAD_VERIFY_PROLOGUE_LEN: usize = WAD_VERIFY_RETURN_TRUE.len();

pub fn wad_verify_payload() -> &'static [u8] {
    &WAD_VERIFY_RETURN_TRUE
}

/// Find `wad_verify` by the call site cslol keys on:
/// `MOV W3,#0x126 ; MOV W4,#0x100 ; BL wad_verify`. Returns the vmaddr of the
/// BL's target.
pub fn find_wad_verify(text: &[u8], text_addr: u64) -> Option<u64> {
    const PATTERN: [u8; 8] = [0xC3, 0x24, 0x80, 0x52, 0x04, 0x20, 0x80, 0x52];

    let i = text
        .windows(PATTERN.len())
        .position(|w| w == PATTERN)?;
    if text.len() - i < PATTERN.len() + 4 {
        return None;
    }

    let bl_at = i + PATTERN.len();
    let instr = u32::from_le_bytes(text[bl_at..bl_at + 4].try_into().ok()?);
    let opcode = instr & 0xFC00_0000;
    if opcode != 0x9400_0000 && opcode != 0x1400_0000 {
        return None;
    }
    // Sign-extend the 26-bit imm and scale by 4.
    let offset = ((instr << 6) as i32 >> 6) as i64;
    let bl_pc = text_addr + bl_at as u64;
    Some((bl_pc as i64 + offset * 4) as u64)
}

/// Encode `adrp x16, page ; add x16, x16, #lo12 ; br x16` — a *direct* branch
/// from the rewritten `fopen` stub to `to` (the shellcode address).
///
/// A direct branch replaces cslol's load-a-pointer-and-branch, which encodes
/// the pointer slot's offset in a 64-bit `LDR` scaled by 8 — and so silently
/// truncates it when the slot is not 8-aligned. `wad_verify` on shipping builds
/// is only 4-aligned, so its `+8` pointer slot is unaligned and that stub jumps
/// through the wrong address. `ADD` has no alignment constraint, so branching
/// straight to the shellcode avoids the whole problem.
pub fn import_stub(from: u64, to: u64) -> Result<Vec<u8>, PatchError> {
    let page_diff = ((to & !0xFFF) as i64 - (from & !0xFFF) as i64) >> 12;
    if !(-0x10_0000..=0xF_FFFF).contains(&page_diff) {
        return Err(PatchError::StubOffsetTooBig);
    }

    let imm21 = (page_diff as u32) & 0x1F_FFFF;
    let immlo = (imm21 & 0x3) << 29;
    let immhi = ((imm21 >> 2) & 0x7_FFFF) << 5;
    let adrp: u32 = 0x9000_0010 | immhi | immlo;
    let add: u32 = 0x9100_0210 | (((to & 0xFFF) as u32) << 10);
    let br: u32 = 0xD61F_0200;

    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&adrp.to_le_bytes());
    out.extend_from_slice(&add.to_le_bytes());
    out.extend_from_slice(&br.to_le_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A BL that jumps back 8 instructions should resolve to (bl_pc - 32).
    #[test]
    fn find_wad_verify_resolves_a_negative_bl() {
        let mut text = vec![0u8; 64];
        let base = 16;
        text[base..base + 8].copy_from_slice(&[0xC3, 0x24, 0x80, 0x52, 0x04, 0x20, 0x80, 0x52]);
        // BL with imm26 = -8 (0x3FFFFF8 in 26 bits): 0x94000000 | (imm26 & 0x3FFFFFF)
        let imm26 = (-8i32 as u32) & 0x03FF_FFFF;
        let bl = 0x9400_0000 | imm26;
        text[base + 8..base + 12].copy_from_slice(&bl.to_le_bytes());

        let text_addr = 0x1_0000_4000;
        let found = find_wad_verify(&text, text_addr).unwrap();
        let bl_pc = text_addr + (base + 8) as u64;
        assert_eq!(found, bl_pc - 32);
    }

    /// The direct-branch stub must resolve back to `to` — including for an
    /// unaligned target, which the old LDR-based stub could not encode.
    #[test]
    fn import_stub_direct_branch_round_trips() {
        for to in [0x1_0000_9008u64, 0x1_0168_7464u64 /* unaligned +4 */] {
            let from = 0x1_0000_8000u64;
            let bytes = import_stub(from, to).unwrap();
            let adrp = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
            let add = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
            let br = u32::from_le_bytes(bytes[8..12].try_into().unwrap());

            let immlo = ((adrp & 0x6000_0000) >> 29) as u64;
            let immhi = ((adrp & 0x00FF_FFE0) >> 5) as u64;
            let imm = (immhi << 2) | immlo;
            let sign = if imm & 0x10_0000 != 0 {
                0xFFFF_FFFF_FFE0_0000u64
            } else {
                0
            };
            let relative = (sign | imm) << 12;
            let page = from.wrapping_add(relative) & !0xFFF;
            let add_imm = ((add >> 10) & 0xFFF) as u64;
            assert_eq!(page + add_imm, to, "target {to:#x}");
            assert_eq!(br, 0xD61F_0200);
        }
    }
}
