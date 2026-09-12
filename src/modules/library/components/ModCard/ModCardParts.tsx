import {
  ArchiveIcon,
  BookOpenTextIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  HeartbeatIcon,
  InfoIcon,
  PackageIcon,
  ShieldWarningIcon,
  SpinnerGapIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";

import {
  AutoPill,
  type AutoPillTone,
  ChampionIcon,
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
import {
  useCheckModHealth,
  useHealthCheckReadiness,
  useModEffectiveCategories,
} from "@/modules/library/api";
import { useLibrarySidebarStore } from "@/modules/library/state";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { useSettings } from "@/modules/settings";
import { useModHealthDrawerStore } from "@/stores";
import { twMerge } from "@/utils";

import { SelectionMenuItems } from "../SelectionMenuItems";
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
          className={twMerge("absolute inset-0 h-full w-full object-cover", styles.image)}
        />
      )}
      {/* A mod with no art is a letter on a flat panel, and that is most of a
          library. Colouring the letter puts the state in the middle of the
          card, where art of its own would have been carrying it. */}
      {!thumbnailUrl && (
        <div className="flex h-full w-full items-center justify-center">
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

  return (
    <Switch
      disabled={view.disabled}
      checked={mod.enabled}
      onCheckedChange={(checked) => view.onToggle(mod.id, checked)}
      aria-label={`${mod.enabled ? "Disable" : "Enable"} ${mod.displayName}`}
    />
  );
}

/**
 * Where the mod's content is read from, as a choice between the two rather than
 * a button naming the one it is not.
 *
 * Per "Storage" in CONTEXT.md.
 */
function ModCardStorageSubmenu({ view }: { view: ModCardView }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        icon={<PackageIcon className="h-4 w-4" weight="bold" />}
        disabled={view.storageChangePending}
      >
        {m.library_mod_storage_label()}
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.SubmenuPositioner>
          <Menu.Popup data-ui="ModCardMenu:storage">
            <Menu.RadioGroup
              value={view.mod.storage}
              onValueChange={(storage) => view.onSetStorage(storage as ModStorage)}
            >
              <Menu.RadioItem
                value="project"
                icon={<FolderIcon className="h-4 w-4" weight="bold" />}
                closeOnClick
              >
                {m.library_mod_storage_project_label()}
              </Menu.RadioItem>
              <Menu.RadioItem
                value="archive"
                icon={<ArchiveIcon className="h-4 w-4" weight="bold" />}
                closeOnClick
              >
                {m.library_mod_storage_archive_label()}
              </Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.SubmenuPositioner>
      </Menu.Portal>
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
export function ModCardMenu({ view, className }: { view: ModCardView; className?: string }) {
  const { menuDisabled } = view;

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={menuDisabled}
        render={
          <IconButton
            icon={<DotsThreeVerticalIcon className="h-4 w-4" weight="bold" />}
            variant="ghost"
            size="sm"
            compact
            aria-label={`More options for ${view.mod.displayName}`}
            disabled={menuDisabled}
            className={className}
          />
        }
      />
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup>
            <ModCardMenuItems view={view} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The card's menu on its right click, over the whole card rather than a target.
 *
 * A press inside the selection opens what the selection carries, and a press
 * outside it collapses the pick onto this card and opens the card's own. Per
 * "What a right click opens" in `docs/ux/LIBRARY.md`.
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
  if (view.menuDisabled) return cloneElement(card, undefined, children);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={card}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            {view.menuScope === "selection" && <SelectionMenuItems />}
            {view.menuScope === "card" && <ModCardMenuItems view={view} />}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
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
  const { mod, isFlagged, isInUserFolder, canChangeStorage } = view;

  return (
    <>
      {isFlagged && (
        <Menu.Item
          icon={<ShieldWarningIcon className="h-4 w-4" weight="bold" />}
          onClick={() => view.setSkinhackInfoOpen(true)}
        >
          {m.library_mod_skinhack_action()}
        </Menu.Item>
      )}
      {!isFlagged && <ModCardDetailsItem modId={mod.id} />}
      <ModCardReadmeItem modId={mod.id} />
      <Menu.Item
        icon={<FolderOpenIcon className="h-4 w-4" weight="bold" />}
        onClick={view.onOpenLocation}
      >
        {m.library_mod_open_location_action()}
      </Menu.Item>
      {canChangeStorage && <ModCardStorageSubmenu view={view} />}
      <ModCardHealthItem modId={mod.id} />
      <Menu.Item icon={<CopyIcon className="h-4 w-4" weight="bold" />} onClick={view.onCopyId}>
        {m.library_mod_copy_id_action()}
      </Menu.Item>
      {isInUserFolder && (
        <Menu.Item
          icon={<FolderMinusIcon className="h-4 w-4" weight="bold" />}
          onClick={view.onRemoveFromFolder}
        >
          {m.library_mod_remove_from_folder_action()}
        </Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item
        icon={<TrashIcon className="h-4 w-4" weight="bold" />}
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
function ModCardDetailsItem({ modId }: { modId: string }) {
  const showDetails = useLibrarySidebarStore((s) => s.showDetails);

  return (
    <Menu.Item
      icon={<InfoIcon className="h-4 w-4" weight="bold" />}
      onClick={() => showDetails(modId)}
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
      icon={<BookOpenTextIcon className="h-4 w-4" weight="bold" />}
      onClick={() => showReadme(modId)}
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
      <Menu.Item icon={<SpinnerGapIcon className="h-4 w-4 animate-spin" weight="bold" />} disabled>
        {m.library_mod_hashtables_syncing_label()}
      </Menu.Item>
    );
  }

  if (readiness === "unsynced") {
    return (
      <Menu.Item icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />} disabled>
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
            toast.success("No problems found");
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
      icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />}
      disabled={checkModHealth.isPending}
      onClick={handleCheckHealth}
    >
      {m.library_mod_health_action()}
    </Menu.Item>
  );
}

/* Same categorical hues as AutoPill, minus the dashed outline that marks a
   pill as auto-detected. */
const DECLARED_PILL_CLASSES = {
  /* Neutral, because a plain tag names no kind: DS-KIND-HUE. The accent is what
     an enabled card's edge is drawn in, and a pill wearing it on every card was
     the loudest thing competing with that. */
  tag: "bg-surface-700 text-surface-300",
  champion: "bg-cat-champion/15 text-cat-champion-text",
} as const;

interface DeclaredPill {
  label: string;
  tone: keyof typeof DECLARED_PILL_CLASSES;
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
  className,
}: {
  mod: InstalledMod;
  max: number;
  className?: string;
}) {
  const eff = useModEffectiveCategories(mod);
  const { data: settings } = useSettings();

  const said = foldChampionSkin(mod.tags, mod.champions);
  const guessed = foldChampionSkin(
    eff.derivedTags,
    eff.derivedChampions,
    eff.primaryDerivedChampion,
  );

  /* The helmet says skin and the label says whose, so the pill spends its width
     on the one thing a `Champion Skin` beside it could not tell you. */
  const skinPill = (champion: string, key: string) => ({
    label: champion,
    tone: "champion" as const,
    key,
    icon: <ChampionIcon className="h-3 w-3 shrink-0" />,
    ariaLabel: `${champion} skin`,
  });

  // The folded pill leads: it names the mod's subject, where a tag only sorts it.
  const declared: DeclaredPill[] = [
    ...said.skins.map((c) => skinPill(c, `skin:${c}`)),
    ...said.tags.map((t) => ({ label: getTagLabel(t), tone: "tag" as const, key: `tag:${t}` })),
    ...said.champions.map((c) => ({ label: c, tone: "champion" as const, key: `champ:${c}` })),
  ];
  const auto: AutoPillItem[] = [
    ...guessed.skins.map((c) => skinPill(c, `auto-skin:${c}`)),
    ...guessed.tags.map((t) => ({
      label: getTagLabel(t),
      tone: "tag" as const,
      key: `auto-tag:${t}`,
    })),
    ...guessed.champions.map((c) => ({
      label: c,
      tone: "champion" as const,
      key: `auto-champ:${c}`,
    })),
    ...eff.derivedMaps.map((m) => ({
      label: getMapLabel(m),
      tone: "map" as const,
      key: `auto-map:${m}`,
    })),
  ];

  const total = declared.length + auto.length;
  if (total === 0) return null;
  if (settings && !settings.showModTags) return null;

  // Declared pills get first claim on the budget so they never collapse before
  // the lower-confidence auto pills.
  const declaredVisible = declared.slice(0, max);
  const autoVisible = auto.slice(0, Math.max(0, max - declaredVisible.length));
  const overflow = total - declaredVisible.length - autoVisible.length;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {declaredVisible.map((pill) => (
        <span
          key={pill.key}
          aria-label={pill.ariaLabel}
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.625rem] leading-tight ${DECLARED_PILL_CLASSES[pill.tone]}`}
        >
          {pill.icon}
          {pill.label}
        </span>
      ))}
      {autoVisible.length > 0 && (
        <Tooltip content="Auto-detected from this mod's contents">
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
      {overflow > 0 && <span className="text-[0.625rem] text-surface-500">+{overflow}</span>}
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
      title="What is a skinhack?"
      size="sm"
    >
      <Dialog.Body>
        <p className="text-sm leading-relaxed text-surface-300">
          A skinhack is a mod that grants access to paid League of Legends skins.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-surface-300">
          Using skinhacks violates the distribution policy and can put your account at risk. LTK
          Manager blocks these mods to protect both users and the modding community.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-surface-400">
          If you believe this mod was flagged incorrectly, open an issue on the GitHub repository
          page with the relevant info and we will investigate.
        </p>
      </Dialog.Body>
    </Dialog.Shell>
  );
}
