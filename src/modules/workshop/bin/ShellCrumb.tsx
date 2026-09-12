import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Menu } from "@/components";
import { m } from "@/i18n";

import { nameOf } from "./emitterCards";
import { useEmitters } from "./emitterChoice";
import { type EmitterGroup, GROUP_TITLE } from "./emitterGroups";
import type { EmitterCardData } from "./emitterTypes";

/**
 * System, emitter, a child lane's emitter and group, each a segment aiming the inspector.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md.
 */
export function ShellCrumb({ system }: { system: string }) {
  const { target, aim, card, root, group, child, chooseCard } = useEmitters();

  return (
    <nav
      data-ui="ShellCrumb"
      aria-label={m.workshop_bin_shell_crumb_label()}
      className="flex min-w-0 items-center gap-1 px-1 text-meta"
    >
      <CrumbSegment on={target === "system"} onClick={() => aim("system")}>
        {system}
      </CrumbSegment>
      {root !== undefined && (
        <>
          <CrumbCaret />
          <CrumbSegment
            on={child === null && target === "emitter"}
            onClick={() => (child === null ? aim("emitter") : chooseCard(root.key))}
          >
            <span className="min-w-0 truncate">{nameOf(root)}</span>
            <span className="shrink-0 text-surface-500">[{root.index}]</span>
          </CrumbSegment>
        </>
      )}
      {child !== null && (
        <>
          <CrumbCaret />
          <CrumbSegment on={target === "emitter"} onClick={() => aim("emitter")}>
            <span className="min-w-0 truncate">{child.emitter.name}</span>
            <span className="shrink-0 text-surface-500">[{child.emitter.listIndex}]</span>
          </CrumbSegment>
        </>
      )}
      {card !== undefined && group !== null && (
        <>
          <CrumbCaret />
          <GroupSegment card={card} group={group} />
        </>
      )}
    </nav>
  );
}

function CrumbCaret() {
  return <CaretRightIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-500" />;
}

function CrumbSegment({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      /* DS-RADIUS, DS-VEIL */
      className={twMerge(
        "flex min-w-0 cursor-pointer items-center gap-1 truncate rounded-sm px-1 py-0.5",
        on ? "bg-accent-500/15 text-accent-300" : "text-surface-400 hover:bg-surface-veil",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The last segment, which is a menu of the groups the emitter sets.
 *
 * It names the group last picked and never the one on screen, so its own label holds
 * still under the pointer. "The crumb holds still and the header moves" in
 * docs/ux/BIN_EDITOR.md.
 */
function GroupSegment({ card, group }: { card: EmitterCardData; group: EmitterGroup }) {
  const { chooseGroup } = useEmitters();

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <button
            type="button"
            /* DS-RADIUS, DS-VEIL */
            className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-surface-400 hover:bg-surface-veil"
          >
            {GROUP_TITLE[group]()}
            <CaretDownIcon weight="bold" className="h-3 w-3 shrink-0" />
          </button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={4}>
          <Menu.Popup className="w-40">
            {card.groups.map((each) => (
              <Menu.Item
                key={each.group}
                onClick={() => chooseGroup({ key: card.key, group: each.group })}
              >
                {GROUP_TITLE[each.group]()}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
