import { useRef } from "react";

import type { MeshDrag } from "@/modules/viewport";

import { type HeldMeshDrag, heldMeshDrag, type MeshDragInputs } from "../utils/meshSelection";

/**
 * Returns the mesh drag that the map viewport's backdrop and highlight draw, and null outside one.
 *
 * Holds a committed drag until the buffer with the move lands, per [`heldMeshDrag`].
 */
export function useMeshDrag(inputs: MeshDragInputs): MeshDrag | null {
  const last = useRef<HeldMeshDrag | null>(null);
  const next = heldMeshDrag(last.current, inputs);
  last.current = next;

  return next?.drag ?? null;
}
