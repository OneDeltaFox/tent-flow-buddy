import { createContext, useContext, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import type { DispositionCategory } from "@/lib/tent-data";

export type PatientRef =
  { kind: "bed"; podId: string; bedId: string } | { kind: "incoming"; incomingId: string };
export type PatientDestination =
  | { kind: "bed"; podId: string; bedId: string }
  | { kind: "disposition"; category: DispositionCategory };

const MovementContext = createContext<{ suppressClick: () => boolean }>({
  suppressClick: () => false,
});

export function PatientMovement({
  children,
  onMove,
}: {
  children: ReactNode;
  onMove: (source: PatientRef, target: PatientDestination) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 450, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 450, tolerance: 8 } }),
  );
  const [active, setActive] = useState<{ bib: string } | null>(null);
  const suppressUntil = useRef(0);
  const finish = () => {
    suppressUntil.current = Date.now() + 500;
    setActive(null);
  };
  return (
    <MovementContext.Provider value={{ suppressClick: () => Date.now() < suppressUntil.current }}>
      <DndContext
        id="tent-patient-movement"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => {
          suppressUntil.current = Infinity;
          setActive({ bib: active.data.current?.["bib"] ?? "" });
        }}
        onDragCancel={finish}
        onDragEnd={({ active, over }) => {
          finish();
          if (active.data.current?.["source"] && over?.data.current?.["target"]) {
            onMove(active.data.current["source"], over.data.current["target"]);
          }
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="pointer-events-none rounded-md border-2 border-signal bg-card px-4 py-3 text-center font-mono text-lg font-bold shadow-xl">
              #{active.bib}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </MovementContext.Provider>
  );
}

export function PatientSurface({
  source,
  bib,
  onEdit,
  children,
  className = "",
}: {
  source?: PatientRef | undefined;
  bib?: string | undefined;
  onEdit?: (() => void) | undefined;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const { suppressClick } = useContext(MovementContext);
  const press = useRef<{ x: number; y: number } | null>(null);
  const ignoreClickUntil = useRef(0);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { source, bib },
    disabled: !source,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role={onEdit ? "button" : undefined}
      aria-disabled={!onEdit}
      aria-roledescription={source ? "draggable" : undefined}
      tabIndex={onEdit ? 0 : -1}
      aria-label={bib ? `Edit patient ${bib}` : undefined}
      onPointerDown={(event) => {
        press.current = { x: event.clientX, y: event.clientY };
        ignoreClickUntil.current = 0;
      }}
      onPointerMove={(event) => {
        if (
          press.current &&
          Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8
        ) {
          ignoreClickUntil.current = Date.now() + 500;
        }
      }}
      onPointerUp={() => {
        press.current = null;
      }}
      onPointerCancel={() => {
        press.current = null;
        ignoreClickUntil.current = Date.now() + 500;
      }}
      onClick={(event) => {
        event.stopPropagation();
        // Some touch browsers synthesize a click after an aborted hold or scroll.
        if (!suppressClick() && Date.now() >= ignoreClickUntil.current) onEdit?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit?.();
        }
      }}
      onContextMenu={(event) => {
        if (source) event.preventDefault();
      }}
      className={`patient-surface ${source ? "cursor-grab" : ""} ${isDragging ? "opacity-40 ring-2 ring-signal" : ""} ${className}`}
      style={{ touchAction: "manipulation", userSelect: "none", WebkitTouchCallout: "none" }}
    >
      {children}
    </div>
  );
}

export function PatientDropTarget({
  target,
  children,
  className = "",
}: {
  target?: PatientDestination | undefined;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const { setNodeRef, isOver, active } = useDroppable({ id, data: { target }, disabled: !target });
  return (
    <div
      ref={setNodeRef}
      data-drop-target={target ? JSON.stringify(target) : undefined}
      className={`${className} ${active && target ? "ring-1 ring-signal" : ""} ${isOver ? "ring-4 ring-signal bg-signal/20" : ""}`}
    >
      {children}
    </div>
  );
}
