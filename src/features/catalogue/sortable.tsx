"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A list whose entries can be put in a new order: dragged with the mouse or
 * a finger, or moved with the keyboard (focus the handle, Space to pick the
 * entry up, the arrow keys to move it, Space to put it down, Escape to
 * leave it where it was). What happens is announced to screen readers with
 * the names of the entries.
 */
export function SortableList({
  ids,
  labelOf,
  onReorder,
  layout,
  disabled = false,
  children,
}: {
  /** The entries in their current order. */
  ids: string[];
  /** What an entry is called: "Basmati Rice", "Picture 2". */
  labelOf: (id: string) => string;
  /** Called with the new order when an entry was put down elsewhere. */
  onReorder: (ids: string[]) => void;
  layout: "grid" | "list";
  disabled?: boolean;
  children: ReactNode;
}) {
  const contextId = useId();
  const sensors = useSensors(
    // A few pixels of movement first: a click on a picture stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const place = (id: UniqueIdentifier | undefined) =>
    id === undefined ? -1 : ids.indexOf(String(id));
  const of = `of ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${labelOf(String(active.id))}, at place ${place(active.id) + 1} ${of}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(String(active.id))} is at place ${place(over.id) + 1} ${of}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(String(active.id))} was put at place ${place(over.id) + 1} ${of}.`
        : `${labelOf(String(active.id))} was put back.`,
    onDragCancel: ({ active }) =>
      `Moving ${labelOf(String(active.id))} was cancelled. It is back at its place.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = place(active.id);
    const to = place(over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To change the order, press Space or Enter to pick this entry up, move it with the arrow keys, and press Space or Enter again to put it down. Escape leaves it where it was.",
        },
      }}
    >
      <SortableContext
        items={ids}
        disabled={disabled}
        strategy={
          layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

type SetNode = (node: HTMLElement | null) => void;

export interface SortableEntry {
  /** The `ref` of the element that moves. */
  setNode: SetNode;
  style: CSSProperties;
  dragging: boolean;
  /** The `ref` of the handle: it takes the keyboard and the pointer. */
  setHandle: SetNode;
  /** The attributes and listeners of the handle. */
  handleProps: Record<string, unknown>;
  /** For a larger area that can be dragged with the pointer (the picture). */
  pointerProps: Record<string, unknown> | undefined;
}

/**
 * One entry of a `SortableList`. Take the parts apart where it is used
 * (`const { setNode, style, … } = useSortableEntry(id)`): two of them are
 * refs.
 */
export function useSortableEntry(id: string): SortableEntry {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return {
    setNode: setNodeRef,
    // Entries keep their size while they move: translate only, no scaling.
    style: { transform: CSS.Translate.toString(transform), transition },
    dragging: isDragging,
    setHandle: setActivatorNodeRef,
    handleProps: { ...attributes, ...listeners },
    pointerProps: listeners,
  };
}

/** The grip of a sortable entry. */
export function DragHandle({
  setHandle,
  handleProps,
  label,
  disabled = false,
  className,
}: Pick<SortableEntry, "setHandle" | "handleProps"> & {
  /** "Move Basmati Rice". */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  if (disabled) {
    return (
      <span aria-hidden="true" className={cn("size-7 shrink-0", className)} />
    );
  }
  return (
    <button
      type="button"
      ref={setHandle}
      {...handleProps}
      aria-label={label}
      className={cn(
        "flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
}
