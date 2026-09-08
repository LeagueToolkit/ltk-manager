import { create } from "zustand";

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

const MAX_ENTRIES = 500;

let nextId = 0;

interface DevConsoleStore {
  entries: LogEntry[];
  isOpen: boolean;
  levelFilter: LogLevel;
  targetFilter: string;
  addEntry: (entry: Omit<LogEntry, "id">) => void;
  toggle: () => void;
  setLevelFilter: (level: LogLevel) => void;
  setTargetFilter: (target: string) => void;
  clear: () => void;
}

export function isLevelVisible(entryLevel: string, filterLevel: LogLevel): boolean {
  const entryPriority = LEVEL_PRIORITY[entryLevel as LogLevel];
  const filterPriority = LEVEL_PRIORITY[filterLevel];
  if (entryPriority === undefined || filterPriority === undefined) return true;
  return entryPriority >= filterPriority;
}

export const useDevConsoleStore = create<DevConsoleStore>((set) => ({
  entries: [],
  isOpen: false,
  levelFilter: "DEBUG" as LogLevel,
  targetFilter: "",

  addEntry: (entry) =>
    set((state) => ({
      entries: [...state.entries, { ...entry, id: nextId++ }].slice(-MAX_ENTRIES),
    })),

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  setLevelFilter: (level) => set({ levelFilter: level }),

  setTargetFilter: (target) => set({ targetFilter: target }),

  clear: () => set({ entries: [] }),
}));
