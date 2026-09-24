//! A YAML document's text, and the positions and splices over it.

use rowan::NodeOrToken;
use yaml_edit::{Document, SyntaxKind};

use crate::Refusal;
use crate::syntax::{self, Node};

/// The text of a YAML document, lines ending in `\n`.
///
/// A node's range, read from [`DocumentText::parse`], indexes this text. A
/// splice returns a new text and leaves this one as it was.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DocumentText(String);

impl DocumentText {
    pub(crate) fn new(text: impl Into<String>) -> Self {
        Self(text.into())
    }

    /// A manifest holding `module`, a standalone module document, as its one module.
    pub(crate) fn with_module(module: &str) -> Self {
        Self(format!(
            "version: 1\nmodules:\n{}",
            syntax::layout_item(module, 2)
        ))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether the text holds nothing but whitespace.
    pub(crate) fn is_blank(&self) -> bool {
        self.0.trim().is_empty()
    }

    /// The document the text parses to.
    pub(crate) fn parse(&self) -> Result<Document, Refusal> {
        syntax::parse(&self.0)
    }

    /// Where the line holding `at` starts.
    pub(crate) fn line_start(&self, at: usize) -> usize {
        self.0[..at].rfind('\n').map_or(0, |newline| newline + 1)
    }

    /// The column `node` starts at.
    pub(crate) fn column(&self, node: &Node) -> usize {
        let at = syntax::start(node);
        at - self.line_start(at)
    }

    /// The comment on `entry`'s first line, beside its key or its value.
    pub(crate) fn key_line_comment(&self, entry: &Node) -> Option<String> {
        let start = syntax::start(entry);
        let first_line_end = self.0[start..]
            .find('\n')
            .map_or(self.0.len(), |newline| start + newline);
        entry
            .descendants_with_tokens()
            .filter_map(NodeOrToken::into_token)
            .find(|token| {
                token.kind() == SyntaxKind::COMMENT
                    && usize::from(token.text_range().start()) < first_line_end
            })
            .map(|token| token.text().to_owned())
    }

    /// A value's text as a standalone document: its lines after the first moved
    /// left by the column it starts at.
    pub(crate) fn standalone(&self, value: &Node) -> String {
        let body = self.0[syntax::start(value)..syntax::end(value)].trim_end();
        let shift = self.column(value);
        let mut out = String::with_capacity(body.len());
        for (index, line) in body.lines().enumerate() {
            if index > 0 {
                out.push('\n');
                let spaces = line.len() - line.trim_start_matches(' ').len();
                out.push_str(&line[spaces.min(shift)..]);
            } else {
                out.push_str(line);
            }
        }
        out
    }

    /// The text with `start..end` replaced by `insert`.
    pub(crate) fn splice(&self, start: usize, end: usize, insert: &str) -> Self {
        let mut out = String::with_capacity(self.0.len() + insert.len());
        out.push_str(&self.0[..start]);
        out.push_str(insert);
        out.push_str(&self.0[end..]);
        Self(out)
    }

    /// The text with whole `lines` inserted at `at`, the end of a line or of
    /// the text.
    pub(crate) fn insert_lines(&self, at: usize, lines: &str) -> Self {
        if at == 0 || self.0[..at].ends_with('\n') {
            self.splice(at, at, lines)
        } else {
            self.splice(at, at, &format!("\n{lines}"))
        }
    }

    /// The text with `node` replaced by `lines`, whose first line is padded to the column
    /// `node` starts at. What stands before `node` on its first line, such as a list
    /// item's dash, is kept.
    pub(crate) fn replace_entry(&self, node: &Node, lines: &str) -> Self {
        let start = syntax::start(node);
        let pad = self
            .column(node)
            .min(lines.len() - lines.trim_start_matches(' ').len());
        self.splice(start, syntax::line_end(node), &lines[pad..])
    }

    /// The text with the lines `node` spans replaced by `lines`.
    pub(crate) fn replace_lines(&self, node: &Node, lines: &str) -> Self {
        self.splice(
            self.line_start(syntax::start(node)),
            syntax::line_end(node),
            lines,
        )
    }
}
