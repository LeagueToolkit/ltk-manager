import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Code, EmptyState, ExternalLink, Spinner } from "@/components";
import { m } from "@/i18n";
import type { InstalledMod, ModDocument, ModLicense } from "@/lib/tauri";
import { modQueries } from "@/modules/library/api";

interface LicensesTabProps {
  /** The mod the panel was opened about, or none yet. */
  mod: InstalledMod | null;
  /** Whether the mod the panel held has been uninstalled under it. */
  missing: boolean;
}

/**
 * What one installed mod is licensed under, and the text it ships for it.
 *
 * The name rides in the config a listing already opens, so it costs nothing.
 * The text is on disk for neither format, so reading it mounts that mod's
 * archive, and the answer is held for the session and never written to disk.
 */
export function LicensesTab({ mod, missing }: LicensesTabProps) {
  if (missing) {
    return (
      <Body>
        <EmptyState
          size="sm"
          title={m.library_documents_removed_title()}
          description={m.library_documents_removed_description()}
        />
      </Body>
    );
  }

  if (!mod) {
    return (
      <Body>
        <EmptyState
          size="sm"
          title={m.library_licenses_none_open_title()}
          description={m.library_licenses_none_open_description()}
        />
      </Body>
    );
  }

  if (!mod.license) {
    return (
      <Body>
        <EmptyState
          size="sm"
          title={m.library_licenses_undeclared_title()}
          description={m.library_licenses_undeclared_description()}
        />
      </Body>
    );
  }

  return <License modId={mod.id} license={mod.license} />;
}

function License({ modId, license }: { modId: string; license: ModLicense }) {
  return (
    <div data-ui="LicensesTab" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col items-start gap-1.5 border-b border-surface-700 px-3 py-2 select-none">
        {/* DS-CODE-CHIP: the name is a value the panel is talking about. */}
        <Code>{license.name}</Code>
        {license.url && (
          <ExternalLink href={license.url} className="text-meta">
            {license.url}
          </ExternalLink>
        )}
      </div>
      <Text modId={modId} />
    </div>
  );
}

/** One mod's license text, read out of its archive the first time a reader asks. */
function Text({ modId }: { modId: string }) {
  const { data, isPending, error } = useQuery(modQueries.licenseText(modId));

  if (isPending) {
    return (
      <Body>
        <Spinner />
      </Body>
    );
  }

  if (error) {
    return (
      <Body>
        <Note>{m.library_licenses_unreadable_description()}</Note>
      </Body>
    );
  }

  return <Document document={data} />;
}

/**
 * A license, or which of the two silences this mod is keeping.
 *
 * A mod that names a license and ships no file for it is the common case, and
 * an archive that would not open is the one that says the mod may not work.
 */
function Document({ document }: { document: ModDocument }) {
  if (document.state === "absent") {
    return (
      <Body>
        <Note>{m.library_licenses_no_text_description()}</Note>
      </Body>
    );
  }

  if (document.state === "unreadable") {
    return (
      <Body>
        <Note>{m.library_licenses_unreadable_description()}</Note>
      </Body>
    );
  }

  /* A license is a hard-wrapped plain-text file, and rendering it as Markdown
     mangles it. */
  return (
    <pre
      data-ui="LicensesTab:text"
      className="min-h-0 flex-1 overflow-auto p-3 text-meta leading-relaxed whitespace-pre-wrap text-surface-400 scrollbar-md select-text"
    >
      {document.text}
    </pre>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-center text-meta text-surface-500">{children}</p>;
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">{children}</div>
  );
}
