import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import { isModArchive } from "./modArchive";

export function useModFileDrop(onDrop: (filePaths: string[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);

  /* Subscribe once and read the callback through a ref. Both halves of the
     subscription cross IPC and neither is synchronous, so re-subscribing on a
     new callback identity can leave two listeners live and import one drop
     twice. */
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
        const validPaths = paths.filter(isModArchive);

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
