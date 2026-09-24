import type { MaterialPreview } from "@/lib/tauri";

export function materialPreview(over: Partial<MaterialPreview> = {}): MaterialPreview {
  return {
    hash: "0x12345678",
    name: "Materials/Test",
    missing: false,
    source: null,
    animated: false,
    shader: null,
    base: null,
    tint: [0.25, 0.5, 1],
    opacity: 0.4,
    alphaTest: 0.1,
    uvRepeat: [2, 3],
    uvScroll: null,
    renderState: {
      blending: "normal",
      srcFactor: "srcAlpha",
      dstFactor: "oneMinusSrcAlpha",
      premultiplied: false,
      cutout: false,
      doubleSided: true,
      inverted: false,
      depthWrite: false,
      depthTest: true,
    },
    warnings: [],
    ...over,
  };
}
