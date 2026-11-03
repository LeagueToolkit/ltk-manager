import type { FinalConnectionState, OnConnectEnd } from "@xyflow/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type AssetDropDetail, useAssetDrop } from "../../../../state";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import { pressedKey } from "../../utils/vfxKeys";
import { emitterKeyOf, masterIdOf } from "../state/hoveredEmitter";
import type { GraphLayout } from "../utils/driverLayout";
import { holderRow } from "../utils/holderRow";
import type { MasterItem } from "../utils/systemGraph";
import { emitterDropEdit } from "./assetDrops";
import { EMPTY_SOCKET } from "./EmptySocket";
import { type QuickAddHost, type SocketPlug, socketKey } from "./graphActions";
import type { QuickAddAt } from "./QuickAdd";

/**
 * The canvas's connection settings: an empty socket's drag draws its line in the accent, and
 * no drag ends on a handle, since the drag opens the quick add instead.
 */
export const CONNECTION_PROPS = {
  nodesConnectable: true,
  connectOnClick: false,
  isValidConnection: () => false,
  /* DS-TOKEN */
  connectionLineStyle: { stroke: "var(--color-accent-400)", strokeWidth: 1.5 },
} as const;

/** The room the quick add takes, in pixels, which an opening near an edge keeps inside the box. */
const QUICK_ROOM = { width: 296, height: 48 } as const;

interface CanvasAddsOptions {
  /** The canvas box, which the quick add is placed in. */
  box: RefObject<HTMLElement | null>;
  entry: string;
  layout: GraphLayout;
  /** The node selected alone, whose emitter the quick add falls back to off every node. */
  picked: string | null;
}

/**
 * The canvas's adds: the quick add on Tab, Shift+A or a double click on bare canvas, a drag
 * out of an empty socket, and a texture or a mesh dropped from the content tree on an
 * emitter's node. "Adding from the keyboard" in docs/ux/BIN_EDITOR.md.
 */
export function useCanvasAdds({ box, entry, layout, picked }: CanvasAddsOptions) {
  const masters = useMemo(
    () => layout.items.flatMap(({ item }) => (item.type === "master" ? [item] : [])),
    [layout],
  );
  const editProperty = use(LeafEditContext)?.editProperty;
  const [quick, setQuick] = useState<QuickAddAt | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [plugs] = useState(() => new Map<string, SocketPlug>());

  const masterOf = useCallback(
    (id: string | null | undefined) => {
      const key = id === null || id === undefined ? null : emitterKeyOf(entry, id);
      if (key === null) return null;

      const master = masterIdOf(key.simple, key.listIndex);
      return masters.find((each) => each.id === master) ?? null;
    },
    [entry, masters],
  );
  /* Read through a ref, so a pick keeps `host` and every empty socket under it unchanged. */
  const masterAt = useRef<(x: number, y: number) => MasterItem | null>(() => null);
  useLayoutEffect(() => {
    masterAt.current = (x, y) => masterOf(nodeIdAt(x, y)) ?? masterOf(picked);
  });

  const open = useCallback(
    (
      at: { x: number; y: number },
      plug: SocketPlug | null,
      master: MasterItem | null = plug === null ? masterAt.current(at.x, at.y) : null,
    ) => {
      const rect = box.current?.getBoundingClientRect();
      if (rect === undefined) return;

      setQuick({
        x: clamp(at.x - rect.left, 0, rect.width - QUICK_ROOM.width),
        y: clamp(at.y - rect.top, 0, rect.height - QUICK_ROOM.height),
        master,
        plug,
      });
    },
    [box],
  );
  const host = useMemo<QuickAddHost>(() => ({ plugs, open }), [plugs, open]);

  const middle = () => {
    const rect = box.current?.getBoundingClientRect();

    return {
      x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
    };
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!pressedKey(event, "quickAdd")) return false;

    open(pointer.current ?? middle(), null);
    return true;
  };
  const onDoubleClick = (event: ReactMouseEvent) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.classList.contains("react-flow__pane")
    ) {
      return;
    }
    open({ x: event.clientX, y: event.clientY }, null);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
  };
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state: FinalConnectionState) => {
      const from = state.fromHandle;
      if (state.toHandle !== null || from === null || from.id?.startsWith(EMPTY_SOCKET) !== true) {
        return;
      }
      const plug = plugs.get(socketKey(from.nodeId, from.id));
      if (plug === undefined) return;

      const at = "changedTouches" in event ? event.changedTouches[0] : event;
      if (at !== undefined) open({ x: at.clientX, y: at.clientY }, plug);
    },
    [plugs, open],
  );

  const onAssetDrop = useMemo(() => {
    if (editProperty === undefined || entry === "") return null;

    return (drop: AssetDropDetail) => {
      const master = masterOf(nodeIdAt(drop.x, drop.y));
      const edit = emitterDropEdit(drop.path);
      if (master === null || edit === null) return false;

      void editProperty(holderRow(entry, master.wire), edit.field, edit.edits);
      return true;
    };
  }, [editProperty, entry, masterOf]);
  useAssetDrop(box, onAssetDrop);

  return {
    masters,
    quick,
    /** The master node of the picked node, which a field added from the menu bar goes on. */
    pickedMaster: masterOf(picked),
    /** Opens the quick add at the middle of the canvas, on the picked node's emitter if any. */
    openAtMiddle: () => open(middle(), null, masterOf(picked)),
    close: () => setQuick(null),
    host,
    onKeyDown,
    onDoubleClick,
    onPointerMove,
    onConnectEnd,
  };
}

/** The id of the graph node under a point on the screen, and null off every node. */
function nodeIdAt(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest(".react-flow__node")?.getAttribute("data-id") ?? null
  );
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), Math.max(most, least));
}
