import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { isModArchive } from "./modArchive";

export function useModFileDrop(onDrop: (filePaths: string[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);

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
          onDrop(validPaths);
        }
      } else if (eventType === "leave" || eventType === "cancel") {
        setIsDragOver(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onDrop]);

  return isDragOver;
}
