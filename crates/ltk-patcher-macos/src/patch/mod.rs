//! The patch itself: find the game's `wad_verify` and `fopen` stub, then
//! rewrite memory so `.client` reads are redirected under the overlay prefix
//! and the WAD signature check always passes.
//!
//! Ported from `cslol-manager`'s `patcher_macos_arm64.cpp` /
//! `patcher_macos_amd64.cpp`.

use crate::macho::MachO;
use crate::process::Process;

#[cfg(target_arch = "aarch64")]
mod arm64;
#[cfg(target_arch = "aarch64")]
use arm64 as arch;

#[cfg(target_arch = "x86_64")]
mod x86_64;
#[cfg(target_arch = "x86_64")]
use x86_64 as arch;

/// Size of the copied `fopen` hook shellcode; the pointer and prefix follow it.
pub const FOPEN_HOOK_LEN: usize = 0x100;
/// Max overlay prefix length the shellcode's fixed buffer holds (with the NUL).
pub const PREFIX_MAX: usize = 0x100;

extern "C" {
    static fopen_hook_shellcode_beg: u8;
    static fopen_hook_shellcode_end: u8;
}

/// The linked shellcode bytes (`[fopen_hook_shellcode_beg, _end)`).
fn shellcode() -> &'static [u8] {
    unsafe {
        let beg = &fopen_hook_shellcode_beg as *const u8;
        let end = &fopen_hook_shellcode_end as *const u8;
        let len = end as usize - beg as usize;
        std::slice::from_raw_parts(beg, len)
    }
}

#[derive(Debug)]
pub enum PatchError {
    ShellcodeMiscompiled { got: usize },
    PrefixTooLong { len: usize },
    NoTextSection,
    NoWadVerify,
    NoFopenImport,
    NoFopenStub,
    StubOffsetTooBig,
    MachO(crate::macho::MachOError),
    Process(crate::process::ProcessError),
}

impl std::fmt::Display for PatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PatchError::ShellcodeMiscompiled { got } => {
                write!(f, "fopen hook miscompiled (0x{got:x} bytes)")
            }
            PatchError::PrefixTooLong { len } => write!(f, "overlay prefix too long ({len} bytes)"),
            PatchError::NoTextSection => write!(f, "Failed to find __text section"),
            PatchError::NoWadVerify => write!(f, "Failed to find wad_verify call"),
            PatchError::NoFopenImport => write!(f, "Failed to find fopen org"),
            PatchError::NoFopenStub => write!(f, "Failed to find fopen stub"),
            PatchError::StubOffsetTooBig => write!(f, "Import stub offset too big"),
            PatchError::MachO(e) => write!(f, "{e}"),
            PatchError::Process(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PatchError {}

impl From<crate::macho::MachOError> for PatchError {
    fn from(e: crate::macho::MachOError) -> Self {
        PatchError::MachO(e)
    }
}

impl From<crate::process::ProcessError> for PatchError {
    fn from(e: crate::process::ProcessError) -> Self {
        PatchError::Process(e)
    }
}

/// What options this session applies. Mirrors the Windows host's hook flags,
/// but only the two that have a macOS analogue take effect.
#[derive(Debug, Clone, Copy, Default)]
pub struct PatchOptions {
    /// Skip neutralizing `wad_verify` (leave signature verification intact).
    pub disable_verify: bool,
    /// Skip the `fopen` redirect (no modded files served).
    pub disable_file: bool,
}

/// The addresses resolved from a scan, ready to be written into the process.
struct Targets {
    off_wad_verify: u64,
    off_fopen_ptr: u64,
    off_fopen_stub: u64,
}

/// The vmaddr of the game's `wad_verify`, found by the current architecture's
/// call-site pattern. Exposed for validation against a real game binary.
pub fn find_wad_verify(text: &[u8], text_addr: u64) -> Option<u64> {
    arch::find_wad_verify(text, text_addr)
}

/// Normalize an overlay prefix to what the shellcode expects: an absolute
/// directory path ending in `/`, within the fixed buffer.
pub fn prepare_prefix(prefix: &str) -> Result<Vec<u8>, PatchError> {
    let mut p = prefix.to_string();
    if !p.ends_with('/') {
        p.push('/');
    }
    let bytes = p.into_bytes();
    if bytes.len() > PREFIX_MAX - 1 {
        return Err(PatchError::PrefixTooLong { len: bytes.len() });
    }
    Ok(bytes)
}

/// Scan the process image for the patch targets.
fn scan(process: &mut Process) -> Result<Targets, PatchError> {
    let data = process.dump()?;
    let macho = MachO::parse(&data, arch::CPU_TYPE)?;

    let (text_addr, text) = macho.find_section("__text").ok_or(PatchError::NoTextSection)?;
    let off_wad_verify = arch::find_wad_verify(text, text_addr).ok_or(PatchError::NoWadVerify)?;
    let off_fopen_ptr = macho.find_import_ptr("_fopen").ok_or(PatchError::NoFopenImport)?;
    let off_fopen_stub = macho
        .find_stub_refs(off_fopen_ptr)
        .ok_or(PatchError::NoFopenStub)?;

    Ok(Targets {
        off_wad_verify,
        off_fopen_ptr,
        off_fopen_stub,
    })
}

/// Write the shellcode, the `wad_verify` override, and the redirected `fopen`
/// stub into the process.
fn apply(
    process: &mut Process,
    targets: &Targets,
    prefix: &[u8],
    options: PatchOptions,
) -> Result<(), PatchError> {
    let ptr_wad_verify = process.rebase(targets.off_wad_verify)?;
    let ptr_fopen_ptr = process.rebase(targets.off_fopen_ptr)?;
    let ptr_fopen_stub = process.rebase(targets.off_fopen_stub)?;

    // The file redirect and the verify bypass share one trampoline: the
    // redirected `fopen` stub jumps through an 8-byte slot that must sit within
    // adrp range of the stub, so it reuses the bytes right after `wad_verify`'s
    // patched prologue. That means serving modded files always overwrites
    // `wad_verify` too — the same coupling cslol relies on.
    if !options.disable_file {
        // Shellcode payload: [shellcode 0x100][fopen_org_ptr u64][prefix ..].
        let ptr_fopen_hook = process.allocate((FOPEN_HOOK_LEN + 8 + PREFIX_MAX) as u64)?;

        let mut payload = vec![0u8; FOPEN_HOOK_LEN + 8 + PREFIX_MAX];
        payload[..FOPEN_HOOK_LEN].copy_from_slice(shellcode());
        payload[FOPEN_HOOK_LEN..FOPEN_HOOK_LEN + 8].copy_from_slice(&ptr_fopen_ptr.to_le_bytes());
        payload[FOPEN_HOOK_LEN + 8..FOPEN_HOOK_LEN + 8 + prefix.len()].copy_from_slice(prefix);

        process.mark_writable(ptr_fopen_hook, payload.len() as u64)?;
        process.write(ptr_fopen_hook, &payload)?;
        process.mark_executable(ptr_fopen_hook, payload.len() as u64)?;

        // wad_verify payload: [return-true prologue][fopen_hook_ptr u64].
        let mut wad_payload = arch::wad_verify_payload().to_vec();
        wad_payload.extend_from_slice(&ptr_fopen_hook.to_le_bytes());

        process.mark_writable(ptr_wad_verify, wad_payload.len() as u64)?;
        process.write(ptr_wad_verify, &wad_payload)?;
        process.mark_executable(ptr_wad_verify, wad_payload.len() as u64)?;

        let jump_slot = ptr_wad_verify + arch::WAD_VERIFY_PROLOGUE_LEN as u64;
        let stub = arch::import_stub(ptr_fopen_stub, jump_slot)?;
        process.mark_writable(ptr_fopen_stub, stub.len() as u64)?;
        process.write(ptr_fopen_stub, &stub)?;
        process.mark_executable(ptr_fopen_stub, stub.len() as u64)?;
    } else if !options.disable_verify {
        // No modded files, but still bypass the WAD signature check.
        let wad_payload = arch::wad_verify_payload();
        process.mark_writable(ptr_wad_verify, wad_payload.len() as u64)?;
        process.write(ptr_wad_verify, wad_payload)?;
        process.mark_executable(ptr_wad_verify, wad_payload.len() as u64)?;
    }

    Ok(())
}

/// Scan the process and apply the patch.
pub fn scan_and_patch(
    process: &mut Process,
    prefix: &[u8],
    options: PatchOptions,
) -> Result<(), PatchError> {
    let got = shellcode().len();
    if got != FOPEN_HOOK_LEN {
        return Err(PatchError::ShellcodeMiscompiled { got });
    }
    let targets = scan(process)?;
    apply(process, &targets, prefix, options)
}
