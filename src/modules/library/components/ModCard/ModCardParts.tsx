import {
  ArchiveIcon,
  BookOpenTextIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  FolderIcon,
  FolderOpenIcon,
  HeartbeatIcon,
  InfoIcon,
  PackageIcon,
  QuestionIcon,
  ShieldWarningIcon,
  SpinnerGapIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";

import {
  AutoPill,
  type AutoPillTone,
  type CategoryTone,
  Chip,
  ContextMenu,
  Dialog,
  IconButton,
  Menu,
  Switch,
  Tooltip,
  useToast,
} from "@/components";
import { m } from "@/i18n";
import type { InstalledMod, ModStorage } from "@/lib/tauri";
import { ChampionPortrait, useChampionRoster } from "@/modules/champions";
import {
  useCheckModHealth,
  useHealthCheckReadiness,
  useModEffectiveCategories,
} from "@/modules/library/api";
import { useLibrarySidebarStore, useLibraryTableStore } from "@/modules/library/state";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { useSettings } from "@/modules/settings/api";
import { openModTrace, useModHealthDrawerStore } from "@/stores";
import { twMerge } from "@/utils";

import { MoveToFolderSubmenu } from "../MoveToFolderMenu";
import { ModCardUpdateItem } from "./ModCardUpdateItem";
import type { ModCardView } from "./useModCardController";

type CardVariant = "grid" | "list";

const THUMBNAIL_VARIANTS: Record<
  CardVariant,
  { container: string; bare: string; placeholder: string; placeholderOff: string; image: string }
> = {
  grid: {
    /* Its own corner, one border-width inside the card's. Left to the card's
       clip it steps against the border instead of following it, because the
       two curves are drawn by different passes. */
    container:
      "relative aspect-video overflow-hidden rounded-t-[max(0px,calc(var(--radius-xl)-2px))] bg-linear-to-br from-surface-700 to-surface-800",
    /* The flat panel sits tone-on-tone with the card, so its corner is read
       against the outer silhouette rather than the border it hugs. The
       concentric radius looks under-rounded there, and only art earns it. */
    bare: "rounded-t-xl",
    placeholder: "text-4xl font-bold",
    placeholderOff: "text-surface-400",
    /* The card answers a hover here rather than by scaling itself. Any scale
       over the body resamples the name and the version under it, and text a
       hundredth larger is text redrawn slightly wrong. */
    image: "transition-[scale] duration-200 ease-out group-hover:scale-[1.02]",
  },
  list: {
    container:
      "relative h-12 w-[5.25rem] shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800",
    bare: "",
    placeholder: "text-lg font-bold",
    placeholderOff: "text-surface-500",
    image: "",
  },
};

export function ModCardThumbnail({
  variant,
  thumbnailUrl,
  displayName,
  lit = false,
}: {
  variant: CardVariant;
  thumbnailUrl?: string;
  displayName: string;
  /** Whether the mod is on, which the placeholder answers and cover art cannot. */
  lit?: boolean;
}) {
  const styles = THUMBNAIL_VARIANTS[variant];
  return (
    <div className={twMerge(styles.container, !thumbnailUrl && styles.bare)}>
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={twMerge("absolute inset-0 size-full object-cover", styles.image)}
        />
      )}
      {/* A mod with no art is a letter on a flat panel, and that is most of a
          library. Colouring the letter puts the state in the middle of the
          card, where art of its own would have been carrying it. */}
      {!thumbnailUrl && (
        <div className="flex size-full items-center justify-center">
          <span
            className={twMerge(
              styles.placeholder,
              "select-none",
              lit ? "text-placeholder-lit" : styles.placeholderOff,
            )}
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

/** The list row's toggle. A grid card has none, since the card itself is the control. */
export function ModCardToggle({ view }: { view: ModCardView }) {
  const { mod } = view;
  const label = mod.enabled
    ? m.library_mod_disable_label({ name: mod.displayName })
    : m.library_mod_enable_label({ name: mod.displayName });

  return (
    <Switch
      disabled={view.disabled}
      checked={mod.enabled}
      onCheckedChange={(checked) => view.onToggle(mod.id, checked)}
      aria-label={label}
    />
  );
}

/**
 * Where the mod's content is read from, as a choice between the two rather than
 * a button naming the one it is not.
 *
 * Per "Storage" in GLOSSARY.md.
 */
function ModCardStorageSubmenu({ view }: { view: ModCardView }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        icon={<PackageIcon className="size-4" weight="bold" />}
        disabled={view.storageChangePending}
      >
        {m.library_mod_storage_label()}
      </Menu.SubmenuTrigger>
      <Menu.SubmenuContent data-ui="ModCardMenu:storage">
        <Menu.RadioGroup
          value={view.mod.storage}
          onValueChange={(storage) => view.onSetStorage(storage as ModStorage)}
        >
          <Menu.RadioItem
            value="project"
            icon={<FolderIcon className="size-4" weight="bold" />}
            closeOnClick
          >
            {m.library_mod_storage_project_label()}
          </Menu.RadioItem>
          <Menu.RadioItem
            value="archive"
            icon={<ArchiveIcon className="size-4" weight="bold" />}
            closeOnClick
          >
            {m.library_mod_storage_archive_label()}
          </Menu.RadioItem>
        </Menu.RadioGroup>
      </Menu.SubmenuContent>
    </Menu.SubmenuRoot>
  );
}

/**
 * The kebab, which draws nothing until the card is under the pointer.
 *
 * Its own commands are never the reason to look at a card, and a grid of them
 * was a column of identical glyphs down the right of every row. The same menu
 * is on the card's right click, so nothing here is reachable only by finding a
 * button that is not currently drawn.
 */
export function ModCardMenu({
  view,
  reveal,
  className,
}: {
  view: ModCardView;
  reveal?: boolean;
  className?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            icon={<DotsThreeVerticalIcon />}
            size="sm"
            aria-label={m.library_mod_options_label({ name: view.mod.displayName })}
            reveal={reveal}
            className={className}
          />
        }
      />
      <Menu.Content>
        <ModCardMenuItems view={view} />
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * The card's menu on its right click, over the whole card rather than a target.
 *
 * The same commands the kebab opens, whatever is picked. Per "What a right
 * click opens" in `docs/ux/LIBRARY.md`.
 *
 * Renders the card itself through `render`, so the trigger is the card and the
 * grid keeps the child it was sizing.
 */
export function ModCardContextMenu({
  view,
  card,
  children,
}: {
  view: ModCardView;
  card: ReactElement;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={card}>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ModCardMenuItems view={view} />
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/**
 * Every command a mod card offers, for whichever popup is asking.
 *
 * Base UI builds a menu and a context menu out of the same item, so one list
 * hangs under either root - and the two ways into it cannot drift into offering
 * different commands.
 */
function ModCardMenuItems({ view }: { view: ModCardView }) {
  const { mod, isFlagged, canChangeStorage, canCheckHealth } = view;

  return (
    <>
      {isFlagged && (
        <Menu.Item
          icon={<ShieldWarningIcon className="size-4" weight="bold" />}
          onClick={() => view.setSkinhackInfoOpen(true)}
        >
          {m.library_mod_skinhack_action()}
        </Menu.Item>
      )}
      {!isFlagged && <ModCardDetailsItem modId={mod.id} />}
      <ModCardReadmeItem modId={mod.id} />
      <Menu.Item
        icon={<FolderOpenIcon className="size-4" weight="bold" />}
        onClick={view.onOpenLocation}
      >
        {m.library_mod_open_location_action()}
      </Menu.Item>
      {canChangeStorage && <ModCardStorageSubmenu view={view} />}
      {canCheckHealth && <ModCardHealthItem modId={mod.id} />}
      <Menu.Item
        icon={<QuestionIcon className="size-4" weight="bold" />}
        onClick={() =>
          openModTrace({ subject: { kind: "mod", id: mod.id }, name: mod.displayName })
        }
      >
        {m.diagnostics_trace_action()}
      </Menu.Item>
      <ModCardUpdateItem modId={mod.id} />
      <Menu.Item icon={<CopyIcon className="size-4" weight="bold" />} onClick={view.onCopyId}>
        {m.library_mod_copy_id_action()}
      </Menu.Item>
      <MoveToFolderSubmenu mods={[mod]} />
      <Menu.Separator />
      <Menu.Item
        icon={<TrashIcon className="size-4" weight="bold" />}
        variant="danger"
        onClick={view.onUninstall}
      >
        {m.library_mod_uninstall_action()}
      </Menu.Item>
    </>
  );
}

/**
 * Open this mod into the documents panel, on what it is.
 *
 * One item where there were three. The facts, the metadata form and the WAD
 * footprint are sections of one tab, and a menu that listed them separately was
 * offering three routes to the same panel.
 */
/** Bring back a collapsed dock, so an item that aims the panel always shows it. */
function revealDock() {
  useLibraryTableStore.getState().setDockCollapsed(false);
}

function ModCardDetailsItem({ modId }: { modId: string }) {
  const showDetails = useLibrarySidebarStore((s) => s.showDetails);

  return (
    <Menu.Item
      icon={<InfoIcon className="size-4" weight="bold" />}
      onClick={() => {
        showDetails(modId);
        revealDock();
      }}
    >
      {m.library_mod_details_action()}
    </Menu.Item>
  );
}

/**
 * Open this mod into the documents panel, on its readme.
 *
 * Always offered. Whether a mod has a readme is unknown until its archive
 * opens, so an item that hid without one would cost either a persisted flag
 * with a backfill or an archive open per card.
 */
function ModCardReadmeItem({ modId }: { modId: string }) {
  const showReadme = useLibrarySidebarStore((s) => s.showReadme);

  return (
    <Menu.Item
      icon={<BookOpenTextIcon className="size-4" weight="bold" />}
      onClick={() => {
        showReadme(modId);
        revealDock();
      }}
    >
      {m.library_mod_readme_action()}
    </Menu.Item>
  );
}

/**
 * Check Health, or what the check is still waiting for.
 *
 * Per "What Check Health says while it waits" in docs/ux/MOD_HEALTH.md.
 */
export function ModCardHealthItem({ modId }: { modId: string }) {
  const readiness = useHealthCheckReadiness();
  const checkModHealth = useCheckModHealth();
  const showMod = useModHealthDrawerStore((s) => s.showMod);
  const toast = useToast();

  if (readiness === "syncing") {
    return (
      <Menu.Item icon={<SpinnerGapIcon className="size-4 animate-spin" weight="bold" />} disabled>
        {m.library_mod_hashtables_syncing_label()}
      </Menu.Item>
    );
  }

  if (readiness === "unsynced") {
    return (
      <Menu.Item icon={<HeartbeatIcon className="size-4" weight="bold" />} disabled>
        {m.library_mod_hashtables_unsynced_label()}
      </Menu.Item>
    );
  }

  // The badge only appears when something is wrong, so a clean check needs
  // its own answer here or the click looks ignored.
  function handleCheckHealth() {
    checkModHealth.mutate(modId, {
      onSuccess: (verdict) => {
        const total =
          verdict.counts.fatals +
          verdict.counts.errors +
          verdict.counts.warnings +
          verdict.counts.infos;
        /* A healthy mod can still hold informative findings, and a count in a
           toast is the one answer that names them without showing them. The
           panel is where a finding is read, so the press opens it there. */
        if (verdict.health === "healthy") {
          if (total === 0) {
            toast.success(m.library_mod_health_clean_title());
            return;
          }
          showMod(modId);
          return;
        }
        if (verdict.health === "repairable") {
          toast.info(
            `${verdict.fixable} repairable finding${verdict.fixable === 1 ? "" : "s"} found`,
          );
          return;
        }
        toast.warning(`${total} finding${total === 1 ? "" : "s"}, none repairable`);
      },
    });
  }

  return (
    <Menu.Item
      icon={<HeartbeatIcon className="size-4" weight="bold" />}
      disabled={checkModHealth.isPending}
      onClick={handleCheckHealth}
    >
      {m.library_mod_health_action()}
    </Menu.Item>
  );
}

interface DeclaredPill {
  label: string;
  tone: CategoryTone;
  key: string;
  icon?: ReactNode;
  /** What the pill reads as, for one whose icon carries half the meaning. */
  ariaLabel?: string;
}

/** The tag whose subject sits in a list of its own, so the two can be folded. */
const CHAMPION_SKIN_TAG = "champion-skin";

/**
 * Folds `champion-skin` and its champions into one pill each, a helmet + `Kayn`.
 *
 * A card that says both says the same thing twice, and the pair cost two of the
 * three pills a card has room for. Folded only within a confidence tier: a
 * declared tag beside a guessed champion is not a fact anyone stated, and the
 * dashed outline that marks the guess would be lost in the join.
 *
 * `primary` narrows a derived set to the champion the mod puts the most into.
 * A skin that spills a few chunks into two other champions is still one skin,
 * and three pills for it crowd out everything else the card has to say.
 */
function foldChampionSkin(tags: string[], champions: string[], primary?: string | null) {
  if (champions.length === 0 || !tags.includes(CHAMPION_SKIN_TAG)) {
    return { tags, champions, skins: [] as string[] };
  }

  return {
    tags: tags.filter((tag) => tag !== CHAMPION_SKIN_TAG),
    champions: [] as string[],
    skins: primary ? [primary] : champions,
  };
}

interface AutoPillItem {
  label: string;
  tone: AutoPillTone;
  key: string;
  icon?: ReactNode;
  ariaLabel?: string;
}

export function ModPills({
  mod,
  max,
  always = false,
  className,
}: {
  mod: InstalledMod;
  max: number;
  /** Draw the pills whatever the card display's Tags setting says, as a table column does. */
  always?: boolean;
  className?: string;
}) {
  const eff = useModEffectiveCategories(mod);
  const { data: settings } = useSettings();
  const roster = useChampionRoster();

  const said = foldChampionSkin(mod.tags, mod.champions);
  const guessed = foldChampionSkin(
    eff.derivedTags,
    eff.derivedChampions,
    eff.primaryDerivedChampion,
  );

  const championPill = (value: string, key: string) => ({
    label: roster.labelOf(value),
    tone: "champion" as const,
    key,
    icon: <ChampionPortrait champion={roster.find(value)} className="mr-0.5 size-3" />,
  });
  const skinPill = (value: string, key: string) => ({
    ...championPill(value, key),
    ariaLabel: m.library_mod_champion_skin_label({ champion: roster.labelOf(value) }),
  });

  // The folded pill leads: it names the mod's subject, where a tag only sorts it.
  const declared: DeclaredPill[] = [
    ...said.skins.map((c) => skinPill(c, `skin:${c}`)),
    ...said.tags.map((t) => ({ label: getTagLabel(t), tone: "tag" as const, key: `tag:${t}` })),
    ...said.champions.map((c) => championPill(c, `champ:${c}`)),
  ];
  const auto: AutoPillItem[] = [
    ...guessed.skins.map((c) => skinPill(c, `auto-skin:${c}`)),
    ...guessed.tags.map((t) => ({
      label: getTagLabel(t),
      tone: "tag" as const,
      key: `auto-tag:${t}`,
    })),
    ...guessed.champions.map((c) => championPill(c, `auto-champ:${c}`)),
    ...eff.derivedMaps.map((m) => ({
      label: getMapLabel(m),
      tone: "map" as const,
      key: `auto-map:${m}`,
    })),
  ];

  const total = declared.length + auto.length;
  if (total === 0) return null;
  if (!always && settings && !settings.showModTags) return null;

  // Declared pills get first claim on the budget so they never collapse before
  // the lower-confidence auto pills.
  const declaredVisible = declared.slice(0, max);
  const autoVisible = auto.slice(0, Math.max(0, max - declaredVisible.length));
  const overflow = total - declaredVisible.length - autoVisible.length;

  return (
    <div className={twMerge("flex flex-wrap items-center gap-1", className)}>
      {declaredVisible.map((pill) => (
        <Chip key={pill.key} tone={pill.tone} aria-label={pill.ariaLabel}>
          {pill.icon}
          {pill.label}
        </Chip>
      ))}
      {autoVisible.length > 0 && (
        <Tooltip content={m.library_mod_auto_categories_hint()}>
          <span className="inline-flex flex-wrap items-center gap-1">
            {autoVisible.map((pill) => (
              <AutoPill
                key={pill.key}
                label={pill.label}
                tone={pill.tone}
                icon={pill.icon}
                ariaLabel={pill.ariaLabel}
              />
            ))}
          </span>
        </Tooltip>
      )}
      {overflow > 0 && (
        <span className="text-fine text-surface-500">
          {m.library_mod_overflow_label({ count: overflow })}
        </span>
      )}
    </div>
  );
}

export function SkinhackInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Shell
      open={open}
      onClose={() => onOpenChange(false)}
      title={m.library_mod_skinhack_title()}
      size="sm"
    >
      <Dialog.Body>
        <p className="text-sm leading-relaxed text-surface-300">
          {m.library_mod_skinhack_description()}
        </p>
        <p className="text-sm leading-relaxed text-surface-300">
          {m.library_mod_skinhack_policy_hint()}
        </p>
        <p className="text-sm leading-relaxed text-surface-400">
          {m.library_mod_skinhack_report_hint()}
        </p>
      </Dialog.Body>
    </Dialog.Shell>
  );
}
