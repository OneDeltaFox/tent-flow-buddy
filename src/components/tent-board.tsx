import { useEffect, useMemo, useState } from "react";
import { Pencil, Settings, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PatientMovement, PatientSurface, PatientDropTarget } from "@/components/patient-movement";
import type { PatientRef } from "@/components/patient-movement";
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
  numberPodBeds,
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

const PODS_STORAGE_KEY = "tent-board-pods-v3";
const INCOMING_STORAGE_KEY = "tent-board-incoming-v1";
const DISPOSITION_STORAGE_KEY = "tent-board-dispositions-v1";
const EVENT_NAME_STORAGE_KEY = "tent-board-event-name-v1";
const DEFAULT_EVENT_NAME = "Finish Line Medical";

type PatientSummary = {
  bib: string;
  triage?: Triage | undefined;
  complaint?: string | undefined;
  operationalStatus?: string | undefined;
};

type EditPatientRef =
  { kind: "bed"; podId: string; bedId: string } | { kind: "incoming"; incomingId: string };

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
  return numberPodBeds(pods).map((pod, index) => ({
    ...pod,
    color:
      typeof pod.color === "string" ? pod.color : podColorOptions[index % podColorOptions.length]!,
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
  podId,
  disabled = false,
  className = "",
  onEdit,
}: {
  bed: Bed;
  podId: string;
  disabled?: boolean;
  className?: string;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <PatientDropTarget
      target={
        !disabled && bed.status === "open" ? { kind: "bed", podId, bedId: bed.id } : undefined
      }
      className="min-w-0 rounded-sm"
    >
      <PatientSurface
        source={!disabled && bed.bib ? { kind: "bed", podId, bedId: bed.id } : undefined}
        bib={bed.bib}
        onEdit={onEdit}
        className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-sm border px-1 py-2 font-mono ${bedTileTone(bed)} ${className}`}
      >
        <span
          title={bed.bib ? `#${bed.bib}` : bed.label}
          className="block w-full truncate text-center text-xs font-bold"
        >
          {bed.bib ?? (bed.status === "cleaning" ? "CLR" : bed.label)}
        </span>
      </PatientSurface>
    </PatientDropTarget>
  );
}

function PatientCard({
  patient,
  locationLabel,
  source,
  onEdit,
}: {
  patient: PatientSummary;
  locationLabel: string;
  source?: PatientRef | undefined;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <PatientSurface
      source={source}
      bib={patient.bib}
      onEdit={onEdit}
      className={`flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 ${triageBedTile[patient.triage ?? "untriaged"]}`}
    >
      <span className="max-w-full break-all font-mono text-lg font-extrabold">#{patient.bib}</span>
      <div className="min-w-0 flex-1 basis-24">
        <p className="break-words text-sm font-semibold">
          {patient.complaint || "Needs placement"}
        </p>
        <p className="text-xs">{triageLabel[patient.triage ?? "untriaged"]}</p>
        {patient.operationalStatus && (
          <p className="break-words text-xs">{patient.operationalStatus}</p>
        )}
      </div>
      <span className="font-mono text-[10px]">{locationLabel}</span>
    </PatientSurface>
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
      <label>
        Chief complaint
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
      </label>
      {choice === otherComplaintValue && (
        <label>
          Other complaint
          <input
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="Enter complaint"
            className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
            required
          />
        </label>
      )}
    </div>
  );
}

function IncomingCard({
  patient,
  disabled,
  onEdit,
}: {
  patient: Incoming;
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="min-w-0">
      <PatientCard
        patient={patientFromIncoming(patient)}
        locationLabel={patient.eta ? `ETA ${patient.eta}` : "Incoming"}
        source={disabled ? undefined : { kind: "incoming", incomingId: patient.id }}
        onEdit={disabled ? undefined : onEdit}
      />
      {patient.source && (
        <p className="mt-1 truncate text-xs text-muted-foreground">{patient.source}</p>
      )}
    </div>
  );
}

function podCounts(pod: Pod) {
  return {
    open: pod.closed ? 0 : pod.beds.filter((bed) => bed.status === "open").length,
    total: pod.beds.length,
  };
}

function PodCard({
  pod,
  selected,
  setup,
  onSelect,
  onEdit,
  onEditPatient,
}: {
  pod: Pod;
  selected: boolean;
  setup: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onEditPatient: (podId: string, bed: Bed) => void;
}) {
  const { open, total } = podCounts(pod);
  return (
    <article
      style={{ borderLeftColor: pod.color, borderLeftWidth: 4 }}
      className={`min-w-0 rounded-md border bg-card p-2 sm:p-3 ${selected ? "border-signal" : "border-border"}`}
    >
      <div className="mb-2 flex min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          className="min-h-11 min-w-0 flex-1 text-left"
        >
          <h3 className="break-words text-xs font-semibold sm:text-sm">{pod.name}</h3>
          <p className="text-[10px] text-muted-foreground">
            {pod.closed
              ? "Closed"
              : `${total - pod.beds.filter((bed) => !bed.bib).length}/${total} occupied · ${open} open`}
          </p>
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${pod.name}`}
          title={`Edit ${pod.name}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-signal text-background"
        >
          <Pencil size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {pod.beds.map((bed) => (
          <BedTile
            key={bed.id}
            bed={bed}
            podId={pod.id}
            disabled={setup || (!!pod.closed && !bed.bib)}
            className={pod.closed && !bed.bib ? "opacity-35" : ""}
            onEdit={!setup && bed.bib ? () => onEditPatient(pod.id, bed) : undefined}
          />
        ))}
      </div>
      <div className="mt-2 hidden min-w-0 text-xs text-muted-foreground sm:block">
        {pod.zone && <p className="truncate">{pod.zone}</p>}
        {pod.note && <p className="truncate text-signal">{pod.note}</p>}
        {pod.capabilities.length > 0 && <p className="truncate">{pod.capabilities.join(", ")}</p>}
      </div>
    </article>
  );
}

function PodEditor({
  pod,
  onSave,
  onClose,
  onRemove,
}: {
  pod: Pod;
  onSave: (pod: Pod) => void;
  onClose: () => void;
  onRemove: () => boolean;
}) {
  const [draft, setDraft] = useState(pod);
  const [capability, setCapability] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(pod) || !!capability.trim();
  const close = () => {
    if (!dirty || window.confirm("Discard unsaved pod changes?")) onClose();
  };
  const addCapability = () => {
    setDraft({ ...draft, capabilities: addCapabilityToList(draft.capabilities, capability) });
    setCapability("");
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="board-modal">
        <DialogTitle>Edit pod</DialogTitle>
        <DialogDescription className="sr-only">Pod settings</DialogDescription>
        <form
          className="editor-form grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim()) return;
            onSave({
              ...draft,
              name: draft.name.trim(),
              capabilities: addCapabilityToList(draft.capabilities, capability),
            });
          }}
        >
          <label>
            Pod name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            Zone / location
            <input
              value={draft.zone}
              onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
            />
          </label>
          <label>
            Operational note
            <input
              value={draft.note ?? ""}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <label>
              Pod color
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!draft.closed}
                onChange={(e) => setDraft({ ...draft, closed: e.target.checked })}
              />
              Closed to new assignments
            </label>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm">Capabilities</legend>
            <div className="mb-2 flex flex-wrap gap-2">
              {draft.capabilities.map((item) => (
                <span
                  key={item}
                  className="inline-flex max-w-full items-center rounded-sm border pl-2 text-sm"
                >
                  <span className="break-all">{item}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    title={`Remove ${item}`}
                    className="flex size-11 shrink-0 items-center justify-center text-status-critical"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        capabilities: removeCapabilityFromList(draft.capabilities, item),
                      })
                    }
                  >
                    <X size={16} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                aria-label="New capability"
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCapability();
                  }
                }}
              />
              <button type="button" onClick={addCapability} className="border px-3">
                Add
              </button>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-sm bg-signal px-4 text-background">
              Save
            </button>
            <button type="button" onClick={close} className="rounded-sm border px-4">
              Cancel
            </button>
            <button
              type="button"
              disabled={pod.beds.some((bed) => !!bed.bib)}
              onClick={() => {
                if (onRemove()) onClose();
              }}
              className="ml-auto flex items-center gap-2 rounded-sm border border-status-critical px-3 text-status-critical disabled:opacity-40"
            >
              <Trash2 size={16} />
              Remove pod
            </button>
          </div>
          {pod.beds.some((bed) => !!bed.bib) && (
            <p className="text-xs text-muted-foreground">
              Move or disposition active patients before removing this pod.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PodDetail({
  pod,
  onClose,
  onClearBed,
  onEditPatient,
}: {
  pod: Pod;
  onClose: () => void;
  onClearBed: (bedId: string) => void;
  onEditPatient: (podId: string, bed: Bed) => void;
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
            {pod.zone} - {pod.closed ? "closed to new assignments" : `${open} open beds`}
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
            <div className="text-[9px] font-bold uppercase text-muted-foreground">Open beds</div>
            <div className="mt-1 flex gap-1.5">
              {openBeds.map((bed) => (
                <BedTile key={bed.id} bed={bed} podId={pod.id} className="w-11" />
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
            onEdit={() => onEditPatient(pod.id, bed)}
            source={{ kind: "bed", podId: pod.id, bedId: bed.id }}
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
}: {
  category: (typeof dispositionCategories)[number];
  dispositions: Disposition[];
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <PatientDropTarget
      target={disabled ? undefined : { kind: "disposition", category: category.id }}
      className={`min-w-0 rounded-md border bg-card/70 p-2.5 ${expanded ? "col-span-3" : ""} ${dispositionTone[category.id]}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-left"
      >
        <span className="break-words text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
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
    </PatientDropTarget>
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
  const [editingPod, setEditingPod] = useState<string | null>(null);
  const [incomingExpanded, setIncomingExpanded] = useState(false);
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
      const number = Math.max(0, ...nextPods.map((pod) => pod.number ?? 0)) + 1;
      const name = baseName ? (count > 1 ? `${baseName} ${number}` : baseName) : `Pod ${number}`;
      const pod = emptyPod(
        id,
        name,
        newZone.trim() || "Unassigned zone",
        newNote.trim(),
        newColor,
        number,
      );
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
    if (addedPods[0]) setSelectedPod(addedPods[0].id);
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
    if (!pod) return false;

    if (pod.beds.some((bed) => bed.bib)) {
      setLayoutMessage(
        `${pod.name} contains active patients. Move or disposition them before removing this pod.`,
      );
      return false;
    }

    const confirmed = window.confirm(`Remove ${pod.name} from the layout?`);
    if (!confirmed) return false;

    setPods((prev) => prev.filter((pod) => pod.id !== id));
    if (selectedPod === id) setSelectedPod(null);
    setLayoutMessage(`${pod.name} removed from layout.`);
    return true;
  };

  const startPatientEdit = (podId: string, bed: Bed) => {
    if (!bed.bib) return;
    const complaint = complaintSelectionFor(bed.complaint);
    setEditPatient({ kind: "bed", podId, bedId: bed.id });
    setEditPatientBib(bed.bib);
    setEditPatientTriage(bed.triage ?? "untriaged");
    setEditPatientComplaintChoice(complaint.choice);
    setEditPatientOtherComplaint(complaint.other);
    setEditPatientStatus(bed.operationalStatus ?? "");
    setEditPatientPod(podId);
    setEditPatientMessage("");
  };

  const startIncomingEdit = (patient: Incoming) => {
    const complaint = complaintSelectionFor(patient.complaint);
    setEditPatient({ kind: "incoming", incomingId: patient.id });
    setEditPatientBib(patient.bib);
    setEditPatientTriage(patient.triage);
    setEditPatientComplaintChoice(complaint.choice);
    setEditPatientOtherComplaint(complaint.other);
    setEditPatientStatus(patient.operationalStatus ?? "");
    setEditPatientPod("");
    setEditPatientMessage("");
  };

  const finishPatientEdit = () => {
    setEditPatient(null);
    setEditPatientMessage("");
  };

  const cancelPatientEdit = () => {
    const original =
      editPatient?.kind === "incoming"
        ? incomingQueue.find((patient) => patient.id === editPatient.incomingId)
        : editPatient
          ? pods
              .find((pod) => pod.id === editPatient.podId)
              ?.beds.find((bed) => bed.id === editPatient.bedId)
          : undefined;
    const complaint = complaintSelectionFor(original?.complaint);
    const dirty =
      original &&
      (editPatientBib !== original.bib ||
        editPatientTriage !== (original.triage ?? "untriaged") ||
        editPatientComplaintChoice !== complaint.choice ||
        editPatientOtherComplaint !== complaint.other ||
        editPatientStatus !== (original.operationalStatus ?? "") ||
        editPatientPod !== (editPatient?.kind === "bed" ? editPatient.podId : ""));
    if (!dirty || window.confirm("Discard unsaved patient changes?")) finishPatientEdit();
  };

  const cancelNewPatient = () => {
    const dirty =
      newPatientBib ||
      newPatientComplaintChoice ||
      newPatientOtherComplaint ||
      newPatientStatus ||
      newPatientSource ||
      newPatientEta ||
      newPatientAssignPod ||
      newPatientTriage !== "untriaged";
    if (dirty && !window.confirm("Discard this new patient?")) return;
    resetPatientForm();
    setNewPatientMessage("");
    setAddingPatient(false);
  };

  const savePatientEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPatient) return;

    const updated = {
      bib: editPatientBib.trim(),
      triage: editPatientTriage,
      complaint:
        complaintFromSelection(editPatientComplaintChoice, editPatientOtherComplaint) || undefined,
      operationalStatus: editPatientStatus.trim() || undefined,
    };

    if (editPatient.kind === "incoming") {
      const currentPatient = incomingQueue.find((patient) => patient.id === editPatient.incomingId);
      if (!currentPatient) return;

      const incomingUpdate = {
        bib: updated.bib || currentPatient.bib,
        triage: updated.triage,
        complaint: updated.complaint ?? currentPatient.complaint,
        operationalStatus: updated.operationalStatus,
      };

      if (!editPatientPod) {
        setIncomingQueue((prev) =>
          prev.map((patient) =>
            patient.id === editPatient.incomingId ? { ...patient, ...incomingUpdate } : patient,
          ),
        );
        finishPatientEdit();
        return;
      }

      const targetPod = pods.find((pod) => pod.id === editPatientPod);
      if (!targetPod) return;

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
          beds: pod.beds.map((bed) =>
            pod.id === targetPod.id && bed.id === targetBed.id
              ? {
                  ...bed,
                  status: "occupied",
                  bib: incomingUpdate.bib,
                  since: formatBoardTime(),
                  triage: incomingUpdate.triage,
                  complaint: incomingUpdate.complaint,
                  operationalStatus: incomingUpdate.operationalStatus,
                }
              : bed,
          ),
        })),
      );
      setIncomingQueue((prev) => prev.filter((patient) => patient.id !== editPatient.incomingId));
      setSelectedPod(targetPod.id);
      finishPatientEdit();
      return;
    }

    const currentPod = pods.find((pod) => pod.id === editPatient.podId);
    const currentBed = currentPod?.beds.find((bed) => bed.id === editPatient.bedId);
    const targetPod = pods.find((pod) => pod.id === editPatientPod);
    if (!currentPod || !currentBed?.bib || !targetPod) return;

    const bedUpdate = {
      ...updated,
      bib: updated.bib || currentBed.bib,
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
                ...bedUpdate,
              };
            }
            return bed;
          }),
        })),
      );
      setSelectedPod(targetPod.id);
      finishPatientEdit();
      return;
    }

    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        beds: pod.beds.map((bed) =>
          pod.id === editPatient.podId && bed.id === editPatient.bedId
            ? { ...bed, ...bedUpdate }
            : bed,
        ),
      })),
    );
    finishPatientEdit();
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

  const handleBedDrop = (targetPodId: string, targetBedId: string, ref: PatientRef) => {
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

  const handleDispositionDrop = (category: DispositionCategory, ref: PatientRef) => {
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
    <PatientMovement
      onMove={(source, target) => {
        if (setup || editPatient || editingPod || addingPatient) return;
        if (target.kind === "bed") handleBedDrop(target.podId, target.bedId, source);
        else handleDispositionDrop(target.category, source);
      }}
    >
      <div className="tent-board flex min-h-screen flex-col gap-3 bg-background p-2 font-sans text-foreground sm:p-3 lg:p-4">
        <header className="grid grid-cols-1 items-center gap-2 border-b border-border bg-card px-3 py-2 xl:grid-cols-[minmax(0,1fr)_auto]">
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
            <div className="grid w-full grid-cols-3 gap-x-3 gap-y-2 font-mono sm:flex sm:w-auto sm:flex-wrap sm:gap-5">
              {summary.map((item) => (
                <div key={item.label}>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {item.label}
                  </div>
                  <div className={`text-lg sm:text-3xl font-extrabold leading-none ${item.tone}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            <button
              type="button"
              onClick={() => setAddingPatient(true)}
              className="min-h-11 rounded-sm bg-signal px-3 text-sm font-bold text-background"
            >
              New Patient
            </button>
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm">
                <Settings size={16} />
                Board settings
              </summary>
              <div className="absolute right-0 top-full z-20 flex w-56 flex-col gap-2 rounded-md border bg-card p-3 shadow-xl">
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
              </div>
            </details>
            <div className="hidden flex-wrap gap-3 sm:flex xl:justify-end">
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
          <aside className="order-2 flex min-w-0 flex-col gap-2 border-t border-border py-2 xl:order-1">
            <button
              type="button"
              onClick={() => setIncomingExpanded((open) => !open)}
              aria-expanded={incomingExpanded}
              className="flex min-h-11 items-center justify-between border-b border-border text-left text-sm font-bold"
            >
              <span>Incoming ({incomingQueue.length})</span>
              <span className="xl:hidden">{incomingExpanded ? "−" : "+"}</span>
            </button>
            {newPatientMessage && (
              <p className="rounded-sm border border-signal/60 bg-signal/10 px-2 py-1 text-[11px] font-semibold text-foreground">
                {newPatientMessage}
              </p>
            )}
            <Dialog
              open={addingPatient}
              onOpenChange={(open) => {
                if (!open) cancelNewPatient();
              }}
            >
              <DialogContent className="board-modal">
                <DialogTitle>New Patient</DialogTitle>
                <DialogDescription className="sr-only">
                  Patient arrival and assignment
                </DialogDescription>
                {newPatientMessage && <p role="alert">{newPatientMessage}</p>}
                <form onSubmit={addIncomingPatient} className="editor-form flex flex-col gap-3">
                  <label>
                    Race #
                    <input
                      value={newPatientBib}
                      onChange={(e) => setNewPatientBib(e.target.value)}
                      placeholder="Race #"
                      className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                      required
                    />
                  </label>
                  <ComplaintField
                    choice={newPatientComplaintChoice}
                    other={newPatientOtherComplaint}
                    onChoiceChange={setNewPatientComplaintChoice}
                    onOtherChange={setNewPatientOtherComplaint}
                  />
                  <label>
                    Assign Pod
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
                  </label>
                  <label>
                    Triage
                    <select
                      value={newPatientTriage}
                      onChange={(e) => setNewPatientTriage(e.target.value as Triage)}
                      aria-label="Triage"
                      className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
                    >
                      {triageOptions.map((triage) => (
                        <option key={triage} value={triage}>
                          {triageLabel[triage]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Notes
                    <input
                      value={newPatientStatus}
                      onChange={(e) => setNewPatientStatus(e.target.value)}
                      placeholder="Notes"
                      className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                    />
                  </label>
                  <label>
                    Source
                    <input
                      value={newPatientSource}
                      onChange={(e) => setNewPatientSource(e.target.value)}
                      placeholder="Source"
                      className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                    />
                  </label>
                  <label>
                    ETA
                    <input
                      value={newPatientEta}
                      onChange={(e) => setNewPatientEta(e.target.value)}
                      placeholder="ETA"
                      className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="submit"
                      className="rounded-sm border border-status-open bg-status-open px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={cancelNewPatient}
                      className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            <div className={`flex-col gap-2 ${incomingExpanded ? "flex" : "hidden xl:flex"}`}>
              {incomingQueue.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Incoming queue clear
                </p>
              )}
              {incomingQueue.map((patient) => (
                <IncomingCard
                  key={patient.id}
                  patient={patient}
                  disabled={setup}
                  onEdit={() => startIncomingEdit(patient)}
                />
              ))}
            </div>
          </aside>

          <section className="order-1 flex min-w-0 flex-col gap-3 xl:order-2">
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
            <div className="pod-grid grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
              {pods.map((pod) => (
                <PodCard
                  key={pod.id}
                  pod={pod}
                  selected={selectedPod === pod.id}
                  setup={setup}
                  onSelect={() => setSelectedPod(selectedPod === pod.id ? null : pod.id)}
                  onEdit={() => setEditingPod(pod.id)}
                  onEditPatient={startPatientEdit}
                />
              ))}
            </div>
            {editingPod && pods.find((pod) => pod.id === editingPod) && (
              <PodEditor
                key={editingPod}
                pod={pods.find((pod) => pod.id === editingPod)!}
                onClose={() => setEditingPod(null)}
                onRemove={() => removePod(editingPod)}
                onSave={(draft) => {
                  setPods((previous) =>
                    previous.map((pod) =>
                      pod.id === draft.id ? { ...draft, beds: pod.beds } : pod,
                    ),
                  );
                  setEditingPod(null);
                }}
              />
            )}
            <Dialog
              open={!!editPatient}
              onOpenChange={(open) => {
                if (!open) cancelPatientEdit();
              }}
            >
              <DialogContent className="board-modal">
                <DialogTitle>Edit Patient</DialogTitle>
                <DialogDescription className="sr-only">
                  Patient information and pod assignment
                </DialogDescription>
                {editPatient && (
                  <form onSubmit={savePatientEdit} className="editor-form grid gap-3">
                    <label>
                      Race #
                      <input
                        value={editPatientBib}
                        onChange={(e) => setEditPatientBib(e.target.value)}
                        placeholder="Race #"
                        className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                        required
                      />
                    </label>
                    <label>
                      Triage
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
                    </label>
                    <ComplaintField
                      choice={editPatientComplaintChoice}
                      other={editPatientOtherComplaint}
                      onChoiceChange={setEditPatientComplaintChoice}
                      onOtherChange={setEditPatientOtherComplaint}
                    />
                    <label>
                      Notes
                      <input
                        value={editPatientStatus}
                        onChange={(e) => setEditPatientStatus(e.target.value)}
                        placeholder="Notes"
                        className="min-w-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
                      />
                    </label>
                    <label>
                      Assign Pod
                      <select
                        value={editPatientPod}
                        onChange={(e) => setEditPatientPod(e.target.value)}
                        aria-label="Move to pod"
                        className="rounded-sm border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-signal"
                      >
                        {editPatient.kind === "incoming" && (
                          <option value="">Incoming queue</option>
                        )}
                        {pods.map((pod) => {
                          const open = pod.closed
                            ? 0
                            : pod.beds.filter((bed) => bed.status === "open").length;
                          const current =
                            editPatient.kind === "bed" && editPatient.podId === pod.id;
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
                    </label>
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
                      <p className="rounded-sm border border-signal/60 bg-signal/10 px-2 py-1.5 text-[11px] font-semibold text-foreground">
                        {editPatientMessage}
                      </p>
                    )}
                  </form>
                )}
              </DialogContent>
            </Dialog>
            {selected && !setup ? (
              <PodDetail
                pod={selected}
                onClose={() => setSelectedPod(null)}
                onClearBed={(bedId) => clearTurnoverBed(selected.id, bedId)}
                onEditPatient={startPatientEdit}
              />
            ) : null}
          </section>

          <aside className="order-3 grid min-w-0 grid-cols-3 content-start gap-2 border-t border-border py-2 xl:flex xl:flex-col">
            <h2 className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Disposition
            </h2>
            {dispositionCounts.map((category) => (
              <DispositionBucket
                key={category.id}
                category={category}
                dispositions={category.dispositions}
                disabled={setup}
              />
            ))}
          </aside>
        </main>
      </div>
    </PatientMovement>
  );
}
