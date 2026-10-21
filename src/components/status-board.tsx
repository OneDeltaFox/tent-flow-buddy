import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize } from "lucide-react";
import type { Bed, Pod } from "@/lib/tent-data";
import { isPoolPod } from "@/lib/tent-data";

function podTextColor(color: string): string {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "ffffff";
  const rgb = [0, 2, 4].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function RaceNumber({ bib }: { bib: string }) {
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = label.current;
    if (!element) return;
    const fit = () => {
      element.style.fontSize = "40px";
      const width = element.scrollWidth;
      element.style.fontSize = `${Math.min(40, 40 * element.clientWidth / Math.max(width, 1))}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element.parentElement!);
    fit();
    return () => observer.disconnect();
  }, [bib]);
  return <span ref={label} className="status-race-number">{bib}</span>;
}

function elapsedTime(arrivedAt: number | undefined, now: number): string {
  if (arrivedAt === undefined || !Number.isFinite(arrivedAt) || arrivedAt > now) return "--:--";
  const seconds = Math.floor((now - arrivedAt) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function StatusBoard({
  pods,
  eventName,
  incomingCount,
  bedTone,
  onClose,
  metrics,
  poolStartedAt = {},
  backLabel = "Back to working board",
}: {
  pods: Pod[];
  eventName: string;
  incomingCount: number;
  bedTone: (bed: Bed) => string;
  onClose: () => void;
  metrics?: { census: number; seen: number; discharged: number; ems: number; other: number };
  poolStartedAt?: Record<string, number>;
  backLabel?: string;
}) {
  const [now, setNow] = useState(Date.now);
  const [fullscreenError, setFullscreenError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const regularPods = pods.filter((pod) => !isPoolPod(pod));
  const poolPods = pods.filter(isPoolPod);
  const poolSpaces = poolPods.flatMap((pod) => pod.beds);
  const occupiedPools = poolSpaces.filter((bed) => bed.bib).length;
  const availablePools = poolPods.filter((pod) => !pod.closed).flatMap((pod) => pod.beds);
  const openPools = availablePools.filter((bed) => bed.status === "open").length;
  const beds = regularPods.flatMap((pod) => pod.beds);
  const occupied = beds.filter((bed) => bed.bib).length;
  const availablePods = regularPods.filter((pod) => !pod.closed);
  const open = availablePods
    .flatMap((pod) => pod.beds)
    .filter((bed) => bed.status === "open").length;
  const capacity = regularPods.reduce(
    (total, pod) =>
      total + (pod.closed ? pod.beds.filter((bed) => bed.bib).length : pod.beds.length),
    0,
  );
  const saturation = capacity ? Math.round((occupied / capacity) * 100) : 0;
  const metricGroups: { title: string; items: [string, number | string, string][] }[] = [
    { title: "Overview", items: [
      ["Census", metrics?.census ?? pods.flatMap(pod => pod.beds).filter(bed => bed.bib && !bed.reserved).length, "text-sky-300"],
      ["Incoming", incomingCount, "text-violet-300"],
      ...(metrics ? [["Seen today", metrics.seen, "text-foreground"] as [string, number, string]] : []),
    ] },
    { title: "Beds", items: [
      ["Occupied beds", occupied, "text-amber-300"], ["Open beds", open, "text-emerald-300"],
      ["Bed capacity", capacity, "text-foreground"], ["Bed saturation", `${saturation}%`, "text-sky-300"],
    ] },
    { title: "Pools", items: [
      ["Occupied pools", occupiedPools, "text-amber-300"], ["Open pools", `${openPools} / ${availablePools.length}`, "text-emerald-300"],
    ] },
    ...(metrics ? [{ title: "Dispositions", items: [
      ["Discharged", metrics.discharged, "text-emerald-300"],
      ["EMS Transport", metrics.ems, "text-rose-300"],
      ["Other", metrics.other, "text-foreground"],
    ] as [string, number | string, string][] }] : []),
  ];
  return (
    <div
      ref={root}
      className="status-display min-h-screen overflow-auto bg-background p-3 text-foreground sm:p-4"
      data-testid="status-board"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold">{eventName}</h1>
          <p className="text-base text-muted-foreground">Status Board</p>
        </div>
        <div className="flex items-center gap-2">
          <time className="mr-2 font-mono text-3xl font-bold">
            {new Date(now).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
          <button
            type="button"
            title="Fullscreen"
            aria-label="Fullscreen"
            className="flex size-11 items-center justify-center rounded-sm border border-border"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
                else setFullscreenError("Fullscreen is not available in this browser.");
              } catch {
                setFullscreenError("Fullscreen is not available in this browser.");
              }
            }}
          >
            <Maximize size={18} />
          </button>
          <button
            type="button"
            title={backLabel}
            aria-label={backLabel}
            className="flex size-11 items-center justify-center rounded-sm border border-border"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      </header>
      <div className="status-metrics mb-3 grid grid-cols-1 divide-y divide-border border-b border-border sm:mb-5 xl:grid-cols-[3fr_4fr_2fr_3fr] xl:divide-x xl:divide-y-0">
        {metricGroups.map(group => <section key={group.title} aria-label={group.title} className="min-w-0 px-1 py-2 first:pl-0 sm:px-3 sm:py-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground sm:mb-3 sm:text-base">{group.title}</h3>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-x-2 gap-y-1 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))] sm:gap-x-4 sm:gap-y-3">
            {group.items.map(([label, value, color]) => <div key={label} className="min-w-0">
              <dt className="min-h-8 break-words text-xs text-muted-foreground sm:min-h-12 sm:text-base">{label}</dt>
              <dd className={`break-words font-mono text-xl font-bold tabular-nums sm:text-4xl ${color}`}>{value}</dd>
            </div>)}
          </dl>
        </section>)}
      </div>
      {fullscreenError && (
        <p role="status" className="mb-3 text-sm">
          {fullscreenError}
        </p>
      )}
      <main className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))]">
        {[...pods].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((pod) => (
          <section
            key={pod.id}
            className="min-w-0 rounded-md border-2 border-t-4 bg-card p-1.5 sm:p-2"
            style={{ borderColor: pod.color, backgroundColor: pod.color, color: podTextColor(pod.color) }}
          >
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 border-b border-border pb-1">
              <h2 className="min-w-0 break-words text-2xl font-bold sm:text-3xl">{pod.name}</h2>
              <span className="text-xs font-semibold sm:text-lg">
                {pod.closed
                  ? "Closed"
                  : `${pod.beds.filter((bed) => bed.bib).length}/${pod.beds.length}`}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {[...pod.beds].sort((a,b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((bed) => (
                <div key={bed.id} className="min-w-0">
                  <div
                    className={`status-bed flex h-14 min-w-0 flex-col items-center justify-center rounded-sm border px-1 text-center font-mono text-xl font-bold sm:text-2xl ${bedTone(bed)}`}
                    data-triage={bed.bib ? bed.triage ?? "untriaged" : undefined}
                    data-state={bed.bib ? "occupied" : bed.status}
                    title={bed.bib ? `Race #${bed.bib}, bed ${bed.label}` : bed.label}
                  >
                    {bed.bib ? <RaceNumber bib={bed.bib} /> : <span className="max-w-full truncate">
                      {bed.status === "cleaning"
                          ? "Cleaning"
                          : pod.closed
                            ? "Closed"
                            : bed.label}
                    </span>}
                    {bed.reserved && <span className="text-xs sm:text-base">In pool</span>}
                  </div>
                  <div
                    className="h-6 text-center font-mono text-sm font-bold leading-6 tabular-nums sm:h-7 sm:text-xl sm:leading-7"
                    title={
                      bed.bib
                        ? "Elapsed time since first bed assignment (hours:minutes:seconds)"
                        : undefined
                    }
                  >
                    {bed.bib ? elapsedTime(bed.arrivedAt, now) : ""}
                  </div>
                  {bed.bib && poolStartedAt[bed.id] !== undefined && <p className="break-words text-center font-mono text-xs font-semibold sm:text-lg">Pool {elapsedTime(poolStartedAt[bed.id], now)}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
      {pods.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No pods configured.</p>
      )}
    </div>
  );
}
