import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

/**
 * Report the first path of an OS drop onto the window.
 *
 * Subscribes once and reads the callback through a ref, as `useLayerFileDrop`
 * does, so one drop never reaches two listeners. Whether the path is a folder
 * is the caller's to find out.
 */
export function useFolderDrop(onDrop: (path: string) => void, enabled: boolean): void {
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });

  useEffect(() => {
    if (!enabled) return;

    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;

      const [first] = event.payload.paths;
      if (first) handler.current(first);
    });

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [enabled]);
}
