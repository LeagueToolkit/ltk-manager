import {
  Copy,
  Edit3,
  EllipsisVertical,
  FolderOpen,
  FolderX,
  Info,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import {
  AutoPill,
  type AutoPillTone,
  Dialog,
  IconButton,
  Menu,
  Switch,
  Tooltip,
} from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { useModEffectiveCategories } from "@/modules/library/api";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";

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

export function ModCardMenu({ view }: { view: ModCardView }) {
  const { mod, interactionsDisabled, isFlagged, isInUserFolder } = view;

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={interactionsDisabled}
        render={
          <IconButton
            icon={<EllipsisVertical className="h-4 w-4" />}
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
                icon={<ShieldAlert className="h-4 w-4" />}
                onClick={() => view.setSkinhackInfoOpen(true)}
              >
                What is a skinhack?
              </Menu.Item>
            )}
            {!isFlagged && (
              <Menu.Item
                icon={<Info className="h-4 w-4" />}
                onClick={() => view.onViewDetails?.(mod)}
              >
                View Details
              </Menu.Item>
            )}
            {!isFlagged && (
              <Menu.Item
                icon={<Edit3 className="h-4 w-4" />}
                onClick={() => view.onEditMetadata?.(mod)}
              >
                Edit Metadata
              </Menu.Item>
            )}
            <Menu.Item icon={<FolderOpen className="h-4 w-4" />} onClick={view.onOpenLocation}>
              Open Location
            </Menu.Item>
            <Menu.Item icon={<Copy className="h-4 w-4" />} onClick={view.onCopyId}>
              Copy ID
            </Menu.Item>
            {isInUserFolder && (
              <Menu.Item icon={<FolderX className="h-4 w-4" />} onClick={view.onRemoveFromFolder}>
                Remove from folder
              </Menu.Item>
            )}
            <Menu.Separator />
            <Menu.Item
              icon={<Trash2 className="h-4 w-4" />}
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
          className={`rounded px-1.5 py-0.5 text-[10px] leading-tight ${DECLARED_PILL_CLASSES[pill.tone]}`}
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
      {overflow > 0 && <span className="text-[10px] text-surface-500">+{overflow}</span>}
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
