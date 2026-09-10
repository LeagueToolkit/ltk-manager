import { ArrowCounterClockwiseIcon, CopyIcon, GearSixIcon, LinkIcon } from "@phosphor-icons/react";
import { type MouseEvent, type ReactNode, useState } from "react";

import { Menu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { twMerge } from "@/utils";

import { type IndexedSettingKey, settingEntry, settingLink } from "../settingsIndex";
import { useSettingDefault } from "./SettingScope";

/** Positions the menu where the pointer was, for a right-click on the row. */
interface PointerAnchor {
  getBoundingClientRect: () => DOMRect;
}

interface SettingGutterProps {
  setting?: IndexedSettingKey;
  className?: string;
  children: ReactNode;
}

/**
 * The gear and the modified bar in the column left of one row.
 *
 * The gear belongs to every row the index carries, because an id is worth
 * copying whether or not the value behind it can be put back. A row with no key
 * is an action, and it draws neither.
 */
export function SettingGutter({ setting, className, children }: SettingGutterProps) {
  const { resettable, changed, label, reset } = useSettingDefault(setting);
  const copy = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const [pointer, setPointer] = useState<PointerAnchor | null>(null);

  const entry = setting === undefined ? undefined : settingEntry(setting);

  function openAtPointer(event: MouseEvent) {
    event.preventDefault();
    const { clientX, clientY } = event;
    setPointer({ getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0) });
    setOpen(true);
  }

  if (!entry) {
    return <div className={twMerge("relative", className)}>{children}</div>;
  }

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <div
        data-ui="SettingGutter"
        className={twMerge("group/setting relative", className)}
        onContextMenu={openAtPointer}
      >
        {changed && (
          <span
            aria-hidden
            data-ui="SettingGutter:modified"
            /* DS-SETTING-GUTTER. */
            className="absolute inset-y-0 -left-2 w-0.5 rounded-full bg-accent-500/50"
          />
        )}

        <Menu.Trigger
          /* Untabbed: 45 rows would otherwise double the page's tab order with a
             menu nobody opened. The keyboard path is a right-click on the row. */
          tabIndex={-1}
          aria-label={`Actions for ${entry.title}`}
          onClick={() => setPointer(null)}
          className={twMerge(
            "absolute top-0.5 -left-7 flex h-5 w-5 items-center justify-center rounded-md",
            "text-surface-400 opacity-0 transition-opacity hover:bg-surface-veil hover:text-surface-200",
            "group-focus-within/setting:opacity-100 group-hover/setting:opacity-100",
            "data-[popup-open]:opacity-100",
          )}
        >
          <GearSixIcon className="h-3.5 w-3.5" />
        </Menu.Trigger>

        {children}
      </div>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" anchor={pointer ?? undefined}>
          <Menu.Popup>
            {resettable && (
              <Menu.Item
                disabled={!changed}
                icon={<ArrowCounterClockwiseIcon className="h-4 w-4" />}
                onClick={reset}
              >
                Reset setting
              </Menu.Item>
            )}
            {label && (
              <div className="px-2 pt-1 pb-0.5 text-xs text-surface-400 select-none">
                Default: {label}
              </div>
            )}
            {resettable && <Menu.Separator />}
            <Menu.Item
              icon={<CopyIcon className="h-4 w-4" />}
              onClick={() => void copy(entry.id, "setting ID")}
            >
              Copy setting ID
            </Menu.Item>
            <Menu.Item
              icon={<LinkIcon className="h-4 w-4" />}
              onClick={() => void copy(settingLink(entry.id), "link to setting")}
            >
              Copy link to setting
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
