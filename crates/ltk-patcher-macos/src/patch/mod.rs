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

/// Max overlay prefix length the shellcode's fixed stack buffer holds, with the
/// NUL. The data region is `8` (the fopen pointer) plus this.
pub const PREFIX_MAX: usize = 0x100;

/// The shellcode ends with an 8-byte `.quad` literal (`Ldata_ptr`) that we patch
/// to the absolute address of the data region.
const SHELLCODE_DATA_PTR_LEN: usize = 8;

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

/// Which writes to apply. Lets us bisect a crash: `VerifyOnly` writes just the
/// `wad_verify` override, `FileOnly` just the `fopen` redirect, `Probe` writes
/// nothing (read-only, for confirming resolution on a live process).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchMode {
    Full,
    VerifyOnly,
    FileOnly,
    Probe,
    /// Full machinery, but with an empty overlay prefix so the shellcode opens
    /// every file at its original path — no mods, no redirection. Isolates the
    /// hook mechanism (allocated executable shellcode + stub redirect) from the
    /// redirected content: if this loads, the mechanism works and the crash is
    /// in the served WADs; if it crashes, the mechanism itself is the problem.
    Passthrough,
}

impl PatchMode {
    /// The requested mode, from the env var `LTK_PATCH_MODE` or, failing that,
    /// the file `/tmp/ltk_patch_mode`. The file makes the mode selectable
    /// without relaunching the app from a shell (LaunchServices drops env vars).
    pub fn from_env() -> Self {
        let from_env = std::env::var("LTK_PATCH_MODE").ok();
        let raw = from_env.or_else(|| {
            std::fs::read_to_string("/tmp/ltk_patch_mode")
                .ok()
                .map(|s| s.trim().to_string())
        });
        match raw.as_deref() {
            Some("verify") => PatchMode::VerifyOnly,
            Some("file") => PatchMode::FileOnly,
            Some("probe") => PatchMode::Probe,
            Some("passthrough") => PatchMode::Passthrough,
            _ => PatchMode::Full,
        }
    }
}

fn hexdump(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
}

/// Write the shellcode, the `wad_verify` override, and the redirected `fopen`
/// stub into the process.
fn apply(
    process: &mut Process,
    targets: &Targets,
    prefix: &[u8],
    options: PatchOptions,
    mode: PatchMode,
    log: &mut dyn FnMut(String),
) -> Result<(), PatchError> {
    let base = process.base()?;
    log(format!("image base = {base:#x} (slide {base:#x} - 0x100000000 = {:#x})", base as i64 - 0x1_0000_0000));

    let ptr_wad_verify = process.rebase(targets.off_wad_verify)?;
    let ptr_fopen_ptr = process.rebase(targets.off_fopen_ptr)?;
    let ptr_fopen_stub = process.rebase(targets.off_fopen_stub)?;
    log(format!(
        "targets: wad_verify off={:#x} -> {ptr_wad_verify:#x}; fopen_ptr off={:#x} -> {ptr_fopen_ptr:#x}; fopen_stub off={:#x} -> {ptr_fopen_stub:#x}",
        targets.off_wad_verify, targets.off_fopen_ptr, targets.off_fopen_stub
    ));

    // Read back what is really there now, to confirm we resolved live memory to
    // the expected code (the wad_verify prologue and the fopen stub).
    match process.read(ptr_wad_verify, 16) {
        Ok(b) => log(format!("wad_verify now: {}", hexdump(&b))),
        Err(e) => log(format!("wad_verify read failed: {e}")),
    }
    match process.read(ptr_fopen_stub, 12) {
        Ok(b) => log(format!("fopen_stub now: {}", hexdump(&b))),
        Err(e) => log(format!("fopen_stub read failed: {e}")),
    }
    match process.read(ptr_fopen_ptr, 8) {
        Ok(b) => log(format!("fopen_ptr value now: {}", hexdump(&b))),
        Err(e) => log(format!("fopen_ptr read failed: {e}")),
    }

    if mode == PatchMode::Probe {
        log("probe mode: no writes performed".to_string());
        return Ok(());
    }

    let want_file = !options.disable_file && mode != PatchMode::VerifyOnly;
    let want_verify_only = mode == PatchMode::VerifyOnly
        || (options.disable_file && !options.disable_verify);

    // macOS 27 / Apple Silicon refuses to execute freshly `mach_vm_allocate`d
    // memory, so the shellcode cannot live in an allocated region. It goes into
    // existing signed `__text` instead — the dead body of `wad_verify`, right
    // after the return-true prologue we write over its entry. The `fopen`
    // pointer and the overlay prefix are plain *data*, which allocated memory
    // holds fine, and the shellcode reads them through an absolute pointer we
    // patch into it. The `fopen` stub is redirected with a direct branch to the
    // shellcode (no unaligned pointer slot).
    let prologue = arch::wad_verify_payload();
    if want_file {
        let sc = shellcode();
        let data_ptr_off = sc.len() - SHELLCODE_DATA_PTR_LEN;

        // Passthrough uses an empty prefix, so the shellcode runs but opens
        // every path unchanged — the hook mechanism without the redirection.
        let eff_prefix: &[u8] = if mode == PatchMode::Passthrough { &[] } else { prefix };
        if mode == PatchMode::Passthrough {
            log("passthrough: empty prefix, files open unredirected".to_string());
        }

        // Data region (read-only data, not executed): [fopen_ptr u64][prefix..].
        let data_region = process.allocate((8 + PREFIX_MAX) as u64)?;
        let mut data = vec![0u8; 8 + PREFIX_MAX];
        data[..8].copy_from_slice(&ptr_fopen_ptr.to_le_bytes());
        data[8..8 + eff_prefix.len()].copy_from_slice(eff_prefix);
        process.write(data_region, &data)?;
        log(format!("wrote data region at {data_region:#x} (fopen_ptr + prefix)"));

        // The shellcode, with its trailing Ldata_ptr literal pointed at the data
        // region, laid out after the return-true prologue inside wad_verify.
        let mut shell = sc.to_vec();
        shell[data_ptr_off..].copy_from_slice(&data_region.to_le_bytes());

        let mut wad_payload = prologue.to_vec();
        wad_payload.extend_from_slice(&shell);
        let shellcode_addr = ptr_wad_verify + prologue.len() as u64;

        process.mark_writable(ptr_wad_verify, wad_payload.len() as u64)?;
        process.write(ptr_wad_verify, &wad_payload)?;
        process.mark_executable(ptr_wad_verify, wad_payload.len() as u64)?;
        log(format!(
            "wrote wad_verify: return-true + {}-byte shellcode into __text (shellcode @ {shellcode_addr:#x})",
            shell.len()
        ));

        let stub = arch::import_stub(ptr_fopen_stub, shellcode_addr)?;
        process.mark_writable(ptr_fopen_stub, stub.len() as u64)?;
        process.write(ptr_fopen_stub, &stub)?;
        process.mark_executable(ptr_fopen_stub, stub.len() as u64)?;
        log(format!("redirected fopen stub -> shellcode ({})", hexdump(&stub)));
    } else if want_verify_only {
        // No modded files, but still bypass the WAD signature check.
        process.mark_writable(ptr_wad_verify, prologue.len() as u64)?;
        process.write(ptr_wad_verify, prologue)?;
        process.mark_executable(ptr_wad_verify, prologue.len() as u64)?;
        log("wrote + protected wad_verify override (verify-only)".to_string());
    }

    log("patch applied".to_string());
    Ok(())
}

/// Scan the process and apply the patch, logging each step through `log`.
pub fn scan_and_patch(
    process: &mut Process,
    prefix: &[u8],
    options: PatchOptions,
    mode: PatchMode,
    log: &mut dyn FnMut(String),
) -> Result<(), PatchError> {
    let got = shellcode().len();
    // The shellcode must fit in the dead body of `wad_verify` after the
    // return-true prologue. On shipping builds that body is ~264 bytes; a
    // miscompiled or oversized shellcode would overrun into the next function.
    if got < 32 || got + arch::wad_verify_payload().len() > 272 {
        return Err(PatchError::ShellcodeMiscompiled { got });
    }
    log(format!("patch mode = {mode:?}, arch cputype = {:#x}, shellcode = {got} bytes", arch::CPU_TYPE));
    let targets = scan(process)?;
    apply(process, &targets, prefix, options, mode, log)
}
