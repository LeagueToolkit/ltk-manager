use super::*;

use fs_err as fs;
use specta_typescript::Typescript;

/// Where `pnpm generate:types` writes the generated bindings, relative to this crate.
const OUTPUT: &str = "../src/lib/bindings.ts";

/// Where each service's commands are written, importing their types from [`OUTPUT`].
const SERVICES: &str = "../src/lib/ipc";

/// The marker the exporter writes between a file's commands and its types.
const TYPES_MARKER: &str = "\n/* Types */\n";

/// Write the bindings to `path`.
fn export(path: impl AsRef<std::path::Path>) {
    builder()
        .export(Typescript::default(), path)
        .expect("the bindings to export");
}

/// What `builder` writes, out of a directory nothing else reads.
fn render_with(builder: &Builder<Wry>) -> String {
    let dir = tempfile::tempdir().expect("a temp dir to export into");
    let path = dir.path().join("bindings.ts");
    builder
        .export(Typescript::default(), &path)
        .expect("the bindings to export");
    fs::read_to_string(&path).expect("the exported bindings to be readable")
}

/// A service's commands as its own file, its types imported from the shared bindings.
///
/// Panics where the service renders a type differently from `bindings`, or answers a command
/// the app's table also answers.
fn service_file(rendered: &str, bindings: &str) -> String {
    let (commands, types) = rendered
        .split_once(TYPES_MARKER)
        .expect("a service to render types after its commands");

    let code = without_comments(commands);
    let mut imports = Vec::new();
    for declaration in types.trim().split("\n\n") {
        assert!(
            bindings.contains(declaration),
            "a service renders a type unlike bindings.ts:\n{declaration}"
        );
        let name = declaration
            .lines()
            .find_map(|line| line.strip_prefix("export type "))
            .and_then(|rest| rest.split(|c: char| !is_identifier(c)).next())
            .expect("each declaration to export a type");
        if mentions(&code, name) {
            imports.push(name);
        }
    }
    imports.sort_unstable();

    for invoke in commands.split("__TAURI_INVOKE<").skip(1) {
        let command = invoke
            .split_once(">(\"plugin:")
            .and_then(|(_, rest)| rest.split_once('|'))
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(command, _)| command)
            .expect("a service command to invoke through its plugin");
        assert!(
            !bindings.contains(&format!(">(\"{command}\"")),
            "`{command}` is in a service and in the app's table"
        );
    }

    const INVOKE_IMPORT: &str = "from \"@tauri-apps/api/core\";\n";
    let at = commands
        .find(INVOKE_IMPORT)
        .expect("the exporter to import the invoke")
        + INVOKE_IMPORT.len();
    format!(
        "{}import type {{ {} }} from \"../bindings\";\n{}\n",
        &commands[..at],
        imports.join(", "),
        commands[at..].trim_end()
    )
}

fn is_identifier(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `text` without its `/* */` comments, whose prose can spell a type's name.
fn without_comments(text: &str) -> String {
    let mut code = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("/*") {
        code.push_str(&rest[..start]);
        rest = rest[start..]
            .find("*/")
            .map_or("", |end| &rest[start + end + 2..]);
    }
    code.push_str(rest);
    code
}

/// Whether `name` stands in `text` as a whole identifier.
fn mentions(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        !before.is_some_and(is_identifier) && !after.is_some_and(is_identifier)
    })
}

/// Panics where a key of `commandNames` is not the function `tauri-specta` generated.
fn assert_names_functions(rendered: &str, plugin: &str, commands: &[&str]) {
    for function in command_names(plugin, commands).keys() {
        assert!(
            rendered.contains(&format!("\n\t{function}: (")),
            "`commandNames.{function}` names no generated function"
        );
    }
}

#[test]
fn export_bindings() {
    export(OUTPUT);
    let bindings = fs::read_to_string(OUTPUT).expect("the bindings just written");

    fs::create_dir_all(SERVICES).expect("the services' directory");
    for (name, commands, builder) in crate::services::builders() {
        let rendered = render_with(&builder);
        assert_names_functions(&rendered, name, commands);

        let file = service_file(&rendered, &bindings);
        fs::write(format!("{SERVICES}/{}.ts", lower_camel(name)), file)
            .expect("the service's commands to write");
    }
}

#[test]
fn the_envelope_is_the_shape_the_frontend_reads() {
    /* Whole rather than a substring per arm: `Result<T>` in `src/utils/result.ts` narrows on
    `ok`, so an arm that stops being a literal is what this has to fail on. */
    const ENVELOPE: &str = concat!(
        "({ ok: true; value: BinRows }) & { error?: never }",
        " | ({ ok: false; error: AppErrorResponse }) & { value?: never }",
    );

    let bindings = render_with(&crate::services::builder::<crate::services::bin::Table>());
    assert!(
        bindings.contains(ENVELOPE),
        "the envelope is no longer `Result<T>`:
{bindings}"
    );
}
