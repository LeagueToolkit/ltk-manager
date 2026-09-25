import { LinkSimpleIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import { m } from "@/i18n";

import {
  summarizeValue,
  type YamlTag,
  type YamlToken,
  type YamlTokenKind,
} from "../utils/yamlValue";

/* DS-KIND-HUE: a tag names a kind in ritobin's words, and a class a schema class. */
const TOKEN_CLASSES: Record<YamlTokenKind, string> = {
  space: "",
  comment: "italic text-surface-500",
  punct: "text-surface-500",
  key: "text-surface-400",
  tag: "text-bin-kind-text",
  class: "text-bin-class-text",
  string: "text-surface-200",
  scalar: "text-surface-200",
};

/** One line of YAML, coloured by what each run spells. */
function YamlLine({ tokens }: { tokens: readonly YamlToken[] }) {
  return (
    <>
      {tokens.map((token, at) => (
        <span key={at} className={TOKEN_CLASSES[token.kind]}>
          {token.text}
        </span>
      ))}
    </>
  );
}

/**
 * A key's value on one line: as spelled where it fits, a reference as a link, a struct as its
 * kind and class, and a block folded into flow. The full value is on hover.
 */
export function ValueSummaryView({ value }: { value: string }) {
  const summary = useMemo(() => summarizeValue(value), [value]);

  switch (summary.kind) {
    case "line":
      return (
        <span className="min-w-0 truncate" title={value}>
          <YamlLine tokens={summary.tokens} />
        </span>
      );
    case "reference":
      return (
        <span className="flex min-w-0 items-center gap-1 text-surface-200" title={value}>
          <LinkSimpleIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-400" />
          <span className="truncate">{summary.target}</span>
        </span>
      );
    case "struct":
      return (
        <span className="min-w-0 truncate" title={value}>
          <Tag tag={summary.tag} />
        </span>
      );
    case "structs":
      return (
        <span className="min-w-0 truncate" title={value}>
          <span className="text-surface-400">
            {m.workshop_declarations_times_label({ count: summary.items })}
          </span>{" "}
          <Tag tag={summary.tag} />
        </span>
      );
  }
}

function Tag({ tag }: { tag: YamlTag }) {
  return (
    <>
      <span className="text-bin-kind-text">{tag.name}</span>
      {tag.className !== null && <span className="text-bin-class-text"> {tag.className}</span>}
    </>
  );
}
