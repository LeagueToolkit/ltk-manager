import { createContext, use } from "react";

import type { BinRow } from "@/lib/tauri";

/** The readings of one curve, per "The tabs" in docs/ux/BIN_EDITOR.md. */
export type CurveTab = "graph" | "table";

/** What the curve surface is aimed at: the value row, and the chain that names it. */
export interface CurveTarget {
  readonly row: BinRow;
  /** The labels from the object down to the row, which is the caption's first line. */
  readonly chain: string;
  /** The reading the aim asks for. The dock keeps the one it is on without this. */
  readonly tab?: CurveTab;
}

/**
 * The open target, and how a mark replaces it. "The curve panel" in docs/ux/BIN_EDITOR.md.
 *
 * There is one of these per object tab, per ADR-0032.
 */
export interface CurveDock {
  readonly target: CurveTarget | null;
  readonly aim: (target: CurveTarget) => void;
  /** Let go of the target, which leaves a dock that was open drawn with nothing in it. */
  readonly clear: () => void;
}

const NO_DOCK: CurveDock = { target: null, aim: () => {}, clear: () => {} };

export const CurveDockContext = createContext<CurveDock>(NO_DOCK);

export function useCurveDock(): CurveDock {
  return use(CurveDockContext);
}

/** What names the surface a value row is drawn on, which the caption's chain hangs off. */
export const CurveChainContext = createContext<string>("");

/** The chain a row takes on this surface: what the surface is called, and the row's name. */
export function useCurveChain(name: string): string {
  const prefix = use(CurveChainContext);
  return prefix === "" ? name : `${prefix} . ${name}`;
}
