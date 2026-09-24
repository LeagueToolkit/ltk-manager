//! Reading and writing another process's memory over the Mach VM API.
//!
//! Ported from `cslol-manager`'s `utility/process_macos.cpp`. `task_for_pid`
//! needs root for a non-self task, which is why the host runs elevated.

use std::ffi::c_void;
use std::io;

use mach2::kern_return::KERN_SUCCESS;
use mach2::port::{mach_port_t, MACH_PORT_NULL};
use mach2::traps::{mach_task_self, task_for_pid};
use mach2::vm::{
    mach_vm_allocate, mach_vm_deallocate, mach_vm_protect, mach_vm_read, mach_vm_region_recurse,
    mach_vm_write,
};
use mach2::vm_prot::{VM_PROT_COPY, VM_PROT_EXECUTE, VM_PROT_READ, VM_PROT_WRITE};
use mach2::vm_region::vm_region_submap_info_64;
use mach2::vm_statistics::VM_FLAGS_ANYWHERE;
use mach2::vm_types::{mach_vm_address_t, mach_vm_size_t};

const PROC_PIDPATHINFO_MAXSIZE: usize = 4 * 1024;
const PROC_ALL_PIDS: u32 = 1;

/// The standard file base of a 64-bit Mach-O executable image (below it lies
/// `__PAGEZERO`). Runtime base minus this gives the ASLR slide.
const IMAGE_FILE_BASE: u64 = 0x1_0000_0000;

#[derive(Debug)]
pub enum ProcessError {
    TaskForPid(i32),
    Region(i32),
    Read(i32),
    Write(i32),
    Protect(i32),
    Allocate(i32),
    ReadPath(i32),
    Io(std::io::Error),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessError::TaskForPid(e) => write!(f, "task_for_pid failed ({e:#x}); needs root"),
            ProcessError::Region(e) => write!(f, "mach_vm_region_recurse failed ({e:#x})"),
            ProcessError::Read(e) => write!(f, "mach_vm_read failed ({e:#x})"),
            ProcessError::Write(e) => write!(f, "mach_vm_write failed ({e:#x})"),
            ProcessError::Protect(e) => write!(f, "mach_vm_protect failed ({e:#x})"),
            ProcessError::Allocate(e) => write!(f, "mach_vm_allocate failed ({e:#x})"),
            ProcessError::ReadPath(e) => write!(f, "proc_pidpath failed ({e})"),
            ProcessError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ProcessError {}

type Result<T> = std::result::Result<T, ProcessError>;

fn io_errno() -> i32 {
    io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

/// A handle to another process's task port.
pub struct Process {
    task: mach_port_t,
    pid: u32,
    base: Option<u64>,
    path: String,
}

/// Whether `pid` has exited. Uses only the pid, so it works after the task
/// port is gone (e.g. a patch thread abandoned mid-hang still holds the port).
pub fn pid_exited(pid: u32) -> bool {
    let ret = unsafe { libc::kill(pid as i32, 0) };
    if ret == 0 {
        return false;
    }
    io_errno() == libc::ESRCH
}

impl Drop for Process {
    fn drop(&mut self) {
        if self.task != MACH_PORT_NULL {
            unsafe {
                mach2::mach_port::mach_port_deallocate(mach_task_self(), self.task);
            }
        }
    }
}

/// The pid of the first process whose executable path ends with `suffix`
/// (e.g. `/LeagueofLegends`), or `None` if none is running.
pub fn find_pid(suffix: &str) -> Option<u32> {
    let mut pids = vec![0i32; 4096];
    let bytes = unsafe {
        libc::proc_listpids(
            PROC_ALL_PIDS,
            0,
            pids.as_mut_ptr() as *mut c_void,
            (pids.len() * std::mem::size_of::<i32>()) as i32,
        )
    };
    if bytes <= 0 {
        return None;
    }
    let n = bytes as usize / std::mem::size_of::<i32>();
    let mut pathbuf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    for &pid in pids.iter().take(n) {
        if pid <= 0 {
            continue;
        }
        let ret = unsafe {
            libc::proc_pidpath(
                pid,
                pathbuf.as_mut_ptr() as *mut c_void,
                pathbuf.len() as u32,
            )
        };
        if ret > 0 {
            let path = &pathbuf[..ret as usize];
            if let Ok(s) = std::str::from_utf8(path) {
                if s.ends_with(suffix) {
                    return Some(pid as u32);
                }
            }
        }
    }
    None
}

impl Process {
    /// Open a task port for `pid`. Requires root (or the debugger entitlement)
    /// for a task other than our own.
    pub fn open(pid: u32) -> Result<Self> {
        let mut task: mach_port_t = MACH_PORT_NULL;
        let kr = unsafe { task_for_pid(mach_task_self(), pid as i32, &mut task) };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::TaskForPid(kr));
        }
        Ok(Self {
            task,
            pid,
            base: None,
            path: String::new(),
        })
    }

    /// The runtime load address of the main image (its ASLR slide plus the
    /// file base).
    ///
    /// cslol assumes the very first VM region is the main image's `__TEXT` and
    /// subtracts the file base. That is fragile: `__PAGEZERO` (a 4 GiB
    /// unreadable guard at address 0) is also a region, and whether
    /// `mach_vm_region_recurse` yields it first varies by OS version. Instead we
    /// walk regions and take the first readable one whose bytes start with a
    /// 64-bit Mach-O magic — that is the main executable's `__TEXT`.
    pub fn base(&mut self) -> Result<u64> {
        if let Some(base) = self.base {
            return Ok(base);
        }
        const MH_MAGIC_64: u32 = 0xFEED_FACF;
        const MH_CIGAM_64: u32 = 0xCFFA_EDFE;

        let mut address: mach_vm_address_t = 0;
        for _ in 0..4096 {
            let mut size: mach_vm_size_t = 0;
            let mut nesting_depth: u32 = 0;
            let mut info = vm_region_submap_info_64::default();
            let mut count: mach2::message::mach_msg_type_number_t =
                (std::mem::size_of::<vm_region_submap_info_64>() / std::mem::size_of::<u32>())
                    as u32;
            let kr = unsafe {
                mach_vm_region_recurse(
                    self.task,
                    &mut address,
                    &mut size,
                    &mut nesting_depth,
                    &mut info as *mut _ as *mut i32,
                    &mut count,
                )
            };
            if kr != KERN_SUCCESS {
                return Err(ProcessError::Region(kr));
            }

            if let Ok(bytes) = self.read(address, 4) {
                let magic = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                if (magic == MH_MAGIC_64 || magic == MH_CIGAM_64) && address >= IMAGE_FILE_BASE {
                    let base = address - IMAGE_FILE_BASE;
                    self.base = Some(base);
                    return Ok(base);
                }
            }

            address = match address.checked_add(size) {
                Some(next) if next > address => next,
                _ => break,
            };
        }
        Err(ProcessError::Region(0))
    }

    /// The raw runtime address of the process's first VM region, and the base
    /// cslol's simpler heuristic would have derived from it. Diagnostic only.
    pub fn first_region_base(&self) -> Result<(u64, u64)> {
        let mut address: mach_vm_address_t = 0;
        let mut size: mach_vm_size_t = 0;
        let mut nesting_depth: u32 = 0;
        let mut info = vm_region_submap_info_64::default();
        let mut count: mach2::message::mach_msg_type_number_t =
            (std::mem::size_of::<vm_region_submap_info_64>() / std::mem::size_of::<u32>()) as u32;
        let kr = unsafe {
            mach_vm_region_recurse(
                self.task,
                &mut address,
                &mut size,
                &mut nesting_depth,
                &mut info as *mut _ as *mut i32,
                &mut count,
            )
        };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Region(kr));
        }
        Ok((address, address.wrapping_sub(IMAGE_FILE_BASE)))
    }

    /// Add the runtime slide to a file vmaddr.
    pub fn rebase(&mut self, offset: u64) -> Result<u64> {
        Ok(offset + self.base()?)
    }

    /// The executable path of the process.
    pub fn path(&mut self) -> Result<&str> {
        if self.path.is_empty() {
            let mut pathbuf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
            let ret = unsafe {
                libc::proc_pidpath(
                    self.pid as i32,
                    pathbuf.as_mut_ptr() as *mut c_void,
                    pathbuf.len() as u32,
                )
            };
            if ret <= 0 {
                return Err(ProcessError::ReadPath(ret));
            }
            self.path = String::from_utf8_lossy(&pathbuf[..ret as usize]).into_owned();
        }
        Ok(&self.path)
    }

    /// Read the on-disk Mach-O of the process's executable. cslol dumps the
    /// file (not live memory) because the section offsets it parses are file
    /// offsets.
    pub fn dump(&mut self) -> Result<Vec<u8>> {
        let path = self.path()?.to_string();
        std::fs::read(&path).map_err(ProcessError::Io)
    }

    /// Whether the process has exited. `kill(pid, 0)` probes for existence
    /// without sending a signal; `ESRCH` means the pid is gone.
    pub fn is_exited(&self) -> bool {
        pid_exited(self.pid)
    }

    pub fn allocate(&self, size: u64) -> Result<u64> {
        let mut address: mach_vm_address_t = 0;
        let kr = unsafe { mach_vm_allocate(self.task, &mut address, size, VM_FLAGS_ANYWHERE) };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Allocate(kr));
        }
        Ok(address)
    }

    pub fn mark_writable(&self, address: u64, size: u64) -> Result<()> {
        let kr = unsafe {
            mach_vm_protect(
                self.task,
                address,
                size,
                0,
                VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY,
            )
        };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Protect(kr));
        }
        Ok(())
    }

    pub fn mark_executable(&self, address: u64, size: u64) -> Result<()> {
        let kr = unsafe {
            mach_vm_protect(self.task, address, size, 0, VM_PROT_READ | VM_PROT_EXECUTE)
        };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Protect(kr));
        }
        Ok(())
    }

    pub fn write(&self, address: u64, bytes: &[u8]) -> Result<()> {
        let kr = unsafe {
            mach_vm_write(
                self.task,
                address,
                bytes.as_ptr() as mach2::vm_types::vm_offset_t,
                bytes.len() as u32,
            )
        };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Write(kr));
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn read(&self, address: u64, size: usize) -> Result<Vec<u8>> {
        let mut data: mach2::vm_types::vm_offset_t = 0;
        let mut out_size: mach2::message::mach_msg_type_number_t = 0;
        let kr = unsafe {
            mach_vm_read(self.task, address, size as u64, &mut data, &mut out_size)
        };
        if kr != KERN_SUCCESS {
            return Err(ProcessError::Read(kr));
        }
        let slice = unsafe { std::slice::from_raw_parts(data as *const u8, out_size as usize) };
        let out = slice.to_vec();
        unsafe {
            mach_vm_deallocate(mach_task_self(), data as mach_vm_address_t, out_size as u64);
        }
        Ok(out)
    }
}
