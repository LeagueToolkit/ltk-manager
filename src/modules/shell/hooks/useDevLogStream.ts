import { useTauriEvent } from "@/lib/useTauriEvent";

import { useDevConsoleStore } from "../state";

interface LogEventPayload {
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

export function useDevLogStream() {
  const addEntry = useDevConsoleStore((s) => s.addEntry);

  useTauriEvent<LogEventPayload>(import.meta.env.DEV ? "log-event" : null, (payload) => {
    addEntry(payload);
  });
}
