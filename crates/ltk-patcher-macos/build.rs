fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let asm = match arch.as_str() {
        "aarch64" => "shellcode/fopen_hook_arm64.s",
        "x86_64" => "shellcode/fopen_hook_x86_64.s",
        other => panic!("unsupported macOS arch for patcher host: {other}"),
    };

    println!("cargo:rerun-if-changed={asm}");
    cc::Build::new().file(asm).compile("fopen_hook_shellcode");
}
