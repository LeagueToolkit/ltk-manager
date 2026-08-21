use sha2::{Digest, Sha256};

fn main() {
    // Ensure the frontendDist path exists so tauri::generate_context!() doesn't
    // panic during `cargo package --verify` (which builds from an extracted tarball
    // where ../dist doesn't exist).
    let dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if !dist.exists() {
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("index.html"), "").unwrap();
    }

    bake_patcher_checksums();

    tauri_build::build()
}

fn bake_patcher_checksums() {
    let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    for (file, var) in [
        ("ltk_patcher_dll.dll", "LTK_BUNDLED_DLL_HASH"),
        ("ltk_patcher_host.exe", "LTK_BUNDLED_HOST_HASH"),
    ] {
        let path = resources.join(file);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(bytes) = std::fs::read(&path) {
            let digest = Sha256::digest(&bytes);
            let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
            println!("cargo:rustc-env={var}={hash}");
        }
    }
}
