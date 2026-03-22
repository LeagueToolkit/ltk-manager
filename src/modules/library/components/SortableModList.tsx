import {
  closestCenter,
  DndContext,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useEffect, useMemo, useRef, useState } from "react";

import type { InstalledMod } from "@/lib/tauri";

import { ModCard } from "./ModCard";
import { SortableModCard } from "./SortableModCard";

interface SortableModListProps {
  mods: InstalledMod[];
  viewMode: "grid" | "list";
  onReorder: (modIds: string[]) => void;
  disabled?: boolean;
  onToggle: (modId: string, enabled: boolean) => void;
  onUninstall: (modId: string) => void;
  onViewDetails?: (mod: InstalledMod) => void;
  isPatcherActive?: boolean;
  className?: string;
}

export function SortableModList({
  mods,
  viewMode,
  onReorder,
  disabled,
  onToggle,
  onUninstall,
  onViewDetails,
  isPatcherActive,
  className,
}: SortableModListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>(() => mods.map((m) => m.id));
  const lastPropsOrder = useRef<string[]>(localOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const propsOrder = useMemo(() => mods.map((m) => m.id), [mods]);

  useEffect(() => {
    if (propsOrder.join() !== lastPropsOrder.current.join()) {
      lastPropsOrder.current = propsOrder;
      if (!activeId) {
        setLocalOrder(propsOrder);
      }
    }
  }, [propsOrder, activeId]);

  const modMap = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);

  const orderedMods = useMemo(
    () => localOrder.map((id) => modMap.get(id)).filter(Boolean) as InstalledMod[],
    [localOrder, modMap],
  );

  const activeMod = activeId ? (modMap.get(activeId) ?? null) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleDragEnd() {
    setActiveId(null);
    const changed = localOrder.join() !== propsOrder.join();
    if (changed) {
      onReorder(localOrder);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setLocalOrder(propsOrder);
  }

  if (disabled) {
    return (
      <div className={className}>
        {mods.map((mod) => (
          <ModCard
            key={mod.id}
            mod={mod}
            viewMode={viewMode}
            onToggle={onToggle}
            onUninstall={onUninstall}
            onViewDetails={onViewDetails}
            disabled={isPatcherActive}
          />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={localOrder}
        strategy={viewMode === "list" ? verticalListSortingStrategy : rectSortingStrategy}
      >
        <div className={className}>
          {orderedMods.map((mod) => (
            <SortableModCard
              key={mod.id}
              mod={mod}
              viewMode={viewMode}
              onToggle={onToggle}
              onUninstall={onUninstall}
              onViewDetails={onViewDetails}
              disabled={isPatcherActive}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeMod ? (
          <div className="scale-[1.02] cursor-grabbing rounded-xl shadow-lg ring-2 ring-accent-500/30">
            <ModCard
              mod={activeMod}
              viewMode={viewMode}
              onToggle={onToggle}
              onUninstall={onUninstall}
              onViewDetails={onViewDetails}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
