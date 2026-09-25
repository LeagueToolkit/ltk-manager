//! Validates the Mach-O reader and the `wad_verify` finder against the real
//! League binary installed on this machine. Skips cleanly when the game is not
//! installed, so it never fails CI.

#![cfg(target_os = "macos")]

use ltk_patcher_macos::macho::{MachO, CPU_TYPE_ARM64, CPU_TYPE_X86_64};

const GAME_BINARY: &str = "/Applications/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends";

fn load() -> Option<Vec<u8>> {
    std::fs::read(GAME_BINARY).ok()
}

#[test]
fn resolves_patch_targets_on_the_installed_game() {
    let Some(data) = load() else {
        eprintln!("League not installed at {GAME_BINARY}; skipping");
        return;
    };

    let arch = if cfg!(target_arch = "aarch64") {
        CPU_TYPE_ARM64
    } else {
        CPU_TYPE_X86_64
    };

    let macho = MachO::parse(&data, arch).expect("parse the installed game slice");

    let (text_addr, text) = macho
        .find_section("__text")
        .expect("game has a __text section");
    assert!(text_addr >= 0x1_0000_0000, "text vmaddr looks like a slide-free image base");
    assert!(!text.is_empty());

    let fopen_ptr = macho
        .find_import_ptr("_fopen")
        .expect("game imports fopen lazily");
    assert!(fopen_ptr != 0);

    let stub = macho
        .find_stub_refs(fopen_ptr)
        .expect("a __stubs entry jumps through the fopen pointer");
    assert!(stub != 0);
}

#[test]
fn finds_wad_verify_on_the_installed_game() {
    let Some(data) = load() else {
        eprintln!("League not installed; skipping");
        return;
    };

    let arch = if cfg!(target_arch = "aarch64") {
        CPU_TYPE_ARM64
    } else {
        CPU_TYPE_X86_64
    };
    let macho = MachO::parse(&data, arch).unwrap();
    let (addr, text) = macho.find_section("__text").unwrap();
    let target = ltk_patcher_macos::patch::find_wad_verify(text, addr);
    assert!(target.is_some(), "wad_verify call-site pattern present");
    assert!(target.unwrap() >= 0x1_0000_0000);
}
