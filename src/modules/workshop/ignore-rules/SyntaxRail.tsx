import { CaretDownIcon } from "@phosphor-icons/react";

import { Code, ExternalLink } from "@/components";
import { m } from "@/i18n";

/** Where the wiki explains the dialect the matcher reads. */
const WIKI_URL = "https://wiki.leaguetoolkit.dev/making-mods/mod-projects/#ignore-rules";

const FORMS = [
  { pattern: "*.psd", meaning: () => m.workshop_ignore_form_extension_label() },
  { pattern: "wip/", meaning: () => m.workshop_ignore_form_folder_label() },
  { pattern: "/base/notes.txt", meaning: () => m.workshop_ignore_form_anchored_label() },
  { pattern: "!keep.psd", meaning: () => m.workshop_ignore_form_negation_label() },
] as const;

const RULES = [
  () => m.workshop_ignore_rule_anchor_hint(),
  () => m.workshop_ignore_rule_separator_hint(),
  () => m.workshop_ignore_rule_case_hint(),
] as const;

/**
 * The syntax beside the text rather than behind a button.
 *
 * Wide enough to sit in the split, and a disclosure under the text once the
 * pane cannot hold both, per "Ignore rules" in docs/ux/PROJECT_EDITOR.md.
 */
export function SyntaxRail() {
  return (
    <>
      <aside className="hidden w-55 shrink-0 overflow-y-auto scrollbar-md select-none @[560px]:block">
        <Card />
      </aside>

      <details className="shrink-0 border-t border-surface-700/50 select-none @[560px]:hidden">
        <summary className="flex cursor-default items-center gap-1.5 px-3 py-2 text-meta text-surface-400 hover:text-surface-200">
          <CaretDownIcon className="h-3.5 w-3.5" />
          {m.workshop_ignore_syntax_title()}
        </summary>
        <div className="px-3 pb-3">
          <Card />
        </div>
      </details>
    </>
  );
}

function Card() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-700 bg-surface-900 p-3">
      {/* DS-TEXT */}
      <h2 className="text-xs font-medium tracking-wide text-surface-400 uppercase">
        {m.workshop_ignore_syntax_title()}
      </h2>

      <dl className="flex flex-col gap-2 text-meta">
        {FORMS.map((form) => (
          <div key={form.pattern} className="flex flex-col gap-0.5">
            <dt>
              <Code>{form.pattern}</Code>
            </dt>
            <dd className="text-surface-400">{form.meaning()}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-1.5 border-t border-surface-700/50 pt-3 text-meta text-surface-400">
        {RULES.map((rule) => (
          <li key={rule()}>{rule()}</li>
        ))}
      </ul>

      <ExternalLink href={WIKI_URL} className="text-meta">
        {m.workshop_ignore_syntax_link_action()}
      </ExternalLink>
    </div>
  );
}
