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
  cleaning: "bg-status-cleaning/40 border-status-cleaning text-muted-foreground",
};

const statusLabel: Record<BedStatus, string> = {
  open: "Open",
  occupied: "Occupied",
  cleaning: "Cleaning",
};

const triageLabel: Record<Triage, string> = {
  untriaged: "Untriaged",
  immediate: "Red",
  delayed: "Yellow",
  minor: "Green",
};

const triageBadge: Record<Triage, string> = {
  untriaged: "border-muted-foreground/50 bg-muted/40 text-muted-foreground",
  immediate: "border-status-critical bg-status-critical/15 text-status-critical",
  delayed: "border-status-occupied bg-status-occupied/15 text-status-occupied",
  minor: "border-status-open bg-status-open/15 text-status-open",
};

const triageDot: Record<Triage, string> = {
  untriaged: "bg-muted-foreground",
  immediate: "bg-status-critical",
  delayed: "bg-status-occupied",
  minor: "bg-status-open",
};

const incomingTone: Record<Triage, string> = {
  untriaged: "border-l-muted-foreground",
  immediate: "border-l-status-critical",
  delayed: "border-l-status-occupied",
  minor: "border-l-status-open",
};

const triageBedTile: Record<Triage, string> = {
  untriaged: "bg-muted/70 border-muted-foreground/60 text-foreground",
  immediate: "bg-status-critical border-status-critical text-foreground",
  delayed: "bg-status-occupied border-status-occupied text-background",
  minor: "bg-status-open border-status-open text-background",
};

const dispositionTone: Record<DispositionCategory, string> = {
  discharged: "border-muted-foreground/60",
  ems: "border-status-critical/80",
  other: "border-signal/70",
};

const triageOptions: Triage[] = ["untriaged", "immediate", "delayed", "minor"];
const podColorOptions = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"];
const otherComplaintValue = "Other";
const complaintOptions = [
  "Abd Pain",
  "Arm Pain/Inj",
  "Bleeding",
  "Chest Pain",
  "Dif. Breathing",
  "Dizziness",
  "Foot Pain/Inj",
  "Gen. Weakness",
  "Hand Pain/Inj",
  "Head Pain",
  "Heat Exhaustion",
  "Knee Pain/Inj",
  "Laceration",
  "Leg Pain/Inj",
  "Nausea/Vomiting",
  "Near Syncope",
  "Syncope",
  "Unconscious",
  otherComplaintValue,
] as const;

const DRAG_MIME = "application/x-tent-patient";
const PODS_STORAGE_KEY = "tent-board-pods-v3";
const INCOMING_STORAGE_KEY = "tent-board-incoming-v1";
const DISPOSITION_STORAGE_KEY = "tent-board-dispositions-v1";
const EVENT_NAME_STORAGE_KEY = "tent-board-event-name-v1";
const DEFAULT_EVENT_NAME = "Finish Line Medical";

type DragRef =
  { kind: "bed"; podId: string; bedId: string } | { kind: "incoming"; incomingId: string };

type PatientSummary = {
  bib: string;
  triage?: Triage | undefined;
  complaint?: string | undefined;
  operationalStatus?: string | undefined;
};

type EditPatientRef = { podId: string; bedId: string };

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

function loadStoredText(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeBedStatus(status: unknown): BedStatus {
  if (status === "open" || status === "cleaning") return status;
  return "occupied";
}

function normalizeTriage(triage: unknown): Triage {
  if (
    triage === "immediate" ||
    triage === "delayed" ||
    triage === "minor" ||
    triage === "untriaged"
  ) {
    return triage;
  }

  return "untriaged";
}

function normalizeStoredPods(pods: Pod[]): Pod[] {
  return pods.map((pod, index) => ({
    ...pod,
    color:
      typeof pod.color === "string" ? pod.color : podColorOptions[index % podColorOptions.length],
    closed: pod.closed === true,
    capabilities: Array.isArray(pod.capabilities) ? pod.capabilities : [],
    beds: pod.beds.map((bed) => ({
      ...bed,
      status: normalizeBedStatus(bed.status),
      triage: bed.bib ? normalizeTriage(bed.triage) : undefined,
    })),
  }));
}

function normalizeStoredIncoming(incoming: Incoming[]): Incoming[] {
  return incoming.map((patient) => ({
    ...patient,
    triage: normalizeTriage(patient.triage),
  }));
}

function normalizeStoredDispositions(dispositions: Disposition[]): Disposition[] {
  const supported = new Set<DispositionCategory>(
    dispositionCategories.map((category) => category.id),
  );
  return dispositions.filter((item): item is Disposition => supported.has(item.category));
}

function parseCapabilities(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function addCapabilityToList(capabilities: string[], capability: string): string[] {
  const clean = capability.trim();
  if (!clean) return capabilities;

  const exists = capabilities.some((item) => item.toLowerCase() === clean.toLowerCase());
  return exists ? capabilities : [...capabilities, clean];
}

function removeCapabilityFromList(capabilities: string[], capability: string): string[] {
  return capabilities.filter((item) => item !== capability);
}

function complaintOptionFor(value: string) {
  return complaintOptions.find((option) => option.toLowerCase() === value.toLowerCase());
}

function complaintSelectionFor(complaint: string | undefined) {
  const option = complaint ? complaintOptionFor(complaint) : undefined;
  if (option) {
    return { choice: option, other: "" };
  }

  return { choice: complaint ? otherComplaintValue : "", other: complaint ?? "" };
}

function complaintFromSelection(choice: string, other: string) {
  if (choice === otherComplaintValue) return other.trim();
  return choice.trim();
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

function bedTileTone(bed: Bed) {
  if (bed.status === "occupied" && bed.triage) {
    return triageBedTile[bed.triage];
  }

  return statusTile[bed.status];
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
      title={`${bed.label} - ${statusLabel[bed.status]}${
        bed.triage ? ` - ${triageLabel[bed.triage]}` : ""
      }${bed.bib ? ` - #${bed.bib}` : ""}`}
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
      className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-sm border font-mono leading-none ${bedTileTone(bed)} ${
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
  draggable = true,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  patient: PatientSummary;
  locationLabel: string;
  title: string;
  draggable?: boolean;
  onEdit?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      title={title}
      className={`flex items-center gap-3 rounded-md border bg-secondary/40 px-3 py-2.5 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
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
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="shrink-0 rounded-sm border border-signal bg-signal px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
        >
          Edit
        </button>
      )}
    </div>
  );
}

function ComplaintField({
  choice,
  other,
  onChoiceChange,
  onOtherChange,
}: {
  choice: string;
  other: string;
  onChoiceChange: (value: string) => void;
  onOtherChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <select
        value={choice}
        onChange={(e) => onChoiceChange(e.target.value)}
        aria-label="Chief complaint"
        className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-signal"
        required
      >
        <option value="">Chief complaint</option>
        {complaintOptions.map((complaint) => (
          <option key={complaint} value={complaint}>
            {complaint}
          </option>
        ))}
      </select>
      {choice === otherComplaintValue && (
        <input
          value={other}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Enter complaint"
          className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
          required
        />
      )}
    </div>
  );
}

function IncomingCard({
  patient,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  patient: Incoming;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className={`rounded-r-sm border-l-2 bg-secondary/40 p-2 ${incomingTone[patient.triage]}`}>
      <PatientCard
        patient={patientFromIncoming(patient)}
        locationLabel={patient.eta ? `ETA ${patient.eta}` : "Incoming"}
        title={
          draggable
            ? "Drag to an open bed or disposition bucket"
            : "Patient movement paused in edit layout"
        }
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      {patient.source && (
        <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">{patient.source}</p>
      )}
    </div>
  );
}

function podCounts(pod: Pod) {
  const open = pod.closed ? 0 : pod.beds.filter((b) => b.status === "open").length;
  const immediate = pod.beds.filter((b) => b.bib && b.triage === "immediate").length;
  return { open, immediate, total: pod.beds.length };
}

function PodCard({
  pod,
  selected,
  setup,
  onSelect,
  onRemove,
  onNoteChange,
  onColorChange,
  onClosedChange,
  onCapabilityAdd,
  onCapabilityRemove,
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
  onColorChange: (color: string) => void;
  onClosedChange: (closed: boolean) => void;
  onCapabilityAdd: (capability: string) => void;
  onCapabilityRemove: (capability: string) => void;
  onPatientDragStart: (bedId: string, e: React.DragEvent) => void;
  onPatientDragEnd: () => void;
  onPatientDrop: (bedId: string, e: React.DragEvent) => void;
}) {
  const { open, immediate, total } = podCounts(pod);
  const [capabilityDraft, setCapabilityDraft] = useState("");

  const addCapability = () => {
    const capability = capabilityDraft.trim();
    if (!capability) return;

    onCapabilityAdd(capability);
    setCapabilityDraft("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        style={{ borderLeftColor: pod.color, borderLeftWidth: 5 }}
        className={`flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors ${
          selected
            ? "border-signal ring-1 ring-signal"
            : "border-border hover:border-muted-foreground"
        }`}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight">{pod.name}</h3>
            <p className="truncate text-[10px] font-medium text-muted-foreground">{pod.zone}</p>
            {pod.note && (
              <p className="mt-1 truncate text-[10px] font-semibold text-signal">{pod.note}</p>
            )}
            {pod.closed && (
              <span className="mt-1 inline-flex rounded-sm border border-status-critical bg-status-critical/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-status-critical">
                Closed
              </span>
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
            <div className="text-[9px] font-bold uppercase text-muted-foreground">
              open / {total}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {pod.beds.map((bed) => (
            <BedTile
              key={bed.id}
              bed={bed}
              draggable={!setup && !!bed.bib}
              dropTarget={!setup && !pod.closed && bed.status === "open"}
              className={pod.closed && !bed.bib ? "opacity-35" : ""}
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
          {pod.closed ? (
            <span className="shrink-0 rounded-sm bg-status-critical/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-status-critical">
              closed
            </span>
          ) : immediate > 0 ? (
            <span className="shrink-0 rounded-sm bg-status-critical/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-status-critical">
              {immediate} red
            </span>
          ) : null}
        </div>
      </button>
      {setup && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
          <input
            type="color"
            value={pod.color}
            onChange={(e) => onColorChange(e.target.value)}
            title="Pod color"
            className="size-8 shrink-0 rounded-sm border border-border bg-background p-1"
          />
          <input
            value={pod.note ?? ""}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Short pod note"
            className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
          />
          <button
            type="button"
            onClick={() => onClosedChange(!pod.closed)}
            title={pod.closed ? "Reopen pod" : "Close pod"}
            className={`h-8 shrink-0 rounded-sm border px-2 text-[10px] font-bold uppercase tracking-widest ${
              pod.closed
                ? "border-status-open bg-status-open text-background hover:opacity-90"
                : "border-status-critical bg-status-critical text-foreground hover:opacity-90"
            }`}
          >
            {pod.closed ? "Open" : "Close"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove pod"
            className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-status-critical bg-status-critical text-sm font-bold leading-none text-foreground hover:opacity-80"
          >
            x
          </button>
          <div className="flex min-w-0 flex-col gap-2 rounded-sm border border-border bg-background/60 p-2 sm:col-span-4">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {pod.capabilities.length === 0 && (
                <span className="text-[10px] font-semibold uppercase tracking-tight text-muted-foreground">
                  No capabilities
                </span>
              )}
              {pod.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-muted-foreground"
                >
                  <span className="truncate">{capability}</span>
                  <button
                    type="button"
                    onClick={() => onCapabilityRemove(capability)}
                    title={`Remove ${capability}`}
                    className="font-mono text-xs font-bold leading-none text-status-critical hover:opacity-70"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                value={capabilityDraft}
                onChange={(e) => setCapabilityDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCapability();
                  }
                }}
                placeholder="Add capability"
                className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <button
                type="button"
                onClick={addCapability}
                className="rounded-sm border border-signal bg-signal px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PodDetail({
  pod,
  onClose,
  onClearBed,
  onEditPatient,
  onPatientDragStart,
  onPatientDragEnd,
  onPatientDrop,
}: {
  pod: Pod;
  onClose: () => void;
  onClearBed: (bedId: string) => void;
  onEditPatient: (podId: string, bed: Bed) => void;
  onPatientDragStart: (bedId: string, e: React.DragEvent) => void;
  onPatientDragEnd: () => void;
  onPatientDrop: (bedId: string, e: React.DragEvent) => void;
}) {
  const { open, total } = podCounts(pod);
  const patients = pod.beds.filter((bed) => bed.bib);
  const openBeds = pod.closed ? [] : pod.beds.filter((bed) => bed.status === "open");
  const cleaningBeds = pod.beds.filter((bed) => bed.status === "cleaning");

  return (
    <section
      style={{ borderLeftColor: pod.color, borderLeftWidth: 5 }}
      className="flex flex-col gap-3 rounded-lg border border-signal bg-card p-4"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight">{pod.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            {pod.zone} -{" "}
            {pod.closed
              ? "closed to new assignments"
              : "drag a patient card onto any open bed to move them"}
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
        {pod.closed && (
          <div>
            <div className="text-[9px] font-bold uppercase text-muted-foreground">Pod status</div>
            <div className="text-xs font-bold uppercase tracking-widest text-status-critical">
              Closed
            </div>
          </div>
        )}
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
            onEdit={() => onEditPatient(pod.id, bed)}
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
  disabled,
  onDrop,
}: {
  category: (typeof dispositionCategories)[number];
  dispositions: Disposition[];
  disabled: boolean;
  onDrop: (category: DispositionCategory, e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        onDrop(category.id, e);
      }}
      className={`rounded-md border bg-card/70 p-2.5 ${dispositionTone[category.id]} ${
        over ? "ring-2 ring-signal bg-signal/10" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-left"
      >
        <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {category.label}
        </span>
        <span className="font-mono text-xl font-extrabold leading-none text-foreground">
          {dispositions.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {dispositions.length === 0 && (
            <p className="rounded-sm border border-dashed border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-tight text-muted-foreground">
              Drop here
            </p>
          )}
          {dispositions.map((item) => (
            <div
              key={item.id}
              className="border-t border-border pt-1.5 first:border-t-0 first:pt-0"
            >
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
      )}
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
  const [eventName, setEventName] = useState(DEFAULT_EVENT_NAME);
  const [currentClock, setCurrentClock] = useState("--:--");
  const [hydrated, setHydrated] = useState(false);
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newCapabilities, setNewCapabilities] = useState("");
  const [newColor, setNewColor] = useState(podColorOptions[0]);
  const [newPodCount, setNewPodCount] = useState("1");
  const [addingPatient, setAddingPatient] = useState(false);
  const [newPatientBib, setNewPatientBib] = useState("");
  const [newPatientTriage, setNewPatientTriage] = useState<Triage>("untriaged");
  const [newPatientComplaintChoice, setNewPatientComplaintChoice] = useState("");
  const [newPatientOtherComplaint, setNewPatientOtherComplaint] = useState("");
  const [newPatientStatus, setNewPatientStatus] = useState("");
  const [newPatientSource, setNewPatientSource] = useState("");
  const [newPatientEta, setNewPatientEta] = useState("");
  const [newPatientAssignPod, setNewPatientAssignPod] = useState("");
  const [newPatientMessage, setNewPatientMessage] = useState("");
  const [editPatient, setEditPatient] = useState<EditPatientRef | null>(null);
  const [editPatientBib, setEditPatientBib] = useState("");
  const [editPatientTriage, setEditPatientTriage] = useState<Triage>("untriaged");
  const [editPatientComplaintChoice, setEditPatientComplaintChoice] = useState("");
  const [editPatientOtherComplaint, setEditPatientOtherComplaint] = useState("");
  const [editPatientStatus, setEditPatientStatus] = useState("");
  const [editPatientPod, setEditPatientPod] = useState("");
  const [editPatientMessage, setEditPatientMessage] = useState("");
  const [dragRef, setDragRef] = useState<DragRef | null>(null);
  const [layoutMessage, setLayoutMessage] = useState("");

  useEffect(() => {
    setPods(normalizeStoredPods(loadStoredArray(PODS_STORAGE_KEY, initialPods)));
    setIncomingQueue(
      normalizeStoredIncoming(loadStoredArray(INCOMING_STORAGE_KEY, initialIncoming)),
    );
    setDispositions(
      normalizeStoredDispositions(loadStoredArray(DISPOSITION_STORAGE_KEY, initialDispositions)),
    );
    setEventName(loadStoredText(EVENT_NAME_STORAGE_KEY, DEFAULT_EVENT_NAME));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PODS_STORAGE_KEY, JSON.stringify(pods));
    localStorage.setItem(INCOMING_STORAGE_KEY, JSON.stringify(incomingQueue));
    localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(dispositions));
    localStorage.setItem(EVENT_NAME_STORAGE_KEY, eventName);
  }, [dispositions, eventName, hydrated, incomingQueue, pods]);

  useEffect(() => {
    setCurrentClock(formatBoardTime());
    const timer = window.setInterval(() => setCurrentClock(formatBoardTime()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const totals = useMemo(() => {
    const all = pods.flatMap((pod) => pod.beds);
    const activeBeds = pods.filter((pod) => !pod.closed).flatMap((pod) => pod.beds);
    const currentCensus = all.filter((bed) => bed.bib).length;
    const occupiedBeds = all.filter((bed) => bed.status === "occupied").length;

    return {
      currentCensus,
      occupiedBeds,
      open: activeBeds.filter((bed) => bed.status === "open").length,
      totalBeds: activeBeds.length,
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
    const count = Math.max(1, Math.min(Number.parseInt(newPodCount, 10) || 1, 12));
    const baseName = newName.trim();
    const capabilities = parseCapabilities(newCapabilities);
    const nextPods = [...pods];
    const addedPods: Pod[] = [];

    for (let i = 0; i < count; i += 1) {
      const id = nextPodId(nextPods);
      const name = baseName ? (count > 1 ? `${baseName} ${id}` : baseName) : `Pod ${id}`;
      const pod = emptyPod(id, name, newZone.trim() || "Unassigned zone", newNote.trim(), newColor);
      pod.capabilities = capabilities;
      nextPods.push(pod);
      addedPods.push(pod);
    }

    setPods(nextPods);
    setLayoutMessage("");
    setNewName("");
    setNewZone("");
    setNewNote("");
    setNewCapabilities("");
    setNewPodCount("1");
    setNewColor(podColorOptions[nextPods.length % podColorOptions.length]);
    if (addedPods.length > 0) setSelectedPod(addedPods[0].id);
  };

  const resetPatientForm = () => {
    setNewPatientBib("");
    setNewPatientTriage("untriaged");
    setNewPatientComplaintChoice("");
    setNewPatientOtherComplaint("");
    setNewPatientStatus("");
    setNewPatientSource("");
    setNewPatientEta("");
    setNewPatientAssignPod("");
  };

  const addIncomingPatient = (e: React.FormEvent) => {
    e.preventDefault();

    const bib = newPatientBib.trim();
    const complaint = complaintFromSelection(newPatientComplaintChoice, newPatientOtherComplaint);
    if (!bib || !complaint) return;
    setNewPatientMessage("");

    const patient: Incoming = {
      id: `${Date.now()}-${bib}`,
      bib,
      triage: newPatientTriage,
      complaint,
      operationalStatus: newPatientStatus.trim() || undefined,
      source: newPatientSource.trim() || undefined,
      eta: newPatientEta.trim() || undefined,
    };

    if (newPatientAssignPod) {
      const targetPod = pods.find((pod) => pod.id === newPatientAssignPod);
      const targetBed = targetPod?.closed
        ? undefined
        : targetPod?.beds.find((bed) => bed.status === "open");

      if (targetPod && targetBed) {
        setPods((prev) =>
          prev.map((pod) => ({
            ...pod,
            beds: pod.beds.map((bed) =>
              pod.id === targetPod.id && bed.id === targetBed.id
                ? {
                    ...bed,
                    status: "occupied",
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
        setSelectedPod(targetPod.id);
        resetPatientForm();
        setAddingPatient(false);
        return;
      }

      setNewPatientMessage(
        "Selected pod is closed or has no open beds. Patient was left in Incoming.",
      );
    }

    setIncomingQueue((prev) => [patient, ...prev]);
    resetPatientForm();
    setAddingPatient(false);
  };

  const removePod = (id: string) => {
    const pod = pods.find((item) => item.id === id);
    if (!pod) return;

    if (pod.beds.some((bed) => bed.bib)) {
      setLayoutMessage(
        `${pod.name} contains active patients. Move or disposition them before removing this pod.`,
      );
      return;
    }

    const confirmed = window.confirm(`Remove ${pod.name} from the layout?`);
    if (!confirmed) return;

    setPods((prev) => prev.filter((pod) => pod.id !== id));
    if (selectedPod === id) setSelectedPod(null);
    setLayoutMessage(`${pod.name} removed from layout.`);
  };

  const updatePodNote = (id: string, note: string) => {
    setPods((prev) => prev.map((pod) => (pod.id === id ? { ...pod, note } : pod)));
  };

  const updatePodColor = (id: string, color: string) => {
    setPods((prev) => prev.map((pod) => (pod.id === id ? { ...pod, color } : pod)));
  };

  const updatePodClosed = (id: string, closed: boolean) => {
    setPods((prev) => prev.map((pod) => (pod.id === id ? { ...pod, closed } : pod)));
    setLayoutMessage(closed ? "Pod closed to new assignments." : "Pod reopened.");
  };

  const addPodCapability = (id: string, capability: string) => {
    setPods((prev) =>
      prev.map((pod) =>
        pod.id === id
          ? { ...pod, capabilities: addCapabilityToList(pod.capabilities, capability) }
          : pod,
      ),
    );
  };

  const removePodCapability = (id: string, capability: string) => {
    setPods((prev) =>
      prev.map((pod) =>
        pod.id === id
          ? { ...pod, capabilities: removeCapabilityFromList(pod.capabilities, capability) }
          : pod,
      ),
    );
  };

  const startPatientEdit = (podId: string, bed: Bed) => {
    if (!bed.bib) return;
    const complaint = complaintSelectionFor(bed.complaint);
    setEditPatient({ podId, bedId: bed.id });
    setEditPatientBib(bed.bib);
    setEditPatientTriage(bed.triage ?? "untriaged");
    setEditPatientComplaintChoice(complaint.choice);
    setEditPatientOtherComplaint(complaint.other);
    setEditPatientStatus(bed.operationalStatus ?? "");
    setEditPatientPod(podId);
    setEditPatientMessage("");
  };

  const cancelPatientEdit = () => {
    setEditPatient(null);
    setEditPatientMessage("");
  };

  const savePatientEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPatient) return;

    const currentPod = pods.find((pod) => pod.id === editPatient.podId);
    const currentBed = currentPod?.beds.find((bed) => bed.id === editPatient.bedId);
    const targetPod = pods.find((pod) => pod.id === editPatientPod);
    if (!currentPod || !currentBed?.bib || !targetPod) return;

    const updated = {
      bib: editPatientBib.trim() || currentBed.bib,
      triage: editPatientTriage,
      complaint:
        complaintFromSelection(editPatientComplaintChoice, editPatientOtherComplaint) || undefined,
      operationalStatus: editPatientStatus.trim() || undefined,
    };

    if (editPatientPod !== editPatient.podId) {
      if (targetPod.closed) {
        setEditPatientMessage(`${targetPod.name} is closed to new assignments.`);
        return;
      }

      const targetBed = targetPod.beds.find((bed) => bed.status === "open");
      if (!targetBed) {
        setEditPatientMessage(`${targetPod.name} has no open beds.`);
        return;
      }

      setPods((prev) =>
        prev.map((pod) => ({
          ...pod,
          beds: pod.beds.map((bed) => {
            if (pod.id === editPatient.podId && bed.id === editPatient.bedId) {
              return clearBed(bed, "open");
            }
            if (pod.id === targetPod.id && bed.id === targetBed.id) {
              return {
                ...bed,
                status: "occupied",
                since: currentBed.since ?? formatBoardTime(),
                ...updated,
              };
            }
            return bed;
          }),
        })),
      );
      setSelectedPod(targetPod.id);
      cancelPatientEdit();
      return;
    }

    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) =>
          pod.id === editPatient.podId && bed.id === editPatient.bedId
            ? { ...bed, ...updated }
            : bed,
        ),
      })),
    );
    cancelPatientEdit();
  };

  const clearPatientState = () => {
    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) => clearBed(bed, "open")),
      })),
    );
    setIncomingQueue([]);
    setDispositions([]);
    setSelectedPod(null);
    setEditPatient(null);
    setDragRef(null);
  };

  const clearPatientData = () => {
    const confirmed = window.confirm(
      "Clear patient data? This removes active patients, incoming queue, and disposition counts. Pod layout and event name will stay.",
    );
    if (!confirmed) return;

    clearPatientState();
  };

  const clearRace = () => {
    const confirmed = window.confirm(
      "Clear this race? This removes patient data and resets the event name. Pod layout, colors, capabilities, and closed/open pod settings will stay.",
    );
    if (!confirmed) return;

    clearPatientState();
    setEventName(DEFAULT_EVENT_NAME);
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
    if (!targetPod || targetPod.closed || targetBed?.status !== "open") return;

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
                  status: "occupied",
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
              status: "occupied",
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
        dispositionRecord(category, patientFromIncoming(patient), patient.source ?? "Incoming"),
        ...prev,
      ]);
      setIncomingQueue((prev) => prev.filter((item) => item.id !== ref.incomingId));
      return;
    }

    const sourcePod = pods.find((pod) => pod.id === ref.podId);
    const sourceBed = sourcePod?.beds.find((bed) => bed.id === ref.bedId);
    if (!sourcePod || !sourceBed?.bib) return;

    setDispositions((prev) => [
      dispositionRecord(
        category,
        patientFromBed(sourceBed),
        `${sourcePod.name} ${sourceBed.label}`,
      ),
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
    { label: "Current time", value: currentClock, tone: "text-signal" },
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
            <input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              className="w-full min-w-0 rounded-sm border border-transparent bg-transparent px-0 py-0 text-lg font-semibold tracking-tight outline-none hover:border-border focus:border-signal"
            />
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
                : "border-signal bg-signal px-3 py-1.5 text-background hover:opacity-90"
            }`}
          >
            {setup ? "Done" : "Edit layout"}
          </button>
          <button
            type="button"
            onClick={clearPatientData}
            className="rounded-sm border border-status-occupied px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-status-occupied hover:bg-status-occupied hover:text-background"
          >
            Clear patient data
          </button>
          <button
            type="button"
            onClick={clearRace}
            className="rounded-sm border border-status-critical px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-status-critical hover:bg-status-critical hover:text-foreground"
          >
            Clear race
          </button>
          <div className="flex flex-wrap gap-3 xl:justify-end">
            {(["open", "cleaning"] as BedStatus[]).map((status) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-sm border ${statusTile[status]}`} />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {statusLabel[status]}
                </span>
              </div>
            ))}
            {triageOptions.map((triage) => (
              <div key={triage} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-sm border ${triageBedTile[triage]}`} />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {triageLabel[triage]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span className="size-2 rounded-full bg-status-critical" />
              Incoming
            </h2>
            <button
              type="button"
              onClick={() => setAddingPatient((open) => !open)}
              className="rounded-sm border border-signal bg-signal px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
            >
              New Patient
            </button>
          </div>
          {newPatientMessage && (
            <p className="rounded-sm border border-signal/60 bg-signal/10 px-2 py-1 text-[11px] font-semibold text-foreground">
              {newPatientMessage}
            </p>
          )}
          {addingPatient && (
            <form
              onSubmit={addIncomingPatient}
              className="flex flex-col gap-2 rounded-md border border-signal/60 bg-card p-2"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                <input
                  value={newPatientBib}
                  onChange={(e) => setNewPatientBib(e.target.value)}
                  placeholder="Race #"
                  className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                  required
                />
                <select
                  value={newPatientTriage}
                  onChange={(e) => setNewPatientTriage(e.target.value as Triage)}
                  aria-label="Triage"
                  className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
                >
                  {triageOptions.map((triage) => (
                    <option key={triage} value={triage}>
                      {triageLabel[triage]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-sm border border-border bg-background/60 p-2">
                <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Assign Pod
                </label>
                <select
                  value={newPatientAssignPod}
                  onChange={(e) => setNewPatientAssignPod(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
                >
                  <option value="">Incoming queue</option>
                  {pods.map((pod) => {
                    const open = pod.closed
                      ? 0
                      : pod.beds.filter((bed) => bed.status === "open").length;
                    return (
                      <option key={pod.id} value={pod.id} disabled={pod.closed || open === 0}>
                        {pod.name} {pod.closed ? "(closed)" : `(${open} open)`}
                      </option>
                    );
                  })}
                </select>
              </div>
              <ComplaintField
                choice={newPatientComplaintChoice}
                other={newPatientOtherComplaint}
                onChoiceChange={setNewPatientComplaintChoice}
                onOtherChange={setNewPatientOtherComplaint}
              />
              <input
                value={newPatientStatus}
                onChange={(e) => setNewPatientStatus(e.target.value)}
                placeholder="Operational status"
                className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
                <input
                  value={newPatientSource}
                  onChange={(e) => setNewPatientSource(e.target.value)}
                  placeholder="Source"
                  className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                />
                <input
                  value={newPatientEta}
                  onChange={(e) => setNewPatientEta(e.target.value)}
                  placeholder="ETA"
                  className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="submit"
                  className="rounded-sm border border-status-open bg-status-open px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetPatientForm();
                    setNewPatientMessage("");
                    setAddingPatient(false);
                  }}
                  className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {incomingQueue.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Incoming queue clear
            </p>
          )}
          {incomingQueue.map((patient) => (
            <IncomingCard
              key={patient.id}
              patient={patient}
              draggable={!setup}
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
              <input
                value={newCapabilities}
                onChange={(e) => setNewCapabilities(e.target.value)}
                placeholder="Capabilities"
                className="w-48 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <input
                type="number"
                min={1}
                max={12}
                value={newPodCount}
                onChange={(e) => setNewPodCount(e.target.value)}
                aria-label="Number of pods"
                className="w-20 rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
              />
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                title="Pod color"
                className="size-8 rounded-sm border border-border bg-background p-1"
              />
              <button
                type="button"
                onClick={addPod}
                className="rounded-sm border border-signal bg-signal px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
              >
                Add pod
              </button>
              <span className="w-full text-[10px] text-muted-foreground">
                In edit mode, patient movement is paused while the tent layout is adjusted.
              </span>
              {layoutMessage && (
                <span className="w-full rounded-sm border border-signal/60 bg-signal/10 px-2 py-1.5 text-[11px] font-semibold text-foreground">
                  {layoutMessage}
                </span>
              )}
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
                onColorChange={(color) => updatePodColor(pod.id, color)}
                onClosedChange={(closed) => updatePodClosed(pod.id, closed)}
                onCapabilityAdd={(capability) => addPodCapability(pod.id, capability)}
                onCapabilityRemove={(capability) => removePodCapability(pod.id, capability)}
                onPatientDragStart={(bedId, e) =>
                  startDrag({ kind: "bed", podId: pod.id, bedId }, e)
                }
                onPatientDragEnd={() => setDragRef(null)}
                onPatientDrop={(bedId, e) => handleBedDrop(pod.id, bedId, e)}
              />
            ))}
          </div>
          {editPatient && !setup && (
            <form
              onSubmit={savePatientEdit}
              className="grid gap-2 rounded-lg border border-signal bg-card p-3 md:grid-cols-[100px_120px_minmax(0,1.15fr)_minmax(0,1fr)_180px_auto]"
            >
              <div className="md:col-span-6">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Edit Patient
                </div>
              </div>
              <input
                value={editPatientBib}
                onChange={(e) => setEditPatientBib(e.target.value)}
                placeholder="Race #"
                className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                required
              />
              <select
                value={editPatientTriage}
                onChange={(e) => setEditPatientTriage(e.target.value as Triage)}
                aria-label="Triage"
                className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
              >
                {triageOptions.map((triage) => (
                  <option key={triage} value={triage}>
                    {triageLabel[triage]}
                  </option>
                ))}
              </select>
              <ComplaintField
                choice={editPatientComplaintChoice}
                other={editPatientOtherComplaint}
                onChoiceChange={setEditPatientComplaintChoice}
                onOtherChange={setEditPatientOtherComplaint}
              />
              <input
                value={editPatientStatus}
                onChange={(e) => setEditPatientStatus(e.target.value)}
                placeholder="Operational status"
                className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <select
                value={editPatientPod}
                onChange={(e) => setEditPatientPod(e.target.value)}
                aria-label="Move to pod"
                className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
              >
                {pods.map((pod) => {
                  const open = pod.closed
                    ? 0
                    : pod.beds.filter((bed) => bed.status === "open").length;
                  const current = editPatient.podId === pod.id;
                  return (
                    <option
                      key={pod.id}
                      value={pod.id}
                      disabled={!current && (pod.closed || open === 0)}
                    >
                      {pod.name}{" "}
                      {current ? "(current)" : pod.closed ? "(closed)" : `(${open} open)`}
                    </option>
                  );
                })}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="submit"
                  className="rounded-sm border border-status-open bg-status-open px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelPatientEdit}
                  className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              {editPatientMessage && (
                <p className="md:col-span-6 rounded-sm border border-signal/60 bg-signal/10 px-2 py-1.5 text-[11px] font-semibold text-foreground">
                  {editPatientMessage}
                </p>
              )}
            </form>
          )}
          {selected && !setup ? (
            <PodDetail
              pod={selected}
              onClose={() => setSelectedPod(null)}
              onClearBed={(bedId) => clearTurnoverBed(selected.id, bedId)}
              onEditPatient={startPatientEdit}
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
              disabled={setup}
              onDrop={handleDispositionDrop}
            />
          ))}
        </aside>
      </main>
    </div>
  );
}
