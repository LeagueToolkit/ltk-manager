fn main() {
    println!("cargo:rustc-check-cfg=cfg(ltk_macos_process_patcher_bundled)");
    println!("cargo:rerun-if-changed=../tools/macos-process-patcher/ltk_macos_process_patcher.cpp");

    // Ensure the frontendDist path exists so tauri::generate_context!() doesn't
    // panic during `cargo package --verify` (which builds from an extracted tarball
    // where ../dist doesn't exist).
    let dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if !dist.exists() {
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("index.html"), "").unwrap();
    }

    build_macos_process_patcher();

    tauri_build::build()
}

fn build_macos_process_patcher() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source = manifest_dir.join("../tools/macos-process-patcher/ltk_macos_process_patcher.cpp");
    if !source.exists() {
        panic!(
            "macOS process patcher source not found at {}",
            source.display()
        );
    }

    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap())
        .join("ltk_macos_process_patcher");
    let mut cmd = std::process::Command::new("clang++");
    cmd.arg("-std=c++20")
        .arg("-Wall")
        .arg("-Wextra")
        .arg("-O2")
        .arg("-mmacosx-version-min=11.0")
        .arg("-o")
        .arg(&out)
        .arg(&source);

    match cmd.status() {
        Ok(status) if status.success() => {
            println!("cargo:rustc-cfg=ltk_macos_process_patcher_bundled");
        }
        Ok(status) => {
            panic!("Failed to build bundled macOS process patcher: clang++ exited with {status}");
        }
        Err(e) => {
            panic!("Failed to build bundled macOS process patcher: {e}");
        }
    }
}
