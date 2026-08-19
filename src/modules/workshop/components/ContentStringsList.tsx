import { PlusIcon, TranslateIcon } from "@phosphor-icons/react";
import { twMerge } from "tailwind-merge";

import { Button, EmptyState, IconButton, Menu, Tooltip } from "@/components";

import { stringsDocument } from "../documents";
import { useActiveDocumentId, useOpenDocument } from "../state";
import { DEFAULT_LOCALE, LOCALES } from "../string-overrides";

interface ContentStringsListProps {
  /** Null while the project has no layer to override strings in. */
  layerName: string | null;
  /** The layer's saved overrides, locale by locale. */
  overrides: Readonly<Record<string, Record<string, string>>>;
}

interface LocaleOverrides {
  locale: string;
  count: number;
}

/** One row per locale the layer overrides, opening it in the editor. */
export function ContentStringsList({ layerName, overrides }: ContentStringsListProps) {
  const openDocument = useOpenDocument();
  const activeId = useActiveDocumentId();

  if (!layerName) {
    return (
      <EmptyState size="xs" title="No layer" description="Add a layer to override strings in" />
    );
  }

  const locales = localesOf(overrides);

  if (locales.length === 0) {
    return (
      <EmptyState
        size="xs"
        title="No overrides yet"
        description="Replace in-game text per locale"
        action={
          <Button
            variant="outline"
            size="xs"
            left={<PlusIcon weight="bold" className="h-4 w-4" />}
            onClick={() => openDocument(stringsDocument(layerName, DEFAULT_LOCALE))}
          >
            Add overrides
          </Button>
        }
      />
    );
  }

  return (
    <ul data-ui="ContentStringsList" className="flex flex-col gap-0.5 p-1.5">
      {locales.map(({ locale, count }) => {
        const document = stringsDocument(layerName, locale);
        const active = document.id === activeId;

        return (
          <li key={locale}>
            <button
              type="button"
              onClick={() => openDocument(document)}
              className={twMerge(
                "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-500/60",
                active && "bg-accent-500/15 text-accent-100",
                !active && "text-surface-200 hover:bg-surface-800/60 hover:text-surface-100",
              )}
            >
              <TranslateIcon
                className={twMerge(
                  "h-3.5 w-3.5 shrink-0",
                  active ? "text-accent-400" : "text-surface-400",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{locale}</span>
              <span
                className={twMerge(
                  "shrink-0 text-[11px] tabular-nums",
                  active ? "text-accent-300" : "text-surface-400",
                )}
              >
                {count}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface AddLocaleMenuProps {
  layerName: string | null;
  overrides: Readonly<Record<string, Record<string, string>>>;
}

/** Every locale the game ships, whether or not the layer overrides it yet. */
export function AddLocaleMenu({ layerName, overrides }: AddLocaleMenuProps) {
  const openDocument = useOpenDocument();

  if (!layerName) return null;

  return (
    <Menu.Root>
      <Tooltip content="Open a locale">
        <Menu.Trigger
          render={
            <IconButton
              icon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
              variant="ghost"
              size="xs"
              compact
              aria-label="Open a locale"
              className="h-5 w-5"
            />
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4}>
          <Menu.Popup className="max-h-80 overflow-y-auto">
            {LOCALES.map((locale) => {
              const count = Object.keys(overrides[locale.value] ?? {}).length;

              return (
                <Menu.Item
                  key={locale.value}
                  shortcut={count > 0 ? String(count) : undefined}
                  onClick={() => openDocument(stringsDocument(layerName, locale.value))}
                >
                  {locale.label}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* Default first, since it is the fallback the others are read against. */
function localesOf(overrides: Readonly<Record<string, Record<string, string>>>): LocaleOverrides[] {
  return Object.entries(overrides)
    .map(([locale, entries]) => ({ locale, count: Object.keys(entries).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => {
      if (a.locale === DEFAULT_LOCALE) return -1;
      if (b.locale === DEFAULT_LOCALE) return 1;
      return a.locale.localeCompare(b.locale);
    });
}
