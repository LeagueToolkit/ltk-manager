import { ExternalLink } from "@/components";
import { m } from "@/i18n";
import { LegendBar } from "@/modules/editor";

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

/** The gitignore dialect the matcher reads, as the document's legend. */
export function SyntaxBar() {
  return (
    <LegendBar
      title={m.workshop_ignore_syntax_title()}
      terms={FORMS.map((form) => ({ term: form.pattern, meaning: form.meaning() }))}
      notes={RULES.map((rule) => rule())}
      action={
        <ExternalLink href={WIKI_URL} className="text-meta">
          {m.workshop_ignore_syntax_link_action()}
        </ExternalLink>
      }
    />
  );
}
