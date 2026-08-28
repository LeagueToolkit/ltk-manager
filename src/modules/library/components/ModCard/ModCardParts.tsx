import {
  ArchiveIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  HeartbeatIcon,
  InfoIcon,
  PackageIcon,
  PencilSimpleIcon,
  ShieldWarningIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import {
  AutoPill,
  type AutoPillTone,
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

const THUMBNAIL_VARIANTS: Record<CardVariant, { container: string; placeholder: string }> = {
  grid: {
    /* No radius of its own, the card clips it. */
    container:
      "relative aspect-video overflow-hidden bg-linear-to-br from-surface-700 to-surface-800",
    placeholder: "text-4xl font-bold text-surface-400",
  },
  list: {
    container:
      "relative h-12 w-[5.25rem] shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800",
    placeholder: "text-lg font-bold text-surface-500",
  },
};

export function ModCardThumbnail({
  variant,
  thumbnailUrl,
  displayName,
}: {
  variant: CardVariant;
  thumbnailUrl?: string;
  displayName: string;
}) {
  const styles = THUMBNAIL_VARIANTS[variant];
  return (
    <div className={styles.container}>
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {!thumbnailUrl && (
        <div className="flex h-full w-full items-center justify-center">
          <span className={styles.placeholder}>{displayName.charAt(0).toUpperCase()}</span>
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

export function ModCardMenu({ view }: { view: ModCardView }) {
  const { mod, interactionsDisabled, isFlagged, isInUserFolder, canChangeStorage } = view;
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

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={interactionsDisabled}
        render={
          <IconButton
            icon={<DotsThreeVerticalIcon className="h-4 w-4" weight="bold" />}
            variant="ghost"
            size="md"
            disabled={interactionsDisabled}
          />
        }
      />
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup>
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
              icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />}
              disabled={checkModHealth.isPending}
              onClick={handleCheckHealth}
            >
              Check Health
            </Menu.Item>
            <Menu.Item
              icon={<CopyIcon className="h-4 w-4" weight="bold" />}
              onClick={view.onCopyId}
            >
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
              disabled={interactionsDisabled}
              onClick={view.onUninstall}
            >
              Uninstall
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* Same categorical hues as AutoPill, minus the dashed outline that marks a
   pill as auto-detected. */
const DECLARED_PILL_CLASSES = {
  tag: "bg-accent-500/15 text-accent-400",
  champion: "bg-cat-champion/15 text-cat-champion-text",
} as const;

interface DeclaredPill {
  label: string;
  tone: keyof typeof DECLARED_PILL_CLASSES;
  key: string;
}

interface AutoPillItem {
  label: string;
  tone: AutoPillTone;
  key: string;
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

  const declared: DeclaredPill[] = [
    ...mod.tags.map((t) => ({ label: getTagLabel(t), tone: "tag" as const, key: `tag:${t}` })),
    ...mod.champions.map((c) => ({ label: c, tone: "champion" as const, key: `champ:${c}` })),
  ];
  const auto: AutoPillItem[] = [
    ...eff.derivedTags.map((t) => ({
      label: getTagLabel(t),
      tone: "tag" as const,
      key: `auto-tag:${t}`,
    })),
    ...eff.derivedChampions.map((c) => ({
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
          className={`rounded px-1.5 py-0.5 text-[0.625rem] leading-tight ${DECLARED_PILL_CLASSES[pill.tone]}`}
        >
          {pill.label}
        </span>
      ))}
      {autoVisible.length > 0 && (
        <Tooltip content="Auto-detected from this mod's contents">
          <span className="inline-flex flex-wrap items-center gap-1">
            {autoVisible.map((pill) => (
              <AutoPill key={pill.key} label={pill.label} tone={pill.tone} />
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
