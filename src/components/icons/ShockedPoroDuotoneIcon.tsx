import Mark from "@/assets/icons/ShockedPoroDuotoneIcon.svg?react";

interface ShockedPoroDuotoneIconProps {
  className?: string;
}

/**
 * [`ShockedPoroIcon`] with its body filled in behind the line, at a phosphor
 * duotone's own 20%.
 *
 * Both layers are `currentColor`, so the pair holds together whatever tone it is
 * given and darkens with it in light mode.
 */
export function ShockedPoroDuotoneIcon({ className }: ShockedPoroDuotoneIconProps) {
  return <Mark className={className} />;
}
