import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize } from "lucide-react";
import type { Bed, Pod } from "@/lib/tent-data";

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
}: {
  pods: Pod[];
  eventName: string;
  incomingCount: number;
  bedTone: (bed: Bed) => string;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [fullscreenError, setFullscreenError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const beds = pods.flatMap((pod) => pod.beds);
  const occupied = beds.filter((bed) => bed.bib).length;
  const availablePods = pods.filter((pod) => !pod.closed);
  const open = availablePods
    .flatMap((pod) => pod.beds)
    .filter((bed) => bed.status === "open").length;
  const capacity = pods.reduce(
    (total, pod) =>
      total + (pod.closed ? pod.beds.filter((bed) => bed.bib).length : pod.beds.length),
    0,
  );
  const saturation = capacity ? Math.round((occupied / capacity) * 100) : 0;
  return (
    <div
      ref={root}
      className="min-h-screen overflow-auto bg-background p-3 text-foreground sm:p-4"
      data-testid="status-board"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold">{eventName}</h1>
          <p className="text-base text-muted-foreground">Status Board</p>
        </div>
        <dl className="flex flex-wrap gap-5 font-mono">
          {[
            ["Occupied", occupied],
            ["Open", open],
            ["Capacity", capacity],
            ["Saturation", `${saturation}%`],
            ["Incoming", incomingCount],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-base text-muted-foreground">{label}</dt>
              <dd className="text-4xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
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
            title="Back to working board"
            aria-label="Back to working board"
            className="flex size-11 items-center justify-center rounded-sm border border-border"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      </header>
      {fullscreenError && (
        <p role="status" className="mb-3 text-sm">
          {fullscreenError}
        </p>
      )}
      <main className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
        {pods.map((pod) => (
          <section
            key={pod.id}
            className="min-w-0 rounded-md border-2 border-t-4 bg-card p-2 sm:p-3"
            style={{ borderColor: pod.color }}
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1 border-b border-border pb-2">
              <h2 className="min-w-0 break-words text-2xl font-bold">{pod.name}</h2>
              <span className="text-lg font-semibold text-foreground">
                {pod.closed
                  ? "Closed"
                  : `${pod.beds.filter((bed) => bed.bib).length}/${pod.beds.length}`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {pod.beds.map((bed) => (
                <div key={bed.id} className="min-w-0">
                  <div
                    className={`flex h-16 min-w-0 items-center justify-center rounded-sm border px-1 text-center font-mono text-2xl font-bold ${bedTone(bed)}`}
                    title={bed.bib ? `Race #${bed.bib}, bed ${bed.label}` : bed.label}
                  >
                    <span className="truncate">
                      {bed.bib
                        ? `#${bed.bib}`
                        : bed.status === "cleaning"
                          ? "Cleaning"
                          : pod.closed
                            ? "Closed"
                            : bed.label}
                    </span>
                  </div>
                  <div
                    className="h-8 text-center font-mono text-lg font-semibold leading-8 tabular-nums"
                    title={
                      bed.bib
                        ? "Elapsed time since first bed assignment (hours:minutes:seconds)"
                        : undefined
                    }
                  >
                    {bed.bib ? elapsedTime(bed.arrivedAt, now) : ""}
                  </div>
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
