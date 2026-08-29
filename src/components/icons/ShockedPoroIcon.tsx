import Mark from "@/assets/icons/ShockedPoroIcon.svg?react";

interface ShockedPoroIconProps {
  className?: string;
}

/**
 * A poro pulling a face at something it cannot fix.
 *
 * Line art in one colour, so unlike [`WolfIcon`] it inherits `currentColor` and
 * can wear the danger tone a mod beyond repair is announced in.
 */
export function ShockedPoroIcon({ className }: ShockedPoroIconProps) {
  return <Mark className={className} />;
}
