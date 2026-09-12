import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Code, EmptyState, ExternalLink, Field, Spinner } from "@/components";
import { m } from "@/i18n";
import type { InstalledMod, ModDocument, ModLicense } from "@/lib/tauri";
import { modQueries } from "@/modules/library/api";
import { twMerge } from "@/utils";

/** The mods under one license name, or under no license at all. */
interface LicenseGroup {
  /** The license every mod in this group declares, or `null` for the undeclared. */
  license: ModLicense | null;
  mods: InstalledMod[];
}

interface LicensesTabProps {
  mods: InstalledMod[];
}

/**
 * What every installed mod is licensed under, grouped by the name it declares.
 *
 * Library-wide rather than following whichever mod the readme tab holds, which
 * is what makes it an audit: every all-rights-reserved mod in one block, every
 * undeclared one in another. A name costs nothing, because it rides in the
 * config a listing already opens. A text costs one archive mount, so it is read
 * where a row is expanded.
 */
export function LicensesTab({ mods }: LicensesTabProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupByLicense(mods, query), [mods, query]);

  if (mods.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState size="sm" title={m.library_licenses_empty_title()} />
      </div>
    );
  }

  return (
    <div data-ui="LicensesTab" className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex shrink-0 items-center px-3 py-2">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-6 h-4 w-4 text-surface-500" />
        <Field.Control
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={m.library_licenses_search_placeholder()}
          aria-label={m.library_licenses_search_placeholder()}
          className="pl-9"
        />
      </div>

      {groups.length === 0 && (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            size="sm"
            title={m.library_licenses_no_match_title()}
            description={m.library_licenses_no_match_description()}
          />
        </div>
      )}

      {groups.length > 0 && (
        <ul className="min-h-0 flex-1 overflow-y-auto pb-3 scrollbar-md">
          {groups.map((group) => (
            <Group key={group.license?.name ?? ""} group={group} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Group({ group }: { group: LicenseGroup }) {
  return (
    <li>
      <div className="flex items-center gap-2 border-b border-surface-700/60 px-3 py-1.5 select-none">
        <GroupName license={group.license} />
        <span className="ml-auto shrink-0 text-meta text-surface-500 tabular-nums">
          {group.mods.length}
        </span>
      </div>
      <ul>
        {group.mods.map((mod) => (
          <Row key={mod.id} mod={mod} declared={group.license !== null} />
        ))}
      </ul>
    </li>
  );
}

function GroupName({ license }: { license: ModLicense | null }) {
  if (!license) {
    return (
      <span className="text-meta text-surface-400">{m.library_licenses_undeclared_label()}</span>
    );
  }

  /* DS-CODE-CHIP: the name is a value the panel is talking about. */
  return <Code>{license.name}</Code>;
}

/**
 * One mod's row, which expands to the text its archive carries.
 *
 * A mod that declares no license has nothing to expand, which is the whole
 * difference between "not declared" and a name with no file behind it.
 */
function Row({ mod, declared }: { mod: InstalledMod; declared: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!declared) {
    return (
      <li className="px-3 py-1.5 pl-8 text-row text-surface-300 select-text">{mod.displayName}</li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors select-none hover:bg-surface-veil"
      >
        <CaretRightIcon
          weight="bold"
          className={twMerge(
            "h-3.5 w-3.5 shrink-0 text-surface-500 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-row text-surface-300">{mod.displayName}</span>
      </button>
      {expanded && <LicenseText mod={mod} />}
    </li>
  );
}

/** One mod's license, read out of its archive the first time a reader asks. */
function LicenseText({ mod }: { mod: InstalledMod }) {
  const { data, isPending, error } = useQuery(modQueries.licenseText(mod.id));

  return (
    <div className="flex flex-col gap-2 border-y border-surface-700/60 bg-surface-950/40 px-3 py-2 pl-8">
      {mod.license?.url && (
        <ExternalLink href={mod.license.url} className="self-start text-meta">
          {mod.license.url}
        </ExternalLink>
      )}
      {isPending && <Spinner />}
      {error && <Note>{m.library_licenses_unreadable_description()}</Note>}
      {data && <Text document={data} />}
    </div>
  );
}

function Text({ document }: { document: ModDocument }) {
  if (document.state === "absent") {
    return <Note>{m.library_licenses_no_text_description()}</Note>;
  }

  if (document.state === "unreadable") {
    return <Note>{m.library_licenses_unreadable_description()}</Note>;
  }

  /* A license is a hard-wrapped plain-text file, and rendering it as Markdown
     mangles it. */
  return (
    <pre className="max-h-64 overflow-auto text-meta leading-relaxed whitespace-pre-wrap text-surface-400 scrollbar-sm select-text">
      {document.text}
    </pre>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-meta text-surface-500">{children}</p>;
}

/**
 * The mods `query` matches, under the license name each declares.
 *
 * A search reads the mod's name and the license's alike, because a reader
 * asking "which of mine are all-rights-reserved" types the license.
 */
function groupByLicense(mods: InstalledMod[], query: string): LicenseGroup[] {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? mods.filter(
        (mod) =>
          mod.displayName.toLowerCase().includes(needle) ||
          (mod.license?.name ?? "").toLowerCase().includes(needle),
      )
    : mods;

  const named = new Map<string, LicenseGroup>();
  const undeclared: InstalledMod[] = [];

  for (const mod of matched) {
    if (!mod.license) {
      undeclared.push(mod);
      continue;
    }

    const group = named.get(mod.license.name);
    if (group) group.mods.push(mod);
    else named.set(mod.license.name, { license: mod.license, mods: [mod] });
  }

  const groups = [...named.values()].sort((a, b) =>
    (a.license?.name ?? "").localeCompare(b.license?.name ?? ""),
  );

  /* Undeclared last: it is the absence of an answer rather than one of them. */
  if (undeclared.length > 0) groups.push({ license: null, mods: undeclared });

  return groups;
}
