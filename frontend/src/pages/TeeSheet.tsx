import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Booking, type Resource } from "@/lib/api";
import { cn, formatRub, formatTime, statusColor } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BookingDialog from "@/components/BookingDialog";
import BookingScenarioDialog from "@/components/BookingScenarioDialog";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, d: number) {
  const dt = new Date(iso + "T00:00:00"); dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}

// Minute-granular rendering: render a per-resource vertical timeline column.
// Overlapping bookings split into sub-columns like Google Calendar.
const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 22 * 60;
const TOTAL_MIN = CLOSE_MIN - OPEN_MIN;

function pad(n: number) { return String(n).padStart(2, "0"); }

function minutesFromDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

// Simple overlap-split algorithm: greedy column assignment.
function assignColumns(bookings: Booking[]): Map<number, { col: number; cols: number }> {
  const result = new Map<number, { col: number; cols: number }>();
  const sorted = [...bookings].sort(
    (a, b) => minutesFromDay(a.starts_at) - minutesFromDay(b.starts_at)
  );
  // Group by overlapping cluster
  const clusters: Booking[][] = [];
  for (const b of sorted) {
    const s = minutesFromDay(b.starts_at);
    let added = false;
    for (const cluster of clusters) {
      const lastEnd = Math.max(...cluster.map((c) => minutesFromDay(c.ends_at)));
      const firstStart = Math.min(...cluster.map((c) => minutesFromDay(c.starts_at)));
      if (s < lastEnd && minutesFromDay(b.ends_at) > firstStart) {
        cluster.push(b); added = true; break;
      }
    }
    if (!added) clusters.push([b]);
  }
  for (const cluster of clusters) {
    // Assign columns within cluster
    const cols: Booking[][] = [];
    for (const b of cluster) {
      const s = minutesFromDay(b.starts_at);
      const e = minutesFromDay(b.ends_at);
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        const last = cols[i][cols[i].length - 1];
        if (minutesFromDay(last.ends_at) <= s) {
          cols[i].push(b);
          result.set(b.id, { col: i, cols: 0 });
          placed = true; break;
        }
      }
      if (!placed) {
        cols.push([b]);
        result.set(b.id, { col: cols.length - 1, cols: 0 });
      }
    }
    for (const b of cluster) {
      const entry = result.get(b.id)!;
      entry.cols = cols.length;
    }
  }
  return result;
}

export default function TeeSheet() {
  const [date, setDate] = useState(todayISO());
  // Fixed visual grid — 15 min lines — but time picker inside the dialog
  // allows any minute (HH:MM), so users can book at 8:17 or 12:33 too.
  const granularity = 15;
  const [dialog, setDialog] = useState<{ resource: Resource; time: string } | Booking | null>(null);

  const { data: resources } = useQuery({ queryKey: ["visible-resources"], queryFn: api.visibleResources });
  const { data: bookings } = useQuery({
    queryKey: ["bookings-day", date],
    queryFn: () => api.bookings({ on: date }),
  });

  const bookingsByResource = useMemo(() => {
    const m: Record<number, Booking[]> = {};
    for (const b of bookings || []) {
      if (!b.resource_id) continue;
      (m[b.resource_id] ??= []).push(b);
    }
    return m;
  }, [bookings]);

  const columnMaps = useMemo(() => {
    const m: Record<number, Map<number, { col: number; cols: number }>> = {};
    for (const [rid, list] of Object.entries(bookingsByResource)) {
      m[Number(rid)] = assignColumns(list);
    }
    return m;
  }, [bookingsByResource]);

  // Grid lines every `granularity` minutes
  const gridTimes = useMemo(() => {
    const out: string[] = [];
    for (let m = OPEN_MIN; m <= CLOSE_MIN; m += granularity) {
      out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    }
    return out;
  }, [granularity]);

  const rowHeight = granularity <= 10 ? 20 : granularity <= 15 ? 24 : granularity <= 30 ? 32 : 48;
  const totalHeight = (TOTAL_MIN / granularity) * rowHeight;

  function handleEmptyClick(r: Resource, offsetMin: number) {
    // Snap to 5-minute buckets just so the dialog shows a clean starting time.
    // User can freely edit it to any minute afterwards.
    const snapped = Math.round(offsetMin / 5) * 5;
    const mins = OPEN_MIN + snapped;
    setDialog({ resource: r, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` });
  }

  return (
    <div className="page" data-testid="tee-sheet-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Tee-Sheet</h1>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button className="btn-ghost" onClick={() => setDate(addDays(date, -1))} data-testid="prev-day">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date" className="input max-w-[180px]" value={date}
            onChange={(e) => setDate(e.target.value)} data-testid="date-picker"
          />
          <button className="btn-ghost" onClick={() => setDate(addDays(date, 1))} data-testid="next-day">
            <ChevronRight size={16} />
          </button>
          <button className="btn-ghost text-sm" onClick={() => setDate(todayISO())} data-testid="today-btn">
            Сегодня
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-auto" data-testid="tee-sheet-grid">
        <div className="flex" style={{ minHeight: totalHeight + 48 }}>
          {/* Time column */}
          <div className="w-14 sticky left-0 bg-white z-10 border-r border-stone-200 sm:w-20">
            <div className="h-14 border-b border-stone-200 bg-stone-50" />
            <div className="relative" style={{ height: totalHeight }}>
              {gridTimes.map((t, i) => (
                <div
                  key={t}
                  className="absolute left-0 right-0 text-xs text-stone-500 font-mono px-2"
                  style={{ top: i * rowHeight - 7 }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Resource columns */}
          {resources?.map((r) => {
            const rBookings = bookingsByResource[r.id] || [];
            const colMap = columnMaps[r.id] || new Map();
            return (
              <div key={r.id} className="flex-1 min-w-[150px] border-r border-stone-100 sm:min-w-[170px]">
                <div
                  className="h-14 sticky top-0 bg-stone-50 border-b border-stone-200 px-2 py-2 text-center text-sm font-semibold text-stone-700"
                  data-testid={`resource-head-${r.id}`}
                >
                  <div className="truncate">{r.name}</div>
                  <div className="text-xs text-stone-400 font-mono">{r.code}</div>
                </div>
                <div
                  className="relative bg-white"
                  style={{ height: totalHeight }}
                  onClick={(e) => {
                    const box = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const y = e.clientY - box.top;
                    handleEmptyClick(r, Math.round((y / totalHeight) * TOTAL_MIN));
                  }}
                  data-testid={`resource-col-${r.id}`}
                >
                  {gridTimes.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "absolute left-0 right-0 border-t border-stone-100",
                        i % Math.round(60 / granularity) === 0 && "border-stone-200"
                      )}
                      style={{ top: i * rowHeight, height: 1 }}
                    />
                  ))}
                  {rBookings.map((b) => {
                    const startMin = minutesFromDay(b.starts_at) - OPEN_MIN;
                    const endMin = minutesFromDay(b.ends_at) - OPEN_MIN;
                    const top = (startMin / TOTAL_MIN) * totalHeight;
                    const height = Math.max(
                      ((endMin - startMin) / TOTAL_MIN) * totalHeight - 1,
                      14
                    );
                    const entry = colMap.get(b.id) || { col: 0, cols: 1 };
                    const widthPct = 100 / entry.cols;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDialog(b); }}
                        className={cn(
                          "absolute text-xs px-1.5 py-0.5 rounded border overflow-hidden text-left hover:brightness-95 transition",
                          statusColor(b.status)
                        )}
                        style={{
                          top,
                          height,
                          left: `${entry.col * widthPct}%`,
                          width: `calc(${widthPct}% - 2px)`,
                        }}
                        data-testid={`booking-${b.id}`}
                        title={`${b.customer_name || "—"} · ${formatRub(b.total_kopecks)}`}
                      >
                        <div className="truncate font-medium leading-tight">{b.customer_name || "—"}</div>
                        <div className="truncate text-[11px] opacity-80">{b.service_name || ""}</div>
                        <div className="text-[11px] font-mono opacity-70">
                          {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dialog && "resource_id" in dialog ? (
        <BookingDialog mode="edit" booking={dialog as Booking} onClose={() => setDialog(null)} />
      ) : dialog ? (
        <BookingScenarioDialog
          date={date}
          time={(dialog as any).time}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
