import { createContext, type ReactNode, use } from "react";

const LeafContext = createContext<string | null>(null);

/** Carries a leaf id down its surface, so nothing under one takes it as a prop. */
export function LeafProvider({ leafId, children }: { leafId: string; children: ReactNode }) {
  return <LeafContext value={leafId}>{children}</LeafContext>;
}

/** The leaf the calling component is mounted inside. */
export function useLeafId(): string {
  const leafId = use(LeafContext);
  if (leafId === null) {
    throw new Error("useLeafId must be used within a LeafProvider");
  }
  return leafId;
}
