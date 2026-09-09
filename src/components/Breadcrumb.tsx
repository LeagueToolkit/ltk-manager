import { CaretRightIcon, DotsThreeIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { Menu } from "./Menu";

export interface BreadcrumbItem {
  /** What identifies the place, and what a click hands back. */
  id: string;
  label: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (id: string) => void;
  /** Names the trail for a screen reader, since the crumbs alone do not say what they are. */
  "aria-label": string;
  /**
   * Crumbs drawn in full before the leading ones fold into one `…`.
   *
   * The row never wraps to a second line, so a trail longer than this keeps its
   * last few places and puts the rest behind a menu.
   */
  maxVisible?: number;
  /**
   * What the caret after a crumb opens: where else the trail could go from there.
   *
   * The caret is the separator, so a trail without this draws a plain one.
   */
  renderSiblings?: (item: BreadcrumbItem) => ReactNode;
  className?: string;
}

const DEFAULT_MAX_VISIBLE = 4;

const crumbClass =
  "max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-meta text-surface-300 outline-none " +
  "hover:bg-surface-veil hover:text-surface-100 focus-visible:ring-1 focus-visible:ring-accent-500";

const caretClass = "mx-0.5 h-3 w-3 shrink-0 text-surface-500";

/**
 * The trail to a place, and a way back to any part of it.
 *
 * The last crumb is where the reader is, so it draws as the current page rather
 * than as a way to somewhere. Everything before it navigates, and the caret
 * between two crumbs is where the trail branches.
 */
export function Breadcrumb({
  items,
  onNavigate,
  "aria-label": ariaLabel,
  maxVisible = DEFAULT_MAX_VISIBLE,
  renderSiblings,
  className,
}: BreadcrumbProps) {
  const folded = items.length > maxVisible ? items.slice(0, items.length - maxVisible + 1) : [];
  const shown = folded.length > 0 ? items.slice(folded.length) : items;

  return (
    <nav
      data-ui="Breadcrumb"
      aria-label={ariaLabel}
      className={twMerge("flex min-w-0 items-center select-none", className)}
    >
      <ol className="flex min-w-0 items-center">
        {folded.length > 0 && (
          <li className="flex shrink-0 items-center">
            <Menu.Root>
              <Menu.Trigger
                className={crumbClass}
                aria-label={m.common_breadcrumb_overflow_action()}
              >
                <DotsThreeIcon weight="bold" className="h-4 w-4" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                  <Menu.Popup className="w-56">
                    {folded.map((item) => (
                      <Menu.Item key={item.id} onClick={() => onNavigate(item.id)}>
                        {item.label}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <CaretRightIcon weight="bold" aria-hidden className={caretClass} />
          </li>
        )}

        {shown.map((item, index) => {
          const last = index === shown.length - 1;

          return (
            <li key={item.id} className="flex min-w-0 items-center">
              <button
                type="button"
                data-crumb={item.id}
                className={twMerge(crumbClass, last && "font-medium text-surface-100")}
                aria-current={last ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
              {renderSiblings?.(item) ?? (
                <>{!last && <CaretRightIcon weight="bold" aria-hidden className={caretClass} />}</>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
