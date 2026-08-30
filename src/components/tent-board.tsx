import { useEffect, useMemo, useState } from "react";
import type { Bed, BedStatus, Pod } from "@/lib/tent-data";
import { BEDS_PER_POD, departures, emptyPod, incoming, initialPods } from "@/lib/tent-data";

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

function BedTile({ bed }: { bed: Bed }) {
  return (
    <div
      title={`${bed.label} · ${statusLabel[bed.status]}${bed.bib ? ` · #${bed.bib}` : ""}`}
      className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-sm border font-mono leading-none ${statusTile[bed.status]}`}
    >
      {bed.bib ? (
        <>
          <span className="text-[11px] font-extrabold tracking-tight">{bed.bib}</span>
          <span className="mt-0.5 text-[8px] font-bold opacity-70">{bed.since}</span>
        </>
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-tight">
          {bed.status === "cleaning" ? "CLR" : bed.label}
        </span>
      )}
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
}: {
  pod: Pod;
  selected: boolean;
  setup: boolean;
  onSelect: () => void;
  onRemove: () => void;
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
            {pod.capabilities.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {pod.capabilities.map((c) => (
                  <span
                    key={c}
                    className="rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tight text-muted-foreground"
                  >
                    {c}
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
          {pod.beds.map((b) => (
            <BedTile key={b.id} bed={b} />
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border pt-2">
          <span className="truncate text-[10px] font-medium text-muted-foreground">
            {pod.staff.length > 0 ? pod.staff.join(" · ") : "No staff assigned"}
          </span>
          {critical > 0 && (
            <span className="shrink-0 rounded-sm bg-status-critical/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-status-critical">
              {critical} critical
            </span>
          )}
        </div>
      </button>
      {setup && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove pod"
          className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-status-critical bg-status-critical text-sm font-bold leading-none text-foreground hover:opacity-80"
        >
          ×
        </button>
      )}
    </div>
  );
}

function PodDetail({ pod, onClose }: { pod: Pod; onClose: () => void }) {
  const { open, total } = podCounts(pod);
  const patients = pod.beds.filter((b) => b.bib);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-signal bg-card p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight">{pod.name}</h2>
          <p className="text-[11px] text-muted-foreground">{pod.zone}</p>
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
            {pod.staff.length > 0 ? pod.staff.join(", ") : "—"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase text-muted-foreground">Capabilities</div>
          <div className="text-xs font-medium text-foreground">
            {pod.capabilities.length > 0 ? pod.capabilities.join(", ") : "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {patients.length === 0 && (
          <p className="text-xs text-muted-foreground">No patients currently in this pod.</p>
        )}
        {patients.map((b) => (
          <div
            key={b.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-border bg-secondary/40 px-3 py-2"
          >
            <span className="w-8 shrink-0 font-mono text-xs font-bold text-muted-foreground">
              {b.label}
            </span>
            <span className="min-w-0 truncate font-mono text-sm font-bold">
              #{b.bib}
              {b.note && (
                <span className="ml-2 font-sans text-[11px] font-medium text-muted-foreground">
                  {b.note}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 font-mono text-[10px] font-bold uppercase ${
                b.status === "critical" ? "text-status-critical" : "text-status-occupied"
              }`}
            >
              in {b.since}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function nextPodId(pods: Pod[]): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const used = new Set(pods.map((p) => p.id));
  return letters.find((l) => !used.has(l)) ?? `P${pods.length + 1}`;
}

const STORAGE_KEY = "tent-board-pods-v1";

function loadPods(): Pod[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialPods;
    const parsed = JSON.parse(raw) as Pod[];
    if (!Array.isArray(parsed) || parsed.length === 0) return initialPods;
    return parsed;
  } catch {
    return initialPods;
  }
}

export function TentBoard() {
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [pods, setPods] = useState<Pod[]>(initialPods);
  const [hydrated, setHydrated] = useState(false);
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");

  useEffect(() => {
    setPods(loadPods());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(pods));
  }, [pods, hydrated]);

  const totals = useMemo(() => {
    const all = pods.flatMap((p) => p.beds);
    return {
      open: all.filter((b) => b.status === "open").length,
      total: all.length,
      critical: all.filter((b) => b.status === "critical").length,
      cleaning: all.filter((b) => b.status === "cleaning").length,
    };
  }, [pods]);

  const pod = pods.find((p) => p.id === selectedPod) ?? null;

  const addPod = () => {
    const id = nextPodId(pods);
    const name = newName.trim() || `Pod ${id}`;
    const newPod = emptyPod(id, name, newZone.trim() || "Unassigned zone");
    setPods((prev) => [...prev, newPod]);
    setNewName("");
    setNewZone("");
  };

  const removePod = (id: string) => {
    setPods((prev) => prev.filter((p) => p.id !== id));
    if (selectedPod === id) setSelectedPod(null);
  };

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-3 font-sans text-foreground lg:p-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Medical Tent 1 — Charge Board
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight">Finish Line Medical</h1>
          </div>
          <div className="flex gap-6 font-mono">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Open beds
              </div>
              <div className="text-3xl font-extrabold leading-none text-status-open">
                {totals.open}
                <span className="text-lg text-muted-foreground"> / {totals.total}</span>
              </div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Critical
              </div>
              <div className="text-3xl font-extrabold leading-none text-status-critical">
                {String(totals.critical).padStart(2, "0")}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Turning over
              </div>
              <div className="text-3xl font-extrabold leading-none text-muted-foreground">
                {String(totals.cleaning).padStart(2, "0")}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Pods
              </div>
              <div className="text-3xl font-extrabold leading-none text-foreground">
                {String(pods.length).padStart(2, "0")}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setSetup((s) => !s)}
            className={`rounded-sm border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              setup
                ? "border-signal bg-signal text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {setup ? "Done" : "Edit layout"}
          </button>
          <div className="flex flex-wrap justify-end gap-3">
            {(["open", "occupied", "critical", "cleaning"] as BedStatus[]).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-sm border ${statusTile[s]}`} />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {statusLabel[s]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[250px_minmax(0,1fr)_250px]">
        <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
          <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <span className="size-2 rounded-full bg-status-critical" />
            Incoming
          </h2>
          {incoming.map((i) => (
            <div
              key={i.id}
              className={`rounded-r-sm border-l-2 bg-secondary/50 p-2.5 ${
                i.priority === "critical" ? "border-l-status-critical" : "border-l-status-cleaning"
              }`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                <span className="truncate font-mono text-lg font-extrabold tracking-tight">
                  #{i.bib}
                </span>
                <span
                  className={`shrink-0 font-mono text-[10px] font-bold uppercase ${
                    i.priority === "critical" ? "text-status-critical" : "text-muted-foreground"
                  }`}
                >
                  ETA {i.eta}
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{i.source}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-tight">{i.note}</p>
            </div>
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
                placeholder="Name (e.g. Pod G — Wound Care)"
                className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <input
                value={newZone}
                onChange={(e) => setNewZone(e.target.value)}
                placeholder="Zone / location"
                className="w-40 rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-signal"
              />
              <button
                type="button"
                onClick={addPod}
                className="rounded-sm border border-signal bg-signal px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-background hover:opacity-90"
              >
                + Add
              </button>
              <span className="w-full text-[10px] text-muted-foreground">
                In edit mode, tap the × on a pod to remove it from the tent.
              </span>
            </div>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {pods.map((p) => (
              <PodCard
                key={p.id}
                pod={p}
                selected={selectedPod === p.id}
                setup={setup}
                onSelect={() => !setup && setSelectedPod(selectedPod === p.id ? null : p.id)}
                onRemove={() => removePod(p.id)}
              />
            ))}
          </div>
          {pod && !setup ? (
            <PodDetail pod={pod} onClose={() => setSelectedPod(null)} />
          ) : !setup ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Select a pod to see who is in each bed
            </p>
          ) : null}
        </section>

        <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Departed
          </h2>
          {departures.map((d) => (
            <div key={d.id} className="border-b border-border pb-2 last:border-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                <span className="truncate font-mono text-sm font-bold">#{d.bib}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {d.time}
                </span>
              </div>
              <p
                className={`text-[10px] font-bold uppercase tracking-tight ${
                  d.kind === "transport"
                    ? "text-status-critical"
                    : d.kind === "moved"
                      ? "text-signal"
                      : "text-status-open"
                }`}
              >
                {d.destination}
              </p>
            </div>
          ))}
        </aside>
      </main>
    </div>
  );
}
