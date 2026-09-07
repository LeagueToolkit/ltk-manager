import { twMerge } from "tailwind-merge";

import { Code, ExternalLink, HoverCard, Spinner } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { AppError, ClassSchema } from "@/lib/tauri";

import { useClassSchema } from "./useClassSchema";

/** The wiki addresses a class by its name, lowercased, and serves no page for a hash. */
function wikiUrl(name: string): string {
  return `https://meta-wiki.leaguetoolkit.dev/classes/${name.toLowerCase()}/`;
}

interface ClassCardProps {
  /** `0x` and eight hex digits. */
  classHash: string;
  /** The class as the tables name it. Null where no table does. */
  name: string | null;
}

/**
 * A class name, and what the schema says about it while the pointer is on it.
 *
 * "The class card" in docs/ux/BIN_EDITOR.md. The body mounts when the card opens, which
 * is when its query runs.
 */
export function ClassCard({ classHash, name }: ClassCardProps) {
  const label = name ?? classHash;

  return (
    <HoverCard
      label={label}
      className="w-80"
      content={<ClassCardBody classHash={classHash} name={name} />}
    >
      <span
        className={twMerge(
          /* DS-KIND-HUE, DS-TEXT */
          "min-w-0 truncate text-bin-class-text decoration-dotted underline-offset-2 hover:underline",
          name === null && "font-mono text-code",
        )}
      >
        {label}
      </span>
    </HoverCard>
  );
}

function ClassCardBody({ classHash, name }: ClassCardProps) {
  const { data, error, isPending } = useClassSchema(classHash);

  return (
    <div data-ui="ClassCard" className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        {name !== null && (
          <span className="min-w-0 flex-1 truncate text-row font-medium text-surface-100 select-text">
            {name}
          </span>
        )}
        <Code className={twMerge("shrink-0 select-text", name === null && "flex-1")}>
          {classHash}
        </Code>
      </header>
      <footer className="flex items-center justify-between gap-3">
        <Basis pending={isPending} error={error} schema={data} />
        {name !== null && (
          <ExternalLink href={wikiUrl(name)} className="shrink-0">
            {m.workshop_bin_meta_wiki_action()}
          </ExternalLink>
        )}
      </footer>
    </div>
  );
}

interface BasisProps {
  pending: boolean;
  error: AppError | null;
  schema: ClassSchema | null | undefined;
}

/** What the schema had to say, which is the patch it answered at or that it had no line. */
function Basis({ pending, error, schema }: BasisProps) {
  if (pending) return <Spinner size="sm" />;
  if (error)
    return <span className="min-w-0 truncate text-surface-400">{errorSummary(error)}</span>;
  if (schema === null) {
    return <span className="text-surface-400">{m.workshop_bin_class_unknown_empty()}</span>;
  }
  /* A build number names no patch a modder reads, so a schema read at a build the install
     does not have says nothing rather than a number nobody can place. */
  if (!schema?.patch) return <span />;
  return (
    <span className="text-surface-400">
      {m.workshop_bin_at_patch_label({ patch: schema.patch })}
    </span>
  );
}
