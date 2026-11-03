import type { KeptSort } from "@/lib/tauri";
import { m } from "@/paraglide/messages";

/** One choice of the Keep sorted by menu: a kept sort, or manual order for null. */
export interface KeptSortOption {
  /** The radio value, `manual` or `<field>:<direction>`. */
  value: string;
  keptSort: KeptSort | null;
  label: () => string;
}

/** The sorts a folder can keep, in menu order, with manual order first. */
export const KEPT_SORT_OPTIONS: readonly KeptSortOption[] = [
  { value: "manual", keptSort: null, label: () => m.library_kept_sort_manual_label() },
  {
    value: "name:asc",
    keptSort: { field: "name", direction: "asc" },
    label: () => m.library_kept_sort_name_asc_label(),
  },
  {
    value: "name:desc",
    keptSort: { field: "name", direction: "desc" },
    label: () => m.library_kept_sort_name_desc_label(),
  },
  {
    value: "champion:asc",
    keptSort: { field: "champion", direction: "asc" },
    label: () => m.library_kept_sort_champion_label(),
  },
  {
    value: "installedAt:desc",
    keptSort: { field: "installedAt", direction: "desc" },
    label: () => m.library_kept_sort_newest_label(),
  },
  {
    value: "installedAt:asc",
    keptSort: { field: "installedAt", direction: "asc" },
    label: () => m.library_kept_sort_oldest_label(),
  },
  {
    value: "enabled:asc",
    keptSort: { field: "enabled", direction: "asc" },
    label: () => m.library_kept_sort_enabled_label(),
  },
];

/** The radio value of `keptSort`, with the enabled sort reading as one choice either way. */
export function keptSortValue(keptSort: KeptSort | null | undefined): string {
  if (!keptSort) return "manual";
  if (keptSort.field === "enabled") return "enabled:asc";
  return `${keptSort.field}:${keptSort.direction}`;
}

/** The kept sort a radio value names, or null for manual order and for a value no option carries. */
export function keptSortFromValue(value: string): KeptSort | null {
  return KEPT_SORT_OPTIONS.find((option) => option.value === value)?.keptSort ?? null;
}

/** The label a kept sort reads as, or null for manual order. */
export function keptSortLabel(keptSort: KeptSort | null | undefined): string | null {
  if (!keptSort) return null;
  const value = keptSortValue(keptSort);
  return KEPT_SORT_OPTIONS.find((option) => option.value === value)?.label() ?? null;
}
