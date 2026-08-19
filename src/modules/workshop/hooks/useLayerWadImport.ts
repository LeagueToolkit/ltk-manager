import { open } from "@tauri-apps/plugin-dialog";

import { useAddFilesToLayer } from "../api";

interface LayerTarget {
  projectPath: string;
  layerName: string;
  layerDisplayName: string;
}

interface LayerWadImport {
  isPending: boolean;
  pickFiles: () => Promise<void>;
  pickFolder: () => Promise<void>;
}

/** Picks WADs off disk and copies them into a layer, from wherever the ask came. */
export function useLayerWadImport(target: LayerTarget): LayerWadImport {
  const addFilesToLayer = useAddFilesToLayer();

  function dispatch(sources: string[]) {
    if (sources.length === 0) return;
    addFilesToLayer.mutate({ ...target, sources });
  }

  async function pickFiles() {
    const selection = await open({
      multiple: true,
      filters: [
        { name: "WAD files", extensions: ["wad", "client", "mobile"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!selection) return;
    dispatch(Array.isArray(selection) ? selection : [selection]);
  }

  async function pickFolder() {
    const selection = await open({ directory: true, multiple: false });
    if (!selection) return;
    dispatch([selection as string]);
  }

  return { isPending: addFilesToLayer.isPending, pickFiles, pickFolder };
}
