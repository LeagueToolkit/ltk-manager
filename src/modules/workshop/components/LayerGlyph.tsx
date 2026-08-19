import { twMerge } from "tailwind-merge";

import { BaseLayerIcon, LayerIcon } from "@/components";

interface LayerGlyphProps {
  layerName: string;
  className?: string;
}

/** A layer's mark, set apart for the base every project starts from. */
export function LayerGlyph({ layerName, className }: LayerGlyphProps) {
  const base = layerName === "base";
  const classes = twMerge(
    "h-3.5 w-3.5 shrink-0",
    base ? "text-doc-base-text" : "text-doc-layer-text",
    className,
  );

  if (base) return <BaseLayerIcon className={classes} />;
  return <LayerIcon className={classes} />;
}
