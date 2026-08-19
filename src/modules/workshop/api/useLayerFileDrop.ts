import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

const WAD_SUFFIXES = [".wad.client", ".wad.mobile", ".wad"];

function basename(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return slashIndex >= 0 ? norm.slice(slashIndex + 1) : norm;
}

function isWadPath(path: string): boolean {
  const lower = basename(path).toLowerCase();
  return WAD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Listen for OS-level drag-drop of WAD files/folders onto the window.
 * Mirrors `useModFileDrop`; matches `.wad`, `.wad.client`, and `.wad.mobile`
 * by basename (directory or file).
 */
export function useLayerFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [isDragOver, setIsDragOver] = useState(false);

  /* Both halves of the subscription cross IPC and neither is synchronous, so
     re-subscribing on a new callback identity can leave the old listener alive
     beside the new one, and one drop then adds its files twice. Subscribe once
     and read the current callback through a ref instead. */
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onDragDropEvent((event) => {
      const eventType = event.payload.type;
      if (eventType === "enter" || eventType === "over") {
        setIsDragOver(true);
      } else if (eventType === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths as string[];
        const validPaths = paths.filter(isWadPath);
        if (validPaths.length > 0) {
          handler.current(validPaths);
        }
      } else if (eventType === "leave" || eventType === "cancel") {
        setIsDragOver(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return isDragOver;
}
