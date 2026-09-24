//! A manifest's syntax tree, read for ranges, and the layout of new lines.
//!
//! `yaml-edit` parses without loss and reports the byte range of every node. It
//! edits nothing here. Its own insertions and removals misplace indentation
//! beside a trailing comment line or a blank line (#626), and a splice of whole
//! lines at a range the tree reports keeps every byte it does not replace.

use std::borrow::Cow;
use std::fmt::Write as _;
use std::str::FromStr as _;

use ltk_game_data::ModuleName;
use rowan::ast::AstNode as _;
use yaml_edit::{Document, Lang, Mapping, MappingEntry, SyntaxKind, YamlFile, YamlNode};

use crate::Refusal;

/// A node of a manifest's syntax tree.
pub(crate) type Node = rowan::SyntaxNode<Lang>;

/// The first document of `text`.
///
/// `YamlFile` rather than `Document::from_str`, which refuses a comment above
/// the document.
pub(crate) fn parse(text: &str) -> Result<Document, Refusal> {
    let file = YamlFile::from_str(text).map_err(|error| Refusal::Syntax(error.to_string()))?;
    file.document().ok_or(Refusal::NoDocument)
}

/// The root node of a document, `None` for an empty one.
pub(crate) fn root(doc: &Document) -> Option<YamlNode> {
    doc.as_tagged()
        .map(YamlNode::TaggedNode)
        .or_else(|| doc.as_mapping().map(YamlNode::Mapping))
        .or_else(|| doc.as_sequence().map(YamlNode::Sequence))
        .or_else(|| doc.as_scalar().map(YamlNode::Scalar))
}

/// Whether a value's text sits on its key's line: one line, and no block
/// mapping or block list.
pub(crate) fn is_inline(value: &str) -> bool {
    if value.contains('\n') {
        return false;
    }
    match parse(value).ok().as_ref().and_then(root) {
        Some(YamlNode::Mapping(mapping)) => mapping.is_flow_style(),
        Some(YamlNode::Sequence(list)) => list.is_flow_style(),
        _ => true,
    }
}

/// The syntax node under a value.
pub(crate) fn node(value: &YamlNode) -> Node {
    match value {
        YamlNode::Scalar(inner) => inner.syntax().clone(),
        YamlNode::Mapping(inner) => inner.syntax().clone(),
        YamlNode::Sequence(inner) => inner.syntax().clone(),
        YamlNode::Alias(inner) => inner.syntax().clone(),
        YamlNode::TaggedNode(inner) => inner.syntax().clone(),
    }
}

/// Where `node` starts in the text it was parsed from.
pub(crate) fn start(node: &Node) -> usize {
    node.text_range().start().into()
}

/// Where `node` ends in the text it was parsed from, trivia included.
pub(crate) fn end(node: &Node) -> usize {
    node.text_range().end().into()
}

/// The end of `node`'s last line: past the newline after its last content token
/// or beside comment, or past that token at the end of the text.
///
/// The parser hangs the next line's indentation, and a blank line after the
/// node, on the node itself. Neither belongs to it.
pub(crate) fn line_end(node: &Node) -> usize {
    let tokens: Vec<_> = node
        .descendants_with_tokens()
        .filter_map(rowan::NodeOrToken::into_token)
        .collect();
    let Some(last) = tokens.iter().rposition(|token| {
        !matches!(
            token.kind(),
            SyntaxKind::INDENT | SyntaxKind::WHITESPACE | SyntaxKind::NEWLINE
        )
    }) else {
        return start(node);
    };
    tokens[last..]
        .iter()
        .find(|token| token.kind() == SyntaxKind::NEWLINE)
        .unwrap_or(&tokens[last])
        .text_range()
        .end()
        .into()
}

/// The entries of a mapping, in order.
pub(crate) fn entries(mapping: &Mapping) -> Vec<MappingEntry> {
    mapping.entries().collect()
}

/// A key's decoded text: quotes removed, escapes applied.
pub(crate) fn key_string(entry: &MappingEntry) -> Option<String> {
    match entry.key_node()? {
        YamlNode::Scalar(scalar) => Some(scalar.as_string()),
        _ => None,
    }
}

/// A key as it is spelled, quotes included.
pub(crate) fn key_spelling(entry: &MappingEntry) -> Option<String> {
    match entry.key_node()? {
        YamlNode::Scalar(scalar) => Some(scalar.value()),
        _ => None,
    }
}

/// A mapping entry's value that is a plain mapping, block or flow.
pub(crate) fn mapping_value(entry: &MappingEntry) -> Option<Mapping> {
    match entry.value_node()? {
        YamlNode::Mapping(mapping) => Some(mapping),
        _ => None,
    }
}

/// The entries of a sequence, `SEQUENCE_ENTRY` nodes in order.
pub(crate) fn sequence_entries(sequence: &Node) -> Vec<Node> {
    sequence
        .children()
        .filter(|child| child.kind() == SyntaxKind::SEQUENCE_ENTRY)
        .collect()
}

/// The lines of `key: value` at `column`, `comment` beside the key's line.
///
/// An inline value sits beside its key. Any other goes on the lines below, two
/// columns in, except for a tag or a block scalar indicator on its first line,
/// which stays beside the key.
pub(crate) fn layout_entry(key: &str, value: &str, column: usize, comment: Option<&str>) -> String {
    let pad = " ".repeat(column);
    let beside = comment
        .map(|comment| format!(" {comment}"))
        .unwrap_or_default();
    let lines: Vec<&str> = value.lines().collect();
    let mut out = String::new();
    match lines.as_slice() {
        [] => {
            let _ = writeln!(out, "{pad}{key}:{beside}");
        }
        [only] if is_inline(only) => {
            let _ = writeln!(out, "{pad}{key}: {only}{beside}");
        }
        [first, rest @ ..] if is_header(first) => {
            let _ = writeln!(out, "{pad}{key}: {first}{beside}");
            push_nested(&mut out, &pad, rest);
        }
        all => {
            let _ = writeln!(out, "{pad}{key}:{beside}");
            push_nested(&mut out, &pad, all);
        }
    }
    out
}

/// The lines of one sequence item holding `value`, its dash at `column`.
pub(crate) fn layout_item(value: &str, column: usize) -> String {
    let pad = " ".repeat(column);
    let mut lines = value.lines();
    let mut out = format!("{pad}- {}\n", lines.next().unwrap_or_default());
    let rest: Vec<&str> = lines.collect();
    push_nested(&mut out, &pad, &rest);
    out
}

/// `lines` two columns past `pad`, a blank line left blank.
fn push_nested(out: &mut String, pad: &str, lines: &[&str]) {
    for line in lines {
        if line.is_empty() {
            out.push('\n');
        } else {
            let _ = writeln!(out, "{pad}  {line}");
        }
    }
}

/// Whether a value's first line stays beside its key: a lone tag or anchor, or
/// a block scalar indicator.
fn is_header(line: &str) -> bool {
    let line = line.trim_end();
    ((line.starts_with('!') || line.starts_with('&')) && !line.contains(' '))
        || line.starts_with('|')
        || line.starts_with('>')
}

/// A module's `name` key and its line end, the name spelled as a key is.
pub(crate) fn name_line(name: &ModuleName) -> String {
    format!("name: {}\n", spell_key(name.as_str()))
}

/// A key spelled so YAML reads it back as the same string.
///
/// Plain where that is safe, single-quoted otherwise: a key YAML would read as
/// a number, a boolean or null, one opening on an indicator, and one holding a
/// brace, a quote, `: ` or ` #`. A hash spelled `0x71ad094e` is quoted: YAML
/// reads it plain as an integer.
pub(crate) fn spell_key(key: &str) -> Cow<'_, str> {
    if needs_quotes(key) {
        Cow::Owned(format!("'{}'", key.replace('\'', "''")))
    } else {
        Cow::Borrowed(key)
    }
}

fn needs_quotes(key: &str) -> bool {
    const INDICATORS: &str = "!&*?|>%@`\"'{}[],#:";
    let Some(first) = key.chars().next() else {
        return true;
    };
    INDICATORS.contains(first)
        || first.is_whitespace()
        || key.ends_with(|c: char| c.is_whitespace() || c == ':')
        || key.starts_with("- ")
        || key.contains(": ")
        || key.contains(" #")
        || key.contains(['{', '}', '"', '\'', '\n', '\t'])
        || reads_as_non_string(key)
}

/// Whether YAML's core schema reads a plain scalar as something other than a
/// string.
fn reads_as_non_string(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let unsigned = lower.trim_start_matches(['+', '-']);
    matches!(lower.as_str(), "~" | "null" | "true" | "false")
        || matches!(unsigned, ".inf" | ".nan")
        || unsigned.strip_prefix("0x").is_some_and(|digits| {
            !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_hexdigit())
        })
        || unsigned.strip_prefix("0o").is_some_and(|digits| {
            !digits.is_empty() && digits.bytes().all(|b| (b'0'..=b'7').contains(&b))
        })
        || (unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.')
            && key.parse::<f64>().is_ok())
}
