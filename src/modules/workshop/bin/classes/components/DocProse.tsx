import type { ReactNode } from "react";

import { MarkdownView } from "@/components";
import { m } from "@/i18n";
import type { Doc } from "@/lib/tauri";

import { META_WIKI } from "../utils/metaWiki";

/**
 * The meta wiki's documentation for a class or a field, inside a hover card.
 *
 * Draws the description, then the notes and the examples, each under a label. Long text
 * scrolls inside the card, and relative links open on the wiki.
 */
export function DocProse({ doc }: { doc: Doc }) {
  return (
    <div
      data-ui="DocProse"
      className="flex max-h-72 flex-col gap-2 overflow-y-auto scrollbar-md select-text"
    >
      {doc.description && <Prose text={doc.description} />}
      {doc.notes.length > 0 && (
        <Part label={m.workshop_bin_doc_notes_label()}>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {doc.notes.map((note) => (
              <li key={note}>
                <Prose text={note} />
              </li>
            ))}
          </ul>
        </Part>
      )}
      {doc.examples.length > 0 && (
        <Part label={m.workshop_bin_doc_examples_label()}>
          {doc.examples.map((example) => (
            <Prose key={example} text={example} />
          ))}
        </Part>
      )}
    </div>
  );
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-surface-400 select-none">{label}</span>
      {children}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <MarkdownView text={text} root={null} linkBase={META_WIKI} className="text-meta *:last:mb-0" />
  );
}
