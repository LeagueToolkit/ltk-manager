import { getLocale } from "@/i18n";

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** How long ago `iso` was, in the largest whole unit, as the locale writes it: "5 min. ago". */
export function since(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto", style: "short" });

  for (const [unit, size] of UNITS) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }

  return format.format(0, "second");
}
