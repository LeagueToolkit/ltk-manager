//! Links the C++ runtime that `intel_tex_2`'s ASTC archive leaves undeclared.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // `ltk_texture`'s `intel-tex` feature pulls `intel_tex_2`, which links a
    // prebuilt `ispc_texcomp_astc` archive compiled from C++ without naming a
    // C++ runtime. MSVC resolves that from directives inside the archive. Every
    // other linker ends on an undefined `__gxx_personality_v0`.
    let cxx = match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("linux" | "android" | "freebsd" | "netbsd" | "openbsd") => "stdc++",
        Ok("macos" | "ios") => "c++",
        _ => return,
    };
    println!("cargo:rustc-link-lib=dylib={cxx}");
}
