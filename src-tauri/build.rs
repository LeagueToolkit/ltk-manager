fn main() {
    // Ensure the frontendDist path exists so tauri::generate_context!() doesn't
    // panic during `cargo package --verify` (which builds from an extracted tarball
    // where ../dist doesn't exist).
    let dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if !dist.exists() {
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("index.html"), "").unwrap();
    }

    #[cfg(target_os = "macos")]
    build_cslol_dylib();

    tauri_build::build()
}

/// Build libcslol.dylib from the C++ sources in cslol-dylib/.
///
/// Produces a universal binary (arm64 + x86_64) and places it in
/// src-tauri/resources/ where Tauri's bundler picks it up.
#[cfg(target_os = "macos")]
fn build_cslol_dylib() {
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cslol_dir = manifest_dir.join("cslol-dylib");
    let resources_dir = manifest_dir.join("resources");
    let output_path = resources_dir.join("libcslol.dylib");

    // Track source files so Cargo knows when to rebuild.
    let sources = [
        "cslol-dylib/CMakeLists.txt",
        "cslol-dylib/cslol_api.cpp",
        "cslol-dylib/cslol-tools/lib/lol/common.cpp",
        "cslol-dylib/cslol-tools/lib/lol/common.hpp",
        "cslol-dylib/cslol-tools/lib/lol/error.cpp",
        "cslol-dylib/cslol-tools/lib/lol/error.hpp",
        "cslol-dylib/cslol-tools/lib/lol/fs.cpp",
        "cslol-dylib/cslol-tools/lib/lol/fs.hpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/patcher.hpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/patcher_macos_arm64.cpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/patcher_macos_amd64.cpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/utility/macho.hpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/utility/process.hpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/utility/process_macos.cpp",
        "cslol-dylib/cslol-tools/lib/lol/patcher/utility/delay.hpp",
    ];
    for src in &sources {
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join(src).display()
        );
    }

    std::fs::create_dir_all(&resources_dir).expect("Failed to create resources directory");

    for arch in ["arm64", "x86_64"] {
        let build_dir = cslol_dir.join(format!("build-{}", arch));

        let status = Command::new("cmake")
            .args([
                "-B",
                build_dir.to_str().unwrap(),
                "-S",
                cslol_dir.to_str().unwrap(),
                "-DCMAKE_BUILD_TYPE=Release",
                &format!("-DCMAKE_OSX_ARCHITECTURES={}", arch),
            ])
            .status()
            .expect("cmake not found — install CMake to build the macOS patcher");
        assert!(status.success(), "cmake configure failed for {}", arch);

        let status = Command::new("cmake")
            .args([
                "--build",
                build_dir.to_str().unwrap(),
                "--config",
                "Release",
            ])
            .status()
            .expect("cmake build failed");
        assert!(status.success(), "cmake build failed for {}", arch);
    }

    let status = Command::new("lipo")
        .args([
            "-create",
            cslol_dir
                .join("build-arm64/libcslol.dylib")
                .to_str()
                .unwrap(),
            cslol_dir
                .join("build-x86_64/libcslol.dylib")
                .to_str()
                .unwrap(),
            "-output",
            output_path.to_str().unwrap(),
        ])
        .status()
        .expect("lipo failed");
    assert!(status.success(), "lipo failed to create universal binary");

    println!(
        "cargo:warning=Built libcslol.dylib (universal) from source → {}",
        output_path.display()
    );
}
