import {
  ArchiveIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  HardDrivesIcon,
  HeartbeatIcon,
  InfoIcon,
  PackageIcon,
  PencilSimpleIcon,
  ShieldWarningIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import {
  AutoPill,
  type AutoPillTone,
  Button,
  ChampionIcon,
  Code,
  ContextMenu,
  Dialog,
  IconButton,
  Menu,
  Switch,
  Tooltip,
  useToast,
} from "@/components";
import type { InstalledMod, ModStorage } from "@/lib/tauri";
import { useCheckModHealth, useModEffectiveCategories } from "@/modules/library/api";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { useSettings } from "@/modules/settings";

import type { ModCardView } from "./useModCardController";

type CardVariant = "grid" | "list";

const THUMBNAIL_VARIANTS: Record<
  CardVariant,
  { container: string; placeholder: string; placeholderOff: string; image: string }
> = {
  grid: {
    /* Its own corner, one border-width inside the card's. Left to the card's
       clip it steps against the border instead of following it, because the
       two curves are drawn by different passes. */
    container:
      "relative aspect-video overflow-hidden rounded-t-[max(0px,calc(var(--radius-xl)-2px))] bg-linear-to-br from-surface-700 to-surface-800",
    placeholder: "text-4xl font-bold",
    placeholderOff: "text-surface-400",
    /* The card answers a hover here rather than by scaling itself. Any scale
       over the body resamples the name and the version under it, and text a
       hundredth larger is text redrawn slightly wrong. */
    image: "transition-[scale] duration-200 ease-out group-hover:scale-[1.04]",
  },
  list: {
    container:
      "relative h-12 w-[5.25rem] shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800",
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
    <div className={styles.container}>
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
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
      disabled={view.interactionsDisabled}
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
        Storage
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
                Project
              </Menu.RadioItem>
              <Menu.RadioItem
                value="archive"
                icon={<ArchiveIcon className="h-4 w-4" weight="bold" />}
                closeOnClick
              >
                Archive
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
            <ModCardMenuItems view={view} />
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
  const { mod, faultReason, isFlagged, isInUserFolder, canChangeStorage } = view;
  const checkModHealth = useCheckModHealth();
  const toast = useToast();

  // The badge only appears when something is wrong, so a clean check needs
  // its own answer here or the click looks ignored.
  function handleCheckHealth() {
    checkModHealth.mutate(mod.id, {
      onSuccess: (verdict) => {
        if (verdict.health === "healthy") {
          toast.success("No problems found");
          return;
        }
        const total =
          verdict.counts.fatals +
          verdict.counts.errors +
          verdict.counts.warnings +
          verdict.counts.infos;
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

  /* A quarantined mod has no directory of its own left, so everything that
     addresses one is gone and what remains is the two things that still mean
     something: look at what was parked, or drop the entry. */
  if (faultReason !== null) {
    return (
      <>
        <Menu.Item
          icon={<WarningIcon className="h-4 w-4" weight="bold" />}
          onClick={() => view.setFaultInfoOpen(true)}
        >
          Why did this fail?
        </Menu.Item>
        <Menu.Item
          icon={<FolderOpenIcon className="h-4 w-4" weight="bold" />}
          onClick={view.onOpenLocation}
        >
          Reveal quarantined files
        </Menu.Item>
        <Menu.Item icon={<CopyIcon className="h-4 w-4" weight="bold" />} onClick={view.onCopyId}>
          Copy ID
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item
          icon={<TrashIcon className="h-4 w-4" weight="bold" />}
          variant="danger"
          onClick={view.onUninstall}
        >
          Remove from library
        </Menu.Item>
      </>
    );
  }

  return (
    <>
      {isFlagged && (
        <Menu.Item
          icon={<ShieldWarningIcon className="h-4 w-4" weight="bold" />}
          onClick={() => view.setSkinhackInfoOpen(true)}
        >
          What is a skinhack?
        </Menu.Item>
      )}
      {!isFlagged && (
        <Menu.Item
          icon={<InfoIcon className="h-4 w-4" weight="bold" />}
          onClick={() => view.onViewDetails?.(mod)}
        >
          View Details
        </Menu.Item>
      )}
      {!isFlagged && (
        <Menu.Item
          icon={<PencilSimpleIcon className="h-4 w-4" weight="bold" />}
          onClick={() => view.onEditMetadata?.(mod)}
        >
          Edit Metadata
        </Menu.Item>
      )}
      <Menu.Item
        icon={<FolderOpenIcon className="h-4 w-4" weight="bold" />}
        onClick={view.onOpenLocation}
      >
        Open Location
      </Menu.Item>
      {canChangeStorage && <ModCardStorageSubmenu view={view} />}
      <Menu.Item
        icon={<HardDrivesIcon className="h-4 w-4" weight="bold" />}
        onClick={() => view.setWadFootprintOpen(true)}
      >
        WAD Footprint
      </Menu.Item>
      <Menu.Item
        icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />}
        disabled={checkModHealth.isPending}
        onClick={handleCheckHealth}
      >
        Check Health
      </Menu.Item>
      <Menu.Item icon={<CopyIcon className="h-4 w-4" weight="bold" />} onClick={view.onCopyId}>
        Copy ID
      </Menu.Item>
      {isInUserFolder && (
        <Menu.Item
          icon={<FolderMinusIcon className="h-4 w-4" weight="bold" />}
          onClick={view.onRemoveFromFolder}
        >
          Remove from folder
        </Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item
        icon={<TrashIcon className="h-4 w-4" weight="bold" />}
        variant="danger"
        onClick={view.onUninstall}
      >
        Uninstall
      </Menu.Item>
    </>
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

/**
 * What went wrong with a quarantined mod, and the two things left to do about it.
 *
 * The failure used to live only in a tooltip on the card's warning mark, which
 * is the one place a reader can neither select it for a bug report nor act on
 * it. Per "Where copying is routine, give an explicit Copy action" in
 * src/CLAUDE.md, the message is a `Code` chip rather than prose.
 */
export function ModFaultDialog({
  view,
  open,
  onOpenChange,
}: {
  view: ModCardView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mod, faultReason } = view;
  if (faultReason === null) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header>
            <Dialog.Title>{mod.displayName} could not be converted</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-sm leading-relaxed text-surface-300">
              Its files were moved aside rather than deleted, and it stays in the library so it is
              not lost. It cannot be switched on until it is imported again.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-surface-400">What went wrong:</p>
            <Code className="mt-1 block">{faultReason}</Code>
          </Dialog.Body>
          <Dialog.Footer>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                view.onUninstall();
              }}
            >
              <TrashIcon className="h-4 w-4" weight="bold" />
              Remove from library
            </Button>
            <Button variant="filled" size="sm" onClick={view.onOpenLocation}>
              <FolderOpenIcon className="h-4 w-4" weight="bold" />
              Reveal files
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>What is a skinhack?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-sm leading-relaxed text-surface-300">
              A skinhack is a mod that grants access to paid League of Legends skins.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-surface-300">
              Using skinhacks violates the distribution policy and can put your account at risk. LTK
              Manager blocks these mods to protect both users and the modding community.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-surface-400">
              If you believe this mod was flagged incorrectly, open an issue on the GitHub
              repository page with the relevant info and we will investigate.
            </p>
          </Dialog.Body>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
