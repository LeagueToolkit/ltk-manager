use fs_err as fs;
use sha2::{Digest, Sha256};
use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

/// Each service of `src/services/table.rs` as its plugin name and command names.
macro_rules! services {
    ($($module:ident($name:literal) {
        $($command:ident),* $(,)?
        $(; debug: $($debug:ident),* $(,)?)?
    })*) => {
        [$((
            $name,
            &[$(stringify!($command),)* $($(stringify!($debug),)*)?] as &'static [&'static str],
        )),*]
    };
}

fn main() {
    // Ensure the frontendDist path exists so tauri::generate_context!() doesn't
    // panic during `cargo package --verify` (which builds from an extracted tarball
    // where ../dist doesn't exist).
    let dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if !dist.exists() {
        fs::create_dir_all(&dist).unwrap();
        fs::write(dist.join("index.html"), "").unwrap();
    }

    bake_patcher_checksums();

    /* A debug-only command is allowed in every build, because one the build does not
    register answers as unknown either way. */
    let mut attributes = Attributes::new();
    for (name, commands) in include!("src/services/table.rs") {
        attributes = attributes.plugin(
            name,
            InlinedPlugin::new()
                .commands(commands)
                .default_permission(DefaultPermissionRule::AllowAllCommands),
        );
    }
    tauri_build::try_build(attributes).expect("the Tauri build to succeed");
}

fn bake_patcher_checksums() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ltk_patcher_host.exe");
    println!("cargo:rerun-if-changed={}", path.display());

    if let Ok(bytes) = fs::read(&path) {
        let digest = Sha256::digest(&bytes);
        let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
        println!("cargo:rustc-env=LTK_BUNDLED_HOST_HASH={hash}");
    }
}
