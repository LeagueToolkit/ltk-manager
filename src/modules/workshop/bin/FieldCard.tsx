import { twMerge } from "tailwind-merge";

import { Code, HoverCard, SeverityGlyph, Spinner } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { DeclaredKind, FieldRevision } from "@/lib/tauri";

import { shapeTag } from "./kindTag";
import { useClassSchema } from "./useClassSchema";

interface FieldCardProps {
  /** The class the field is read on. Null where the row's parent declares none. */
  classHash: string | null;
  /** `0x` and eight hex digits. */
  fieldHash: string;
  /** The field as the tables name it, or its hash where no table does. */
  name: string;
  /** No table names the field, and `name` is its hash. */
  unnamed: boolean;
  declared: DeclaredKind | null;
  triggerClassName?: string;
}

/**
 * A field name, and what the schema says about it while the pointer is on it.
 *
 * "The field card" in docs/ux/BIN_EDITOR.md. The body mounts when the card opens, which
 * is when its query runs.
 */
export function FieldCard({
  classHash,
  fieldHash,
  name,
  unnamed,
  declared,
  triggerClassName,
}: FieldCardProps) {
  return (
    <HoverCard
      label={name}
      className="w-72"
      content={
        <FieldCardBody
          classHash={classHash}
          fieldHash={fieldHash}
          name={name}
          unnamed={unnamed}
          declared={declared}
        />
      }
    >
      <span
        className={twMerge(
          "min-w-0 truncate decoration-dotted underline-offset-2 hover:underline",
          triggerClassName,
        )}
      >
        {name}
      </span>
    </HoverCard>
  );
}

function FieldCardBody({ classHash, fieldHash, name, unnamed, declared }: FieldCardProps) {
  return (
    <div data-ui="FieldCard" className="flex flex-col gap-2">
      <header className="flex min-w-0 flex-col items-start gap-1">
        {!unnamed && (
          <span className="max-w-full truncate text-row font-medium text-surface-100 select-text">
            {name}
          </span>
        )}
        <Code className="select-text">{fieldHash}</Code>
      </header>
      <DeclaredLine declared={declared} />
      {classHash !== null && <Revisions classHash={classHash} fieldHash={fieldHash} />}
    </div>
  );
}

/** The schema's line for a field: its declared kind, or that it has none at this build. */
export function DeclaredLine({ declared }: { declared: DeclaredKind | null }) {
  if (declared === null) {
    return <span className="text-surface-400">{m.workshop_bin_field_undeclared_label()}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-surface-300">
      {declared.mismatch && <SeverityGlyph severity="warning" />}
      <span>{m.workshop_bin_declared_label()}</span>
      <Code>{shapeTag(declared.shape)}</Code>
    </span>
  );
}

function Revisions({ classHash, fieldHash }: { classHash: string; fieldHash: string }) {
  const { data, error, isPending } = useClassSchema(classHash);

  if (isPending) return <Spinner size="sm" />;
  if (error) return <span className="text-surface-400">{errorSummary(error)}</span>;
  const field = data?.fields.find((candidate) => candidate.hash === fieldHash);
  if (!field) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-surface-400">{m.workshop_bin_revisions_label()}</span>
      <ul className="flex flex-col gap-0.5 select-text">
        {field.revisions.map((revision) => (
          <li key={revision.from} className="flex items-center gap-2 tabular-nums">
            <span className="text-surface-400">{span(revision)}</span>
            <span className="ml-auto font-mono text-code text-surface-200">
              {revisionTag(revision)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The builds a revision holds for. */
function span(revision: FieldRevision): string {
  if (revision.to === null) return m.workshop_bin_revision_open_label({ from: revision.from });
  return m.workshop_bin_revision_span_label({ from: revision.from, to: revision.to });
}

/** A revision's kind, or the word for one this build cannot map. */
function revisionTag(revision: FieldRevision): string {
  if (revision.shape === null) return m.workshop_bin_unmapped_kind_label();
  return shapeTag(revision.shape);
}
