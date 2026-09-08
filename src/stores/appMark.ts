import { create } from "zustand";
import { persist } from "zustand/middleware";

import { keepUnversioned } from "./storage";

/* The marks the title bar can wear, in the order a rotation walks them. The
   diamond leads, so a full turn always comes back to what the app ships. */
const APP_MARKS = ["ltk", "poro", "minion", "scuttle"] as const;

type AppMark = (typeof APP_MARKS)[number];

interface AppMarkStore {
  appMark: AppMark;
  /** Steps to the next mark, diamond included. */
  rotateAppMark: () => void;
  /** Lands on a mascot that is neither the diamond nor the one already up. */
  rollAppMark: () => void;
}

export const useAppMarkStore = create<AppMarkStore>()(
  persist(
    (set) => ({
      appMark: "ltk",
      rotateAppMark: () =>
        set(({ appMark }) => ({
          appMark: APP_MARKS[(APP_MARKS.indexOf(appMark) + 1) % APP_MARKS.length],
        })),
      rollAppMark: () =>
        set(({ appMark }) => {
          const rest = APP_MARKS.filter((mark) => mark !== "ltk" && mark !== appMark);
          return { appMark: rest[Math.floor(Math.random() * rest.length)] };
        }),
    }),
    { name: "ltk-app-mark", version: 1, migrate: keepUnversioned<AppMarkStore> },
  ),
);

export { APP_MARKS };
export type { AppMark };
export const useAppMark = () => useAppMarkStore((s) => s.appMark);
export const useRotateAppMark = () => useAppMarkStore((s) => s.rotateAppMark);
export const useRollAppMark = () => useAppMarkStore((s) => s.rollAppMark);
