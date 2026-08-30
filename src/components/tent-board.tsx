import { useEffect, useMemo, useState } from "react";
import type {
  Bed,
  BedStatus,
  Disposition,
  DispositionCategory,
  Incoming,
  Pod,
  Triage,
} from "@/lib/tent-data";
import {
  BEDS_PER_POD,
  dispositionCategories,
  emptyPod,
  initialDispositions,
  initialIncoming,
  initialPods,
} from "@/lib/tent-data";

const statusTile: Record<BedStatus, string> = {
  open: "bg-status-open/15 border-status-open/50 text-status-open",
  occupied: "bg-status-occupied border-status-occupied text-background",
  critical: "bg-status-critical border-status-critical text-foreground",
  cleaning: "bg-status-cleaning/40 border-status-cleaning text-muted-foreground",
};

const statusLabel: Record<BedStatus, string> = {
  open: "Open",
  occupied: "Occupied",
  critical: "Critical",
  cleaning: "Cleaning",
};

const triageLabel: Record<Triage, string> = {
  immediate: "Immediate",
  delayed: "Delayed",
  minor: "Minor",
};

const triageBadge: Record<Triage, string> = {
  immediate: "border-status-critical bg-status-critical/15 text-status-critical",
  delayed: "border-status-occupied bg-status-occupied/15 text-status-occupied",
  minor: "border-status-open bg-status-open/15 text-status-open",
};

const triageDot: Record<Triage, string> = {
  immediate: "bg-status-critical",
  delayed: "bg-status-occupied",
  minor: "bg-status-open",
};

const incomingTone: Record<Triage, string> = {
  immediate: "border-l-status-critical",
  delayed: "border-l-status-occupied",
  minor: "border-l-status-open",
};

const dispositionTone: Record<DispositionCategory, string> = {
  returned: "border-status-open/70",
  discharged: "border-muted-foreground/60",
  ems: "border-status-critical/80",
  hospital: "border-status-critical/80",
  other: "border-signal/70",
};

const DRAG_MIME = "application/x-tent-patient";
const PODS_STORAGE_KEY = "tent-board-pods-v3";
const INCOMING_STORAGE_KEY = "tent-board-incoming-v1";
const DISPOSITION_STORAGE_KEY = "tent-board-dispositions-v1";

type DragRef =
  | { kind: "bed"; podId: string; bedId: string }
  | { kind: "incoming"; incomingId: string };

type PatientSummary = {
  bib: string;
  triage?: Triage | undefined;
  complaint?: string | undefined;
  operationalStatus?: string | undefined;
};

function formatBoardTime() {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function loadStoredArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseDragRef(raw: string): DragRef | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.kind === "incoming" && typeof parsed.incomingId === "string") {
      return { kind: "incoming", incomingId: parsed.incomingId };
    }
    if (
      parsed.kind === "bed" &&
      typeof parsed.podId === "string" &&
      typeof parsed.bedId === "string"
    ) {
      return { kind: "bed", podId: parsed.podId, bedId: parsed.bedId };
    }
  } catch {
    return null;
  }

  return null;
}

function patientFromBed(bed: Bed): PatientSummary {
  return {
    bib: bed.bib ?? "",
    triage: bed.triage,
    complaint: bed.complaint,
    operationalStatus: bed.operationalStatus,
  };
}

function patientFromIncoming(patient: Incoming): PatientSummary {
  return {
    bib: patient.bib,
    triage: patient.triage,
    complaint: patient.complaint,
    operationalStatus: patient.operationalStatus,
  };
}

function clearBed(bed: Bed, status: BedStatus): Bed {
  return {
    ...bed,
    status,
    bib: undefined,
    since: undefined,
    triage: undefined,
    complaint: undefined,
    operationalStatus: undefined,
  };
}

function statusForTriage(triage: Triage): BedStatus {
  return triage === "immediate" ? "critical" : "occupied";
}

function dispositionRecord(
  category: DispositionCategory,
  patient: PatientSummary,
  from: string,
): Disposition {
  return {
    id: `${Date.now()}-${patient.bib}-${category}`,
    bib: patient.bib,
    category,
    time: formatBoardTime(),
    from,
    triage: patient.triage,
    complaint: patient.complaint,
  };
}

function BedTile({
  bed,
  draggable,
  dropTarget,
  className = "",
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  bed: Bed;
  draggable: boolean;
  dropTarget: boolean;
  className?: string;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      title={`${bed.label} - ${statusLabel[bed.status]}${bed.bib ? ` - #${bed.bib}` : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={
        dropTarget
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={dropTarget ? () => setOver(false) : undefined}
      onDrop={
        dropTarget
          ? (e) => {
              e.preventDefault();
              setOver(false);
              onDrop?.(e);
            }
          : undefined
      }
      className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-sm border font-mono leading-none ${statusTile[bed.status]} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${over ? "ring-2 ring-signal bg-signal/20" : ""} ${className}`}
    >
      {bed.bib ? (
        <span className="text-[13px] font-extrabold tracking-tight">{bed.bib}</span>
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-tight">
          {bed.status === "cleaning" ? "CLR" : bed.label}
        </span>
      )}
    </div>
  );
}

function PatientCard({
  patient,
  locationLabel,
  title,
  onDragStart,
  onDragEnd,
}: {
  patient: PatientSummary;
  locationLabel: string;
  title: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={title}
      className={`flex cursor-grab items-center gap-3 rounded-md border bg-secondary/40 px-3 py-2.5 active:cursor-grabbing ${
        patient.triage === "immediate"
          ? "border-status-critical/60"
          : "border-border hover:border-muted-foreground"
      }`}
    >
      <span className="shrink-0 font-mono text-2xl font-extrabold tracking-tight">
        #{patient.bib}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {patient.complaint ?? "Needs placement"}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {patient.triage && (
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${triageBadge[patient.triage]}`}
            >
              <span className={`size-1.5 rounded-full ${triageDot[patient.triage]}`} />
              {triageLabel[patient.triage]}
            </span>
          )}
          {patient.operationalStatus && (
            <span className="truncate rounded-sm bg-background/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight text-muted-foreground">
              {patient.operationalStatus}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-right font-mono text-[10px] font-bold uppercase text-muted-foreground">
        {locationLabel}
      </span>
    </div>
  );
}

function IncomingCard({
  patient,
  onDragStart,
  onDragEnd,
}: {
  patient: Incoming;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className={`rounded-r-sm border-l-2 bg-secondary/40 p-2 ${incomingTone[patient.triage]}`}>
      <PatientCard
        patient={patientFromIncoming(patient)}
        locationLabel={`ETA ${patient.eta}`}
        title="Drag to an open bed or disposition bucket"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">{patient.source}</p>
    </div>
  );
}

function podCounts(pod: Pod) {
  const open = pod.beds.filter((b) => b.status === "open").length;
  const critical = pod.beds.filter((b) => b.status === "critical").length;
  return { open, critical, total: pod.beds.length };
}

function PodCard({
  pod,
  selected,
  setup,
  onSelect,
  onRemove,
  onNoteChange,
  onPatientDragStart,
  onPatientDragEnd,
  onPatientDrop,
}: {
  pod: Pod;
  selected: boolean;
  setup: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onNoteChange: (note: string) => void;
  onPatientDragStart: (bedId: string, e: React.DragEvent) => void;
  onPatientDragEnd: () => void;
  onPatientDrop: (bedId: string, e: React.DragEvent) => void;
}) {
  const { open, critical, total } = podCounts(pod);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors ${
          selected ? "border-signal ring-1 ring-signal" : "border-border hover:border-muted-foreground"
        }`}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight">{pod.name}</h3>
            <p className="truncate text-[10px] font-medium text-muted-foreground">{pod.zone}</p>
            {pod.note && (
              <p className="mt-1 truncate text-[10px] font-semibold text-signal">{pod.note}</p>
            )}
            {pod.capabilities.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {pod.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tight text-muted-foreground"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right font-mono">
            <div className="text-lg font-extrabold leading-none text-status-open">
              {String(open).padStart(2, "0")}
            </div>
            <div className="text-[9px] font-bold uppercase text-muted-foreground">open / {total}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {pod.beds.map((bed) => (
            <BedTile
              key={bed.id}
              bed={bed}
              draggable={!setup && !!bed.bib}
              dropTarget={!setup && bed.status === "open"}
              onDragStart={(e) => {
                e.stopPropagation();
                onPatientDragStart(bed.id, e);
              }}
              onDragEnd={onPatientDragEnd}
              onDrop={(e) => onPatientDrop(bed.id, e)}
            />
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border pt-2">
          <span className="truncate text-[10px] font-medium text-muted-foreground">
            {pod.staff.length > 0 ? pod.staff.join(" - ") : "No staff assigned"}
          </span>
          {critical > 0 && (
            <span className="shrink-0 rounded-sm bg-status-critical/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-status-critical">
              {critical} critical
            </span>
          )}
        </div>
      </button>
      {setup && (
        <div className="mt-2 flex gap-2">
          <input
            value={pod.note ?? ""}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Short pod note"
            className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
          />
          <button
            type="button"
            onClick={onRemove}
            title="Remove pod"
            className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-status-critical bg-status-critical text-sm font-bold leading-none text-foreground hover:opacity-80"
          >
            x
          </button>
        </div>
      )}
    </div>
  );
}

function PodDetail({
  pod,
  onClose,
  onClearBed,
  onPatientDragStart,
  onPatientDragEnd,
  onPatientDrop,
}: {
  pod: Pod;
  onClose: () => void;
  onClearBed: (bedId: string) => void;
  onPatientDragStart: (bedId: string, e: React.DragEvent) => void;
  onPatientDragEnd: () => void;
  onPatientDrop: (bedId: string, e: React.DragEvent) => void;
}) {
  const { open, total } = podCounts(pod);
  const patients = pod.beds.filter((bed) => bed.bib);
  const openBeds = pod.beds.filter((bed) => bed.status === "open");
  const cleaningBeds = pod.beds.filter((bed) => bed.status === "cleaning");

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-signal bg-card p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight">{pod.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            {pod.zone} - drag a patient card onto any open bed to move them
          </p>
          {pod.note && <p className="mt-1 text-[11px] font-semibold text-signal">{pod.note}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-sm border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-4 border-y border-border py-2 font-mono">
        <div>
          <div className="text-[9px] font-bold uppercase text-muted-foreground">Open beds</div>
          <div className="text-xl font-extrabold text-status-open">
            {open}
            <span className="text-sm text-muted-foreground"> / {total}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-muted-foreground">Staff on pod</div>
          <div className="text-xs font-medium text-foreground">
            {pod.staff.length > 0 ? pod.staff.join(", ") : "-"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-muted-foreground">Capabilities</div>
          <div className="text-xs font-medium text-foreground">
            {pod.capabilities.length > 0 ? pod.capabilities.join(", ") : "-"}
          </div>
        </div>
        {openBeds.length > 0 && (
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase text-muted-foreground">
              Open bed drop targets
            </div>
            <div className="mt-1 flex gap-1.5">
              {openBeds.map((bed) => (
                <BedTile
                  key={bed.id}
                  bed={bed}
                  draggable={false}
                  dropTarget
                  className="size-9"
                  onDrop={(e) => onPatientDrop(bed.id, e)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {patients.length === 0 && (
          <p className="text-xs text-muted-foreground">No patients currently in this pod.</p>
        )}
        {patients.map((bed) => (
          <PatientCard
            key={bed.id}
            patient={patientFromBed(bed)}
            locationLabel={`${bed.label} - in ${bed.since ?? "--:--"}`}
            title="Drag to another open bed or disposition bucket"
            onDragStart={(e) => onPatientDragStart(bed.id, e)}
            onDragEnd={onPatientDragEnd}
          />
        ))}
      </div>

      {cleaningBeds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Turnover
          </span>
          {cleaningBeds.map((bed) => (
            <button
              key={bed.id}
              type="button"
              onClick={() => onClearBed(bed.id)}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] font-bold uppercase text-muted-foreground hover:border-status-open hover:text-status-open"
            >
              {bed.label} ready
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DispositionBucket({
  category,
  dispositions,
  onDrop,
}: {
  category: (typeof dispositionCategories)[number];
  dispositions: Disposition[];
  onDrop: (category: DispositionCategory, e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  const latest = dispositions.slice(0, 3);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(category.id, e);
      }}
      className={`rounded-md border bg-card/70 p-2.5 ${dispositionTone[category.id]} ${
        over ? "ring-2 ring-signal bg-signal/10" : ""
      }`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <h3 className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {category.label}
        </h3>
        <span className="font-mono text-xl font-extrabold leading-none text-foreground">
          {dispositions.length}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {latest.length === 0 && (
          <p className="rounded-sm border border-dashed border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-tight text-muted-foreground">
            Drop here
          </p>
        )}
        {latest.map((item) => (
          <div key={item.id} className="border-t border-border pt-1.5 first:border-t-0 first:pt-0">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
              <span className="truncate font-mono text-sm font-bold">#{item.bib}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {item.time}
              </span>
            </div>
            <p className="truncate text-[10px] font-medium text-muted-foreground">
              {item.from}
              {item.complaint ? ` - ${item.complaint}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function nextPodId(pods: Pod[]): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const used = new Set(pods.map((pod) => pod.id));
  return letters.find((letter) => !used.has(letter)) ?? `P${pods.length + 1}`;
}

export function TentBoard() {
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [pods, setPods] = useState<Pod[]>(initialPods);
  const [incomingQueue, setIncomingQueue] = useState<Incoming[]>(initialIncoming);
  const [dispositions, setDispositions] = useState<Disposition[]>(initialDispositions);
  const [hydrated, setHydrated] = useState(false);
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [dragRef, setDragRef] = useState<DragRef | null>(null);

  useEffect(() => {
    setPods(loadStoredArray(PODS_STORAGE_KEY, initialPods));
    setIncomingQueue(loadStoredArray(INCOMING_STORAGE_KEY, initialIncoming));
    setDispositions(loadStoredArray(DISPOSITION_STORAGE_KEY, initialDispositions));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PODS_STORAGE_KEY, JSON.stringify(pods));
    localStorage.setItem(INCOMING_STORAGE_KEY, JSON.stringify(incomingQueue));
    localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(dispositions));
  }, [dispositions, hydrated, incomingQueue, pods]);

  const totals = useMemo(() => {
    const all = pods.flatMap((pod) => pod.beds);
    const currentCensus = all.filter((bed) => bed.bib).length;
    const occupiedBeds = all.filter((bed) => bed.status === "occupied" || bed.status === "critical").length;

    return {
      currentCensus,
      occupiedBeds,
      open: all.filter((bed) => bed.status === "open").length,
      totalBeds: all.length,
      incoming: incomingQueue.length,
      seenToday: currentCensus + dispositions.length,
    };
  }, [dispositions.length, incomingQueue.length, pods]);

  const selected = pods.find((pod) => pod.id === selectedPod) ?? null;
  const dispositionCounts = useMemo(
    () =>
      dispositionCategories.map((category) => ({
        ...category,
        dispositions: dispositions.filter((item) => item.category === category.id),
      })),
    [dispositions],
  );

  const addPod = () => {
    const id = nextPodId(pods);
    const name = newName.trim() || `Pod ${id}`;
    const newPod = emptyPod(id, name, newZone.trim() || "Unassigned zone", newNote.trim());
    setPods((prev) => [...prev, newPod]);
    setNewName("");
    setNewZone("");
    setNewNote("");
  };

  const removePod = (id: string) => {
    setPods((prev) => prev.filter((pod) => pod.id !== id));
    if (selectedPod === id) setSelectedPod(null);
  };

  const updatePodNote = (id: string, note: string) => {
    setPods((prev) => prev.map((pod) => (pod.id === id ? { ...pod, note } : pod)));
  };

  const startDrag = (ref: DragRef, e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ref));
    e.dataTransfer.effectAllowed = "move";
    setDragRef(ref);
  };

  const readDropRef = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw ? parseDragRef(raw) : dragRef;
  };

  const handleBedDrop = (targetPodId: string, targetBedId: string, e: React.DragEvent) => {
    const ref = readDropRef(e);
    setDragRef(null);
    if (!ref) return;

    const targetPod = pods.find((pod) => pod.id === targetPodId);
    const targetBed = targetPod?.beds.find((bed) => bed.id === targetBedId);
    if (!targetPod || targetBed?.status !== "open") return;

    if (ref.kind === "incoming") {
      const patient = incomingQueue.find((item) => item.id === ref.incomingId);
      if (!patient) return;

      setPods((prev) =>
        prev.map((pod) => ({
          ...pod,
          beds: pod.beds.map((bed) =>
            pod.id === targetPodId && bed.id === targetBedId
              ? {
                  ...bed,
                  status: statusForTriage(patient.triage),
                  bib: patient.bib,
                  since: formatBoardTime(),
                  triage: patient.triage,
                  complaint: patient.complaint,
                  operationalStatus: patient.operationalStatus,
                }
              : bed,
          ),
        })),
      );
      setIncomingQueue((prev) => prev.filter((item) => item.id !== ref.incomingId));
      setSelectedPod(targetPodId);
      return;
    }

    if (ref.podId === targetPodId && ref.bedId === targetBedId) return;

    const sourcePod = pods.find((pod) => pod.id === ref.podId);
    const sourceBed = sourcePod?.beds.find((bed) => bed.id === ref.bedId);
    if (!sourcePod || !sourceBed?.bib) return;

    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) => {
          if (pod.id === ref.podId && bed.id === ref.bedId) {
            return clearBed(bed, "open");
          }
          if (pod.id === targetPodId && bed.id === targetBedId) {
            return {
              ...bed,
              status: sourceBed.status === "critical" ? "critical" : "occupied",
              bib: sourceBed.bib,
              since: sourceBed.since,
              triage: sourceBed.triage,
              complaint: sourceBed.complaint,
              operationalStatus: sourceBed.operationalStatus,
            };
          }
          return bed;
        }),
      })),
    );
    setSelectedPod(targetPodId);
  };

  const handleDispositionDrop = (category: DispositionCategory, e: React.DragEvent) => {
    const ref = readDropRef(e);
    setDragRef(null);
    if (!ref) return;

    if (ref.kind === "incoming") {
      const patient = incomingQueue.find((item) => item.id === ref.incomingId);
      if (!patient) return;

      setDispositions((prev) => [
        dispositionRecord(category, patientFromIncoming(patient), patient.source),
        ...prev,
      ]);
      setIncomingQueue((prev) => prev.filter((item) => item.id !== ref.incomingId));
      return;
    }

    const sourcePod = pods.find((pod) => pod.id === ref.podId);
    const sourceBed = sourcePod?.beds.find((bed) => bed.id === ref.bedId);
    if (!sourcePod || !sourceBed?.bib) return;

    setDispositions((prev) => [
      dispositionRecord(category, patientFromBed(sourceBed), `${sourcePod.name} ${sourceBed.label}`),
      ...prev,
    ]);
    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) =>
          pod.id === ref.podId && bed.id === ref.bedId ? clearBed(bed, "cleaning") : bed,
        ),
      })),
    );
  };

  const clearTurnoverBed = (podId: string, bedId: string) => {
    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) =>
          pod.id === podId && bed.id === bedId ? clearBed(bed, "open") : bed,
        ),
      })),
    );
  };

  const summary = [
    { label: "Current census", value: totals.currentCensus, tone: "text-foreground" },
    { label: "Occupied beds", value: totals.occupiedBeds, tone: "text-status-occupied" },
    { label: "Open beds", value: `${totals.open} / ${totals.totalBeds}`, tone: "text-status-open" },
    { label: "Incoming", value: incomingQueue.length, tone: "text-signal" },
    { label: "Seen today", value: totals.seenToday, tone: "text-foreground" },
  ];

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-3 font-sans text-foreground lg:p-4">
      <header className="grid grid-cols-1 items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Medical Tent 1 - Charge Board
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight">Finish Line Medical</h1>
          </div>
          <div className="flex flex-wrap gap-5 font-mono">
            {summary.map((item) => (
              <div key={item.label}>
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {item.label}
                </div>
                <div className={`text-3xl font-extrabold leading-none ${item.tone}`}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
          <button
            type="button"
            onClick={() => setSetup((enabled) => !enabled)}
            className={`rounded-sm border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              setup
                ? "border-signal bg-signal text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {setup ? "Done" : "Edit layout"}
          </button>
          <div className="flex flex-wrap gap-3 xl:justify-end">
            {(["open", "occupied", "critical", "cleaning"] as BedStatus[]).map((status) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-sm border ${statusTile[status]}`} />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {statusLabel[status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
          <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <span className="size-2 rounded-full bg-status-critical" />
            Incoming
          </h2>
          {incomingQueue.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Incoming queue clear
            </p>
          )}
          {incomingQueue.map((patient) => (
            <IncomingCard
              key={patient.id}
              patient={patient}
              onDragStart={(e) => startDrag({ kind: "incoming", incomingId: patient.id }, e)}
              onDragEnd={() => setDragRef(null)}
            />
          ))}
        </aside>

        <section className="flex min-w-0 flex-col gap-3">
          {setup && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-signal bg-card p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Add pod ({BEDS_PER_POD} open beds)
              </span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. Pod G - Wound Care)"
                className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <input
                value={newZone}
                onChange={(e) => setNewZone(e.target.value)}
                placeholder="Zone / location"
                className="w-44 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Operational note"
                className="w-48 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <button
                type="button"
                onClick={addPod}
                className="rounded-sm border border-signal bg-signal px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
              >
                + Add
              </button>
              <span className="w-full text-[10px] text-muted-foreground">
                In edit mode, patient movement is paused while the tent layout is adjusted.
              </span>
            </div>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {pods.map((pod) => (
              <PodCard
                key={pod.id}
                pod={pod}
                selected={selectedPod === pod.id}
                setup={setup}
                onSelect={() => !setup && setSelectedPod(selectedPod === pod.id ? null : pod.id)}
                onRemove={() => removePod(pod.id)}
                onNoteChange={(note) => updatePodNote(pod.id, note)}
                onPatientDragStart={(bedId, e) => startDrag({ kind: "bed", podId: pod.id, bedId }, e)}
                onPatientDragEnd={() => setDragRef(null)}
                onPatientDrop={(bedId, e) => handleBedDrop(pod.id, bedId, e)}
              />
            ))}
          </div>
          {selected && !setup ? (
            <PodDetail
              pod={selected}
              onClose={() => setSelectedPod(null)}
              onClearBed={(bedId) => clearTurnoverBed(selected.id, bedId)}
              onPatientDragStart={(bedId, e) =>
                startDrag({ kind: "bed", podId: selected.id, bedId }, e)
              }
              onPatientDragEnd={() => setDragRef(null)}
              onPatientDrop={(bedId, e) => handleBedDrop(selected.id, bedId, e)}
            />
          ) : !setup ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Select a pod to see patient cards - drag incoming patients onto any open bed
            </p>
          ) : null}
        </section>

        <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Disposition
          </h2>
          {dispositionCounts.map((category) => (
            <DispositionBucket
              key={category.id}
              category={category}
              dispositions={category.dispositions}
              onDrop={handleDispositionDrop}
            />
          ))}
        </aside>
      </main>
    </div>
  );
}
