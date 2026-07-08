import type { WorkshopLayer } from "@/lib/tauri";

export function LayerOverrideBadge({ layer }: { layer: WorkshopLayer }) {
  const totalCount = Object.values(layer.stringOverrides).reduce(
    (sum, localeOverrides) => sum + Object.keys(localeOverrides).length,
    0,
  );

  if (totalCount === 0) return null;

  return (
    <span className="ml-2 shrink-0 rounded-full bg-accent-500/20 px-2 py-0.5 text-xs font-medium text-accent-400">
      {totalCount}
    </span>
  );
}
