import { type ReactNode } from "react";

interface SettingsGridProps {
  children: ReactNode;
}

/**
 * Lays a tab's section cards into two columns once there is room.
 *
 * A card whose contents need the full width takes `lg:col-span-2`.
 */
export function SettingsGrid({ children }: SettingsGridProps) {
  return <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">{children}</div>;
}
