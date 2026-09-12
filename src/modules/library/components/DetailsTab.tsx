import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  FolderOpenIcon,
  PackageIcon,
  PencilSimpleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Button, EmptyState } from "@/components";
import { m } from "@/i18n";
import { type InstalledMod, revealPath } from "@/lib/tauri";
import {
  useAnalyzeModWads,
  useModChecksumMismatches,
  useModWadReport,
  useSetModLayers,
} from "@/modules/library/api";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { twMerge } from "@/utils";

import { DetailsCover } from "./DetailsCover";
import { DetailsEditForm } from "./DetailsEditForm";
import { LayerToggleList } from "./LayerToggleList";

interface DetailsTabProps {
  /** The mod the panel was opened about, or none yet. */
  mod: InstalledMod | null;
  /** Whether the mod the panel held has been uninstalled under it. */
  missing: boolean;
}

/**
 * What one installed mod is: its cover, its facts, and what it patches.
 *
 * The three dialogs this replaces each answered part of that question and each
 * covered the library to do it.
 */
export function DetailsTab({ mod, missing }: DetailsTabProps) {
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
          title={m.library_details_none_open_title()}
          description={m.library_details_none_open_description()}
        />
      </Body>
    );
  }

  /* Keyed by the mod, so an unfinished edit never survives onto another. */
  return <Details key={mod.id} mod={mod} />;
}

function Details({ mod }: { mod: InstalledMod }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <DetailsEditForm mod={mod} onDone={() => setEditing(false)} />;

  return (
    <div data-ui="DetailsTab" className="min-h-0 flex-1 overflow-y-auto scrollbar-md select-none">
      <Cover mod={mod} />
      <Actions mod={mod} onEdit={() => setEditing(true)} />
      <Facts mod={mod} />
      <Layers mod={mod} />
      <WadFootprint modId={mod.id} />
      <Packaging modId={mod.id} />
    </div>
  );
}

function Cover({ mod }: { mod: InstalledMod }) {
  const { data: thumbnailUrl } = useModThumbnail(mod.id);

  return <DetailsCover mod={mod} thumbnailUrl={thumbnailUrl} />;
}

function Actions({ mod, onEdit }: { mod: InstalledMod; onEdit: () => void }) {
  return (
    <Section className="flex items-center gap-1 px-2 py-1.5">
      <Button
        variant="ghost"
        size="sm"
        left={<PencilSimpleIcon className="h-4 w-4" />}
        onClick={onEdit}
      >
        {m.library_details_edit_action()}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        left={<FolderOpenIcon className="h-4 w-4" />}
        onClick={() => revealPath(mod.modDir)}
      >
        {m.library_details_open_location_action()}
      </Button>
    </Section>
  );
}

/** Who wrote the mod, when it arrived, what it says it does and what it is about. */
function Facts({ mod }: { mod: InstalledMod }) {
  const installed = new Date(mod.installedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Section className="flex flex-col gap-2">
      <p className="text-meta text-surface-400 select-text">
        {mod.authors.join(", ") || m.library_details_unknown_author_label()}
        {" · "}
        {m.library_details_installed_label({ date: installed })}
      </p>
      {mod.description && (
        <p className="text-meta leading-relaxed text-surface-300 select-text">{mod.description}</p>
      )}
      <Categories mod={mod} />
    </Section>
  );
}

/* The card's own declared-pill hues. DS-KIND-HUE. */
const PILL_CLASSES = {
  tag: "bg-surface-700 text-surface-300",
  champion: "bg-cat-champion/15 text-cat-champion-text",
  map: "bg-cat-map/15 text-cat-map-text",
} as const;

function Categories({ mod }: { mod: InstalledMod }) {
  const pills = [
    ...mod.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: getTagLabel(tag),
      tone: "tag" as const,
    })),
    ...mod.champions.map((champion) => ({
      key: `champion:${champion}`,
      label: champion,
      tone: "champion" as const,
    })),
    ...mod.maps.map((map) => ({
      key: `map:${map}`,
      label: getMapLabel(map),
      tone: "map" as const,
    })),
  ];

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((pill) => (
        <span
          key={pill.key}
          className={twMerge(
            "rounded-full px-2.5 py-0.5 text-meta select-none",
            PILL_CLASSES[pill.tone],
          )}
        >
          {pill.label}
        </span>
      ))}
    </div>
  );
}

/** The mod's layers, for one that has more than the base to switch. */
function Layers({ mod }: { mod: InstalledMod }) {
  const setModLayers = useSetModLayers();

  if (mod.layers.length <= 1) return null;

  function handleToggle(layerName: string, enabled: boolean) {
    const layerStates: Record<string, boolean> = {};
    for (const layer of mod.layers) {
      layerStates[layer.name] = layer.name === layerName ? enabled : layer.enabled;
    }
    setModLayers.mutate({ modId: mod.id, layerStates });
  }

  const enabled = mod.layers.filter((layer) => layer.enabled).length;

  return (
    <Fold title={m.library_details_layers_label()} trailing={`${enabled}/${mod.layers.length}`}>
      <LayerToggleList layers={mod.layers} onToggle={handleToggle} className="rounded-md" />
    </Fold>
  );
}

/**
 * Which game WADs the mod patches, analysed the first time the fold opens.
 *
 * The dialog got "no work until asked" from `Dialog.Portal`, which unmounts its
 * children while closed. A section in a scrolling tab has no such gate, so the
 * fold is the gate and this body is what mounting it runs.
 */
function WadFootprint({ modId }: { modId: string }) {
  return (
    <Fold title={m.library_details_wads_label()}>
      <WadReport modId={modId} />
    </Fold>
  );
}

function WadReport({ modId }: { modId: string }) {
  const { data: report, isLoading } = useModWadReport(modId);
  const { mutate: analyze, isPending, isError } = useAnalyzeModWads();
  const requested = useRef(false);

  // StrictMode mounts an effect twice, and one opening is one analysis.
  useEffect(() => {
    if (isLoading || report || requested.current) return;
    requested.current = true;
    analyze(modId);
  }, [analyze, isLoading, modId, report]);

  const groups = useMemo(() => (report ? groupWadsByCategory(report.affectedWads) : []), [report]);

  if (!report && isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-meta text-surface-400">{m.library_details_wads_failed_description()}</p>
        <Button variant="outline" size="sm" loading={isPending} onClick={() => analyze(modId)}>
          <ArrowsClockwiseIcon className="h-4 w-4" weight="bold" />
          {m.library_details_wads_retry_action()}
        </Button>
      </div>
    );
  }

  if (!report) {
    return (
      <p className="flex items-center gap-2 text-meta text-surface-400">
        <SpinnerGapIcon className="h-4 w-4 animate-spin" />
        {m.library_details_wads_reading_label()}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-meta text-surface-300">
          {m.library_details_wads_count_label({ count: report.wadCount })}
          {" · "}
          {m.library_details_overrides_count_label({ count: report.overrideCount })}
        </p>
        <p className="mt-0.5 text-meta text-surface-500">
          {m.library_details_wads_analyzed_label({
            when: formatDistanceToNow(new Date(report.computedAt), { addSuffix: true }),
          })}
        </p>
        {report.isStale && (
          <p className="mt-1 text-meta text-warning-text">{m.library_details_wads_stale_hint()}</p>
        )}
      </div>

      {groups.length === 0 && (
        <p className="text-meta text-surface-400">{m.library_details_wads_none_description()}</p>
      )}
      {groups.map((group) => (
        <CategorySection key={group.label} group={group} />
      ))}

      <Button
        variant="outline"
        size="sm"
        loading={isPending}
        onClick={() => analyze(modId)}
        className="self-start"
      >
        <ArrowsClockwiseIcon className="h-4 w-4" weight="bold" />
        {m.library_details_wads_reanalyze_action()}
      </Button>
    </div>
  );
}

interface CategoryGroup {
  label: string;
  wads: string[];
}

function CategorySection({ group }: { group: CategoryGroup }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-surface-400 uppercase select-none">
        {group.label} · {group.wads.length}
      </div>
      <ul className="mt-0.5 text-meta">
        {group.wads.map((wad) => (
          <li
            key={wad}
            className="truncate font-mono text-code text-surface-300 select-text"
            title={wad}
          >
            {shortWadName(wad)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The affected WADs under the game directory each sits in.
 *
 * A whole segment has to match, so a target named `Old_Champions` stays under
 * Other rather than joining the champions.
 */
function groupWadsByCategory(wads: string[]): CategoryGroup[] {
  const champions: string[] = [];
  const maps: string[] = [];
  const ui: string[] = [];
  const other: string[] = [];

  for (const wad of wads) {
    const segments = wad.replace(/\\/g, "/").split("/");
    const category = segments.find((s) => s !== "" && s !== "DATA" && s !== "FINAL");
    const lower = category?.toLowerCase();

    if (lower === "champions") {
      champions.push(wad);
    } else if (lower === "maps") {
      maps.push(wad);
    } else if (lower === "ux" || lower === "ui") {
      ui.push(wad);
    } else {
      other.push(wad);
    }
  }

  return [
    { label: m.library_details_wads_champions_label(), wads: champions },
    { label: m.library_details_wads_maps_label(), wads: maps },
    { label: m.library_details_wads_ui_label(), wads: ui },
    { label: m.library_details_wads_other_label(), wads: other },
  ].filter((group) => group.wads.length > 0);
}

function shortWadName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Advisory about a badly-packed archive: the last overlay build found chunks
 * whose container claimed checksums their own bytes don't have. Never blocks
 * anything — the build carries the corrected values — so this renders nothing
 * for a mod whose containers told the truth.
 */
function Packaging({ modId }: { modId: string }) {
  const { data: mismatches } = useModChecksumMismatches(modId);
  if (!mismatches || mismatches.length === 0) return null;

  const byWad = new Map<string, number>();
  for (const mismatch of mismatches) {
    byWad.set(mismatch.wadName, (byWad.get(mismatch.wadName) ?? 0) + 1);
  }

  return (
    <Section className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-row font-medium text-surface-200 select-none">
        <PackageIcon className="h-4 w-4 text-warning-text" />
        {m.library_details_packaging_label()}
      </p>
      <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
        <p className="text-meta leading-relaxed text-surface-300">
          {m.library_details_packaging_description()}
        </p>
        <ul className="flex flex-col gap-0.5">
          {[...byWad].map(([wadName, count]) => (
            <li key={wadName} className="flex items-baseline gap-2 text-meta text-surface-400">
              <span className="font-mono text-code break-all select-text">{wadName}</span>
              <span className="shrink-0">
                {m.library_details_packaging_chunks_label({ count })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** One band of the column. DS-SETTING-LEVEL: a rule and a rhythm, never a box. */
function Section({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={twMerge("border-t border-surface-700/40 px-3 py-3", className)}>{children}</div>
  );
}

/**
 * A band that opens, and whose body mounts only once it is open.
 *
 * Mounting is what runs the work a section costs, so a library nobody expands
 * reads nothing. Same shape as the licenses tab's own rows.
 */
function Fold({
  title,
  trailing,
  children,
}: {
  title: string;
  /** What the closed fold answers on its own, such as a tally. */
  trailing?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Section className="p-0">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors select-none hover:bg-surface-veil"
      >
        <CaretRightIcon
          weight="bold"
          className={twMerge(
            "h-3.5 w-3.5 shrink-0 text-surface-500 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-row font-medium text-surface-200">
          {title}
        </span>
        {trailing && (
          <span className="shrink-0 text-meta text-surface-500 tabular-nums">{trailing}</span>
        )}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </Section>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">{children}</div>
  );
}
