import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Plus, CalendarDays, CalendarRange,
  Snowflake, Sun, Check, X as XIcon, CheckCheck, ChevronDown,
  Pencil, Trash2, AlertTriangle, Ban, Pause, CircleCheck,
  GraduationCap, LayoutGrid, Filter, Clock,
} from "lucide-react";
import { api, type Booking, type Instructor, type Resource, type Service, type Zone } from "@/lib/api";
import { cn, formatRub, formatTime } from "@/lib/utils";
import BookingDialog from "@/components/BookingDialog";
import BookingScenarioDialog from "@/components/BookingScenarioDialog";
import { usePerms } from "@/hooks/useAuth";

type View = "day" | "week" | "trainers" | "resources";

const OPEN_MIN = 0;
const CLOSE_MIN = 24 * 60;
const TOTAL_MIN = CLOSE_MIN - OPEN_MIN;
const HOUR_HEIGHT = 52;
const TOTAL_HEIGHT = ((CLOSE_MIN - OPEN_MIN) / 60) * HOUR_HEIGHT;

function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
  return toISO(d);
}
function startOfWeek(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const wd = (d.getDay() + 6) % 7; // monday-based
  d.setDate(d.getDate() - wd);
  return toISO(d);
}
function minutesInDay(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function fmtLongEn(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmtDDMM(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("ru-RU",
    { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtRuWeekday(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long" });
}
function fmtShortDay(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const wd = d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
  const dm = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  return `${wd} ${dm}`;
}

// Google-calendar style overlap split within a single column
function assignColumns(items: Booking[]) {
  const result = new Map<number, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => minutesInDay(a.starts_at) - minutesInDay(b.starts_at));
  const clusters: Booking[][] = [];
  for (const b of sorted) {
    const s = minutesInDay(b.starts_at), e = minutesInDay(b.ends_at);
    let added = false;
    for (const cl of clusters) {
      const lastEnd = Math.max(...cl.map((x) => minutesInDay(x.ends_at)));
      const firstStart = Math.min(...cl.map((x) => minutesInDay(x.starts_at)));
      if (s < lastEnd && e > firstStart) { cl.push(b); added = true; break; }
    }
    if (!added) clusters.push([b]);
  }
  for (const cl of clusters) {
    const cols: Booking[][] = [];
    for (const b of cl) {
      const s = minutesInDay(b.starts_at);
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        const last = cols[i][cols[i].length - 1];
        if (minutesInDay(last.ends_at) <= s) {
          cols[i].push(b); result.set(b.id, { col: i, cols: 0 }); placed = true; break;
        }
      }
      if (!placed) { cols.push([b]); result.set(b.id, { col: cols.length - 1, cols: 0 }); }
    }
    for (const b of cl) result.get(b.id)!.cols = cols.length;
  }
  return result;
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { isInstructor, canCreateBookings, canEditBookings, canDeleteBookings } = usePerms();
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState<string>(toISO(new Date()));
  const [dialog, setDialog] = useState<Booking | "new" | null>(null);
  const [trainerFilter, setTrainerFilter] = useState<number[]>([]);
  const [serviceFilter, setServiceFilter] = useState<number[]>([]);
  const [extendFor, setExtendFor] = useState<Booking | null>(null);

  // Re-render every 30s so the "late" orange tint and per-booking state
  // stay in sync with wall-clock time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const { data: resources } = useQuery({ queryKey: ["visible-resources"], queryFn: api.visibleResources });
  const { data: instructors = [] } = useQuery<Instructor[]>({ queryKey: ["instructors"], queryFn: api.instructors });
  const { data: services = [] } = useQuery<Service[]>({ queryKey: ["services"], queryFn: api.services });
  const { data: zones = [] } = useQuery<Zone[]>({ queryKey: ["zones"], queryFn: api.zones });
  const { data: rawBookings = [] } = useQuery<Booking[]>({
    queryKey: ["dash-sched", view, view === "week" ? weekStart : anchor],
    queryFn: () => {
      if (view === "week") {
        return api.bookings({
          from: `${weekStart}T00:00:00`,
          to: `${weekEnd}T00:00:00`,
        });
      }
      return api.bookings({ on: anchor });
    },
  });

  const bookings = useMemo(() => {
    return rawBookings.filter((b) => {
      if (trainerFilter.length && (!b.instructor_id || !trainerFilter.includes(b.instructor_id))) return false;
      if (serviceFilter.length && (!b.service_id || !serviceFilter.includes(b.service_id))) return false;
      return true;
    });
  }, [rawBookings, trainerFilter, serviceFilter]);

  const transition = useMutation({
    mutationFn: ({ id, to, reason }: { id: number; to: string; reason?: string }) =>
      api.transition(id, to, reason || ""),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-sched"] });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["business-analytics"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteBooking(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-sched"] });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const extend = useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) => api.extendBooking(id, minutes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-sched"] });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["business-analytics"] });
      setExtendFor(null);
    },
  });

  // "Скоро завершится" — показываем баннер за 5 минут до конца брони.
  // Для each booking триггерим максимум один раз (trackedShown ref).
  const shownReminders = useRef<Set<number>>(new Set());
  const [reminders, setReminders] = useState<Array<{ id: number; text: string; at: number }>>([]);
  useEffect(() => {
    const upcoming = bookings.filter((b) => {
      if (b.status !== "checked_in" && b.status !== "confirmed") return false;
      const endsMs = new Date(b.ends_at).getTime();
      const remaining = endsMs - now;
      return remaining > 0 && remaining <= 5 * 60_000;
    });
    const created: Array<{ id: number; text: string; at: number }> = [];
    for (const b of upcoming) {
      if (!shownReminders.current.has(b.id)) {
        shownReminders.current.add(b.id);
        created.push({
          id: b.id,
          text: `Сеанс «${b.customer_name || "—"}» · ${b.resource_name || ""} заканчивается через 5 минут (${formatTime(b.ends_at)}).`,
          at: Date.now(),
        });
      }
    }
    if (created.length) {
      setReminders((prev) => [...prev, ...created]);
    }
    // Auto-dismiss after 60s.
    setReminders((prev) => prev.filter((r) => Date.now() - r.at < 60_000));
  }, [now, bookings]);

  const season = seasonForDate(anchor);
  const resourceCount = resources?.length ?? 0;

  // «Опаздывает 15+ мин» — бронь подтверждена, время начала прошло, чек-ина нет.
  // Показываем баннер с подтверждением (не пришёл / пришёл), чтобы ресепшен решил.
  const lateForCheckIn = useMemo(() => {
    return rawBookings.filter((b) => {
      if (b.status !== "confirmed") return false;
      const startsMs = new Date(b.starts_at).getTime();
      const endsMs = new Date(b.ends_at).getTime();
      const overdueMs = now - startsMs;
      // 15 минут после старта и до 60 минут после конца окна (чтобы не висело вечно).
      return overdueMs >= 15 * 60_000 && now <= endsMs + 60 * 60_000;
    }).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [rawBookings, now]);

  function shift(n: number) {
    if (view === "week") setAnchor(addDays(anchor, n * 7));
    else setAnchor(addDays(anchor, n));
  }

  return (
    <div className="page max-w-[1600px]" data-testid="dashboard-page">
      {/* Breadcrumb + season badge */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div className="text-sm text-stone-500">
          <span className="text-brand font-medium">Крылатское</span>
          <span className="mx-2">/</span>
          <span>Сессии · {fmtDDMM(anchor)}</span>
        </div>
        <SeasonBadge season={season} />
      </div>

      {/* Late-checkin confirm banner */}
      {lateForCheckIn.length > 0 && (
        <LateCheckInBanner
          bookings={lateForCheckIn}
          onCame={(id) => transition.mutate({ id, to: "checked_in" })}
          onNoShow={(id) => transition.mutate({ id, to: "no_show", reason: "не пришёл" })}
          pending={transition.isPending}
          isInstructor={isInstructor}
        />
      )}

      {/* Title + subtitle + nav */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="page-title">Сессии</h1>
          <div className="text-stone-600 mt-1">
            {fmtLongEn(anchor)} · {resourceCount} ресурсов доступно
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button className="btn-ghost bg-white border border-stone-200 rounded-lg" onClick={() => shift(-1)} data-testid="prev">
            <ChevronLeft size={18} />
          </button>
          <button className="btn-ghost bg-white border border-stone-200 rounded-lg" onClick={() => shift(1)} data-testid="next">
            <ChevronRight size={18} />
          </button>
          <button
            className="btn-ghost bg-white border border-stone-200 rounded-lg text-sm"
            onClick={() => setAnchor(toISO(new Date()))}
            data-testid="today"
          >
            Сегодня
          </button>
          {canCreateBookings && (
            <button
              onClick={() => setDialog("new")}
              className="flex items-center gap-2 bg-brand-gold hover:brightness-95 text-white font-medium rounded-lg px-4 py-2 shadow-sm"
              data-testid="new-booking"
            >
              <Plus size={18} /> Создать бронь
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-3 overflow-x-auto">
        <div className="inline-flex min-w-max gap-1 bg-brand-gold/15 rounded-xl p-1">
        <TabButton active={view === "day"} onClick={() => setView("day")} icon={CalendarDays}>
          День
        </TabButton>
        <TabButton active={view === "week"} onClick={() => setView("week")} icon={CalendarRange}>
          Неделя
        </TabButton>
        {!isInstructor && (
          <TabButton active={view === "trainers"} onClick={() => setView("trainers")} icon={GraduationCap}>
            Тренеры
          </TabButton>
        )}
          <TabButton active={view === "resources"} onClick={() => setView("resources")} icon={LayoutGrid}>
            Ресурсы
          </TabButton>
        </div>
      </div>

      {/* Filter bar — применяется ко всем вкладкам.
          Тренер видит только свои брони, поэтому фильтр по тренерам ему не нужен
          и список других тренеров не должен ему засветиться. */}
      <FilterBar
        instructors={instructors}
        services={services}
        trainerFilter={trainerFilter}
        serviceFilter={serviceFilter}
        onTrainerChange={setTrainerFilter}
        onServiceChange={setServiceFilter}
        hideTrainerFilter={isInstructor}
      />

      {/* Body */}
      {view === "day" && (
        <DayTimeline
          date={anchor}
          bookings={bookings}
          onOpen={setDialog}
          now={now}
          onTransition={(id, to, reason) => transition.mutate({ id, to, reason })}
          onDelete={(id) => del.mutate(id)}
          onExtend={setExtendFor}
          isInstructor={isInstructor}
          canEditBookings={canEditBookings}
          canDeleteBookings={canDeleteBookings}
        />
      )}

      {view === "week" && (
        <WeekTimeline
          anchor={anchor}
          days={weekDays}
          bookings={bookings}
          onOpen={setDialog}
          now={now}
          onTransition={(id, to, reason) => transition.mutate({ id, to, reason })}
          onDelete={(id) => del.mutate(id)}
          onExtend={setExtendFor}
          isInstructor={isInstructor}
          canEditBookings={canEditBookings}
          canDeleteBookings={canDeleteBookings}
        />
      )}

      {view === "trainers" && !isInstructor && (
        <TrainersTimeline
          date={anchor}
          bookings={bookings}
          instructors={instructors}
          onOpen={setDialog}
          now={now}
          onTransition={(id, to, reason) => transition.mutate({ id, to, reason })}
          onDelete={(id) => del.mutate(id)}
          onExtend={setExtendFor}
          isInstructor={isInstructor}
          canEditBookings={canEditBookings}
          canDeleteBookings={canDeleteBookings}
        />
      )}

      {view === "resources" && (
        <ResourcesTimeline
          date={anchor}
          bookings={bookings}
          resources={resources || []}
          zones={zones}
          onOpen={setDialog}
          now={now}
          onTransition={(id, to, reason) => transition.mutate({ id, to, reason })}
          onDelete={(id) => del.mutate(id)}
          onExtend={setExtendFor}
          isInstructor={isInstructor}
          canEditBookings={canEditBookings}
          canDeleteBookings={canDeleteBookings}
        />
      )}

      {/* Reminder toasts — сверху справа, авто-скрытие через 60 секунд */}
      {reminders.length > 0 && (
        <div className="fixed top-6 right-6 z-40 flex flex-col gap-2 max-w-sm">
          {reminders.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg shadow-lg px-4 py-3 text-sm"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">{r.text}</div>
              <button
                className="text-amber-700 hover:text-amber-900"
                onClick={() => setReminders((prev) => prev.filter((x) => x.id !== r.id))}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Status legend */}
      <Legend />

      {dialog === "new" && (
        <BookingScenarioDialog
          date={anchor}
          time="10:00"
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && dialog !== "new" && (
        <BookingDialog mode="edit" booking={dialog} onClose={() => setDialog(null)} />
      )}
      {extendFor && (
        <ExtendDialog
          booking={extendFor}
          onClose={() => setExtendFor(null)}
          onSubmit={(minutes) => extend.mutate({ id: extendFor.id, minutes })}
          pending={extend.isPending}
          error={extend.error as Error | null}
        />
      )}
    </div>
  );
}

/* ───────── components ───────── */

function TabButton({
  active, onClick, icon: Icon, children,
}: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition",
        active ? "bg-white text-brand shadow-sm" : "text-stone-700 hover:bg-white/60"
      )}
    >
      <Icon size={16} /> {children}
    </button>
  );
}

function SeasonBadge({ season }: { season: "winter" | "summer" }) {
  const isWinter = season === "winter";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
        isWinter
          ? "bg-blue-50 border-blue-200 text-blue-700"
          : "bg-amber-50 border-amber-200 text-amber-800"
      )}
    >
      {isWinter ? <Snowflake size={16} /> : <Sun size={16} />}
      {isWinter ? "Зимний сезон" : "Летний сезон"}
    </div>
  );
}

function seasonForDate(iso: string): "winter" | "summer" {
  const m = new Date(iso + "T00:00:00").getMonth() + 1;
  return m <= 3 || m >= 11 ? "winter" : "summer";
}

/* ───────── hour gutter ───────── */

function HourGutter() {
  // 24 labels: 00, 01, … 23. Each label sits just below its own hour line —
  // it represents the BEGINNING of that hour. We don't draw "24" because it
  // would coincide with "00" of the next day; the bottom border already
  // marks end-of-day visually.
  const hourCount = (CLOSE_MIN - OPEN_MIN) / 60;
  const hours = Array.from({ length: hourCount }, (_, i) => OPEN_MIN / 60 + i);
  return (
    <div className="relative w-12 shrink-0 bg-stone-50 border-r border-stone-200 sm:w-14" style={{ height: TOTAL_HEIGHT + 32 }}>
      <div className="h-8 border-b border-stone-200" />
      <div className="relative" style={{ height: TOTAL_HEIGHT }}>
        {hours.map((h, i) => (
          <div
            key={h}
            className="absolute right-1.5 text-xs leading-none text-stone-500 font-medium tabular-nums sm:right-2 sm:text-sm"
            style={{ top: i * HOUR_HEIGHT + 4 }}
          >
            {String(h).padStart(2, "0")}:00
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineColumn({
  title, bookings, isToday, onOpen, highlight, now, onTransition, onDelete, onExtend,
  isInstructor, canEditBookings, canDeleteBookings,
}: {
  title: string;
  bookings: Booking[];
  isToday?: boolean;
  onOpen: (b: Booking) => void;
  highlight?: boolean;
  now: number;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const colMap = useMemo(() => assignColumns(bookings), [bookings]);

  // Красная линия "сейчас" — показываем только в колонке текущего дня,
  // если время попадает в визуальный диапазон суток [00:00..24:00].
  const nowDate = new Date(now);
  const nowMinutesInDay = nowDate.getHours() * 60 + nowDate.getMinutes();
  const showNowLine =
    !!isToday &&
    nowMinutesInDay >= OPEN_MIN &&
    nowMinutesInDay <= CLOSE_MIN;
  const nowTop = ((nowMinutesInDay - OPEN_MIN) / 60) * HOUR_HEIGHT;
  const nowLabel = `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="flex-1 min-w-[10rem] border-r border-stone-200 last:border-r-0 sm:min-w-[11rem]">
      <div className={cn(
        "h-8 border-b border-stone-200 text-center text-sm font-semibold",
        isToday ? "bg-brand/10 text-brand" : "bg-stone-50 text-stone-700"
      )}>
        {title}
      </div>
      <div
        className={cn("relative", highlight ? "bg-amber-50/40" : "bg-amber-50/20")}
        style={{ height: TOTAL_HEIGHT }}
      >
        {/* Hour grid lines */}
        {Array.from({ length: (CLOSE_MIN - OPEN_MIN) / 60 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-stone-200"
            style={{ top: i * HOUR_HEIGHT, height: 1 }}
          />
        ))}
        <div
          className="absolute left-0 right-0 border-t border-stone-300"
          style={{ top: TOTAL_HEIGHT }}
        />

        {/* Red "now" line — visible only in today's column */}
        {showNowLine && (
          <div
            className="absolute left-0 right-0 pointer-events-none z-[5]"
            style={{ top: nowTop }}
          >
            <div className="relative h-0 border-t-2 border-red-500">
              <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500 shadow" />
              <div className="absolute left-2 -top-2 text-[10px] font-semibold text-red-600 bg-white/80 rounded px-1">
                сейчас · {nowLabel}
              </div>
            </div>
          </div>
        )}

        {/* Bookings */}
        {bookings.map((b) => {
          const s = minutesInDay(b.starts_at) - OPEN_MIN;
          const e = minutesInDay(b.ends_at) - OPEN_MIN;
          const top = Math.max(0, (s / 60) * HOUR_HEIGHT);
          const height = Math.max(((e - s) / 60) * HOUR_HEIGHT - 2, 28);
          const entry = colMap.get(b.id) || { col: 0, cols: 1 };
          const widthPct = 100 / entry.cols;
          const startsMs = new Date(b.starts_at).getTime();
          const isLate = b.status === "confirmed" && now >= startsMs;
          return (
            <div
              key={b.id}
              className={cn(
                "group absolute rounded-md text-white shadow-sm overflow-hidden",
                isLate ? statusBg("late") : statusBg(b.status),
                isLate && "ring-2 ring-orange-300"
              )}
              style={{
                top, height,
                left: `calc(${entry.col * widthPct}% + 4px)`,
                width: `calc(${widthPct}% - 8px)`,
              }}
              data-testid={`booking-${b.id}`}
            >
              <button
                type="button"
                onClick={() => { if (!isInstructor) onOpen(b); }}
                className={cn(
                  "block w-full h-full text-left px-2 py-1.5 transition",
                  isInstructor ? "cursor-default" : "hover:brightness-110"
                )}
                title={`${b.customer_name || "—"} · ${b.service_name || ""} · ${b.resource_name || ""} · ${formatRub(b.total_kopecks)}`}
              >
                <div className="text-[11px] opacity-85 font-mono">
                  {formatTime(b.starts_at)} - {formatTime(b.ends_at)}
                  {isLate && <span className="ml-2 font-semibold">· опаздывает</span>}
                </div>
                <div className="text-sm font-semibold truncate leading-tight mt-0.5">
                  {b.customer_name || "—"}
                </div>
                <div className="hidden text-[11px] opacity-90 truncate sm:block">{b.resource_name || ""}</div>
                {height > 60 && (
                  <div className="hidden text-[11px] opacity-80 truncate sm:block">{b.service_name || ""}</div>
                )}
              </button>

              {/* Дропдаун-меню действий над бронью */}
              <ActionsMenu
                booking={b}
                onOpen={onOpen}
                onTransition={onTransition}
                onDelete={onDelete}
                onExtend={onExtend}
                isInstructor={isInstructor}
                canEditBookings={canEditBookings}
                canDeleteBookings={canDeleteBookings}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionsMenu({
  booking, onOpen, onTransition, onDelete, onExtend, isInstructor, canEditBookings, canDeleteBookings,
}: {
  booking: Booking;
  onOpen: (b: Booking) => void;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 200;
  const MENU_MIN_HEIGHT = 220;

  const openMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer below-right; flip up if no space, slide left if overflow.
    let top = r.bottom + 4;
    if (top + MENU_MIN_HEIGHT > vh) top = Math.max(8, r.top - MENU_MIN_HEIGHT - 4);
    let left = r.right - MENU_WIDTH;
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > vw - 8) left = vw - MENU_WIDTH - 8;
    setMenuPos({ top, left });
  };

  const closeMenu = () => setMenuPos(null);
  const open = menuPos !== null;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      closeMenu();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    const onScroll = () => closeMenu(); // close on any scroll so the menu never floats away
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open]);

  // Transition matrix mirrors backend `_TRANSITIONS` so we show all possible
  // state changes and grey out the ones not allowed from the current status.
  const allowed: Record<string, Set<string>> = {
    draft: new Set(["confirmed", "cancelled"]),
    confirmed: new Set(["checked_in", "cancelled", "no_show", "completed"]),
    checked_in: new Set(["completed", "cancelled", "no_show"]),
    completed: new Set(),
    cancelled: new Set(),
    no_show: new Set(["completed", "checked_in", "confirmed"]),
  };
  const ok = allowed[booking.status] || new Set<string>();

  type Item = {
    label: string;
    icon: any;
    tone: string;
    run: () => void;
    disabled?: boolean;
    disabledReason?: string;
    divider?: boolean;
  };

  const statusActions: Array<{ to: string; label: string; icon: any; tone: string; reason?: string }> = [
    { to: "confirmed", label: "Подтвердить", icon: CircleCheck, tone: "text-brand hover:bg-brand/10" },
    { to: "checked_in", label: "Пришёл", icon: Check, tone: "text-blue-700 hover:bg-blue-50" },
    { to: "no_show", label: "Не пришёл", icon: XIcon, tone: "text-rose-700 hover:bg-rose-50", reason: "не пришёл" },
    { to: "completed", label: "Завершить", icon: CheckCheck, tone: "text-emerald-700 hover:bg-emerald-50" },
  ];

  const items: Item[] = [];

  // Менеджер / ресепшен — может открыть полное редактирование и удалить.
  // Тренер — не видит эти пункты.
  if (canEditBookings) {
    items.push({
      label: "Изменить параметры",
      icon: Pencil,
      tone: "text-stone-700 hover:bg-stone-100",
      run: () => { closeMenu(); onOpen(booking); },
    });
  }

  // Для тренера доступна только кнопка «Пришёл».
  const allowedForInstructor = new Set(["checked_in"]);

  for (const a of statusActions) {
    if (booking.status === a.to) continue;
    if (isInstructor && !allowedForInstructor.has(a.to)) continue;
    const ok_here = ok.has(a.to);
    items.push({
      label: a.label,
      icon: a.icon,
      tone: a.tone,
      disabled: !ok_here,
      disabledReason: !ok_here ? `Из статуса «${statusLabel(booking.status)}» нельзя` : undefined,
      run: () => {
        closeMenu();
        onTransition(booking.id, a.to, a.reason || "");
      },
    });
  }

  // «Продлить» — доступно всем, кто может редактировать брони (admin/manager/staff + тренер).
  // Запрещено для завершённых/отменённых — в таком состоянии бэкенд всё равно откажет.
  if (
    canEditBookings &&
    booking.status !== "completed" &&
    booking.status !== "cancelled"
  ) {
    items.push({
      label: "Продлить",
      icon: Clock,
      tone: "text-indigo-700 hover:bg-indigo-50",
      divider: true,
      run: () => { closeMenu(); onExtend(booking); },
    });
  }

  if (canDeleteBookings) {
    items.push({
      label: "Удалить",
      icon: Trash2,
      tone: "text-rose-600 hover:bg-rose-50",
      divider: true,
      run: () => {
        closeMenu();
        if (confirm(`Удалить бронь «${booking.customer_name || "#" + booking.id}»?`)) {
          onDelete(booking.id);
        }
      },
    });
  }

  if (items.length === 0) return null; // nothing to offer

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Действия"
        onClick={(e) => {
          e.stopPropagation();
          if (open) closeMenu(); else openMenu();
        }}
        className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded bg-white/25 hover:bg-white/50 text-white transition"
      >
        <ChevronDown size={14} />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH, zIndex: 1000 }}
          className="bg-white text-stone-800 rounded-lg shadow-2xl border border-stone-200 py-1 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.divider && <div className="my-1 border-t border-stone-100" />}
              <button
                type="button"
                onClick={it.run}
                disabled={it.disabled}
                title={it.disabledReason}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition",
                  it.disabled ? "text-stone-300 cursor-not-allowed" : it.tone
                )}
              >
                <it.icon size={14} /> {it.label}
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function DayTimeline({
  date, bookings, onOpen, now, onTransition, onDelete, onExtend, isInstructor, canEditBookings, canDeleteBookings,
}: {
  date: string; bookings: Booking[]; onOpen: (b: Booking) => void;
  now: number;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const todayISO = toISO(new Date());
  return (
    <div className="card p-0 overflow-x-auto overflow-y-visible">
      <div className="flex min-w-[22rem]" style={{ height: TOTAL_HEIGHT + 32 }}>
        <HourGutter />
        <TimelineColumn
          title={fmtRuWeekday(date)}
          bookings={bookings}
          isToday={date === todayISO}
          onOpen={onOpen}
          highlight={date === todayISO}
          now={now}
          onTransition={onTransition}
          onDelete={onDelete}
          onExtend={onExtend}
          isInstructor={isInstructor}
          canEditBookings={canEditBookings}
          canDeleteBookings={canDeleteBookings}
        />
      </div>
    </div>
  );
}

function WeekTimeline({
  anchor, days, bookings, onOpen, now, onTransition, onDelete, onExtend, isInstructor, canEditBookings, canDeleteBookings,
}: {
  anchor: string;
  days: string[];
  bookings: Booking[];
  onOpen: (b: Booking) => void;
  now: number;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const byDay = useMemo(() => {
    const m: Record<string, Booking[]> = {};
    for (const b of bookings) (m[b.starts_at.slice(0, 10)] ??= []).push(b);
    return m;
  }, [bookings]);

  return (
    <div className="card p-0 overflow-x-auto overflow-y-visible">
      <div className="flex min-w-[78rem]" style={{ height: TOTAL_HEIGHT + 32 }}>
        <HourGutter />
        {days.map((d) => (
          <TimelineColumn
            key={d}
            title={fmtShortDay(d)}
            bookings={byDay[d] || []}
            isToday={d === toISO(new Date())}
            highlight={d === anchor}
            onOpen={onOpen}
            now={now}
            onTransition={onTransition}
            onDelete={onDelete}
            onExtend={onExtend}
            isInstructor={isInstructor}
            canEditBookings={canEditBookings}
            canDeleteBookings={canDeleteBookings}
          />
        ))}
      </div>
    </div>
  );
}

function Legend() {
  const items: Array<{ label: string; bg: string }> = [
    { label: "Подтверждена", bg: "bg-brand" },
    { label: "Опаздывает", bg: "bg-orange-500" },
    { label: "Пришёл (check-in)", bg: "bg-blue-500" },
    { label: "Не пришёл", bg: "bg-rose-500" },
    { label: "Завершена", bg: "bg-emerald-600" },
  ];
  return (
    <div className="mt-6 card">
      <div className="font-semibold text-lg mb-3">Легенда статусов</div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {items.map((it) => (
          <span
            key={it.label}
            className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-white text-sm", it.bg)}
          >
            {it.label}
          </span>
        ))}
        <span className="text-stone-500">
          · нажмите ▾ в правом верхнем углу брони — доступны «Изменить / Пришёл / Не пришёл / Завершить / Удалить»
        </span>
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  const m: Record<string, string> = {
    confirmed: "Подтверждена",
    checked_in: "Пришёл",
    completed: "Завершена",
    cancelled: "Отменена",
    no_show: "Не пришёл",
    draft: "Черновик",
    late: "Опаздывает",
  };
  return m[status] ?? status;
}

function statusBg(status: string) {
  const m: Record<string, string> = {
    confirmed: "bg-brand",
    checked_in: "bg-blue-500",
    completed: "bg-emerald-600",
    cancelled: "bg-red-500",
    no_show: "bg-rose-500",
    draft: "bg-stone-500",
    late: "bg-orange-500",
  };
  return m[status] ?? "bg-stone-500";
}

/* ───────── Filter bar ───────── */

function FilterBar({
  instructors, services, trainerFilter, serviceFilter,
  onTrainerChange, onServiceChange, hideTrainerFilter = false,
}: {
  instructors: Instructor[];
  services: Service[];
  trainerFilter: number[];
  serviceFilter: number[];
  onTrainerChange: (ids: number[]) => void;
  onServiceChange: (ids: number[]) => void;
  hideTrainerFilter?: boolean;
}) {
  const totalActive = (hideTrainerFilter ? 0 : trainerFilter.length) + serviceFilter.length;
  return (
    <div className="flex items-center gap-2 flex-wrap mb-5">
      <span className="inline-flex items-center gap-1.5 text-sm text-stone-600">
        <Filter size={14} /> Фильтр:
      </span>
      {!hideTrainerFilter && (
        <MultiSelect
          label="Тренер"
          options={instructors.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, color: i.color }))}
          selected={trainerFilter}
          onChange={onTrainerChange}
        />
      )}
      <ServiceMultiSelect
        services={services}
        selected={serviceFilter}
        onChange={onServiceChange}
      />
      {totalActive > 0 && (
        <button
          type="button"
          className="text-xs text-stone-500 hover:text-stone-800 underline"
          onClick={() => { if (!hideTrainerFilter) onTrainerChange([]); onServiceChange([]); }}
        >
          Сбросить ({totalActive})
        </button>
      )}
    </div>
  );
}

function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: Array<{ id: number; name: string; color?: string }>;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const labels = options.filter((o) => selected.includes(o.id)).map((o) => o.name);
  const display =
    selected.length === 0 ? label :
    selected.length === 1 ? `${label}: ${labels[0]}` :
    `${label}: ${selected.length}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition",
          selected.length > 0
            ? "bg-brand/10 border-brand/40 text-brand font-medium"
            : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50"
        )}
      >
        {display}
        <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 max-h-72 overflow-y-auto bg-white rounded-lg shadow-xl border border-stone-200 py-1">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-stone-400">Нет элементов</div>
          )}
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    onChange(on ? selected.filter((x) => x !== o.id) : [...selected, o.id]);
                  }}
                />
                {o.color && (
                  <span className="w-2.5 h-2.5 rounded-full border border-stone-300" style={{ background: o.color }} />
                )}
                <span className="flex-1 truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────── Service grouping ───────── */

const SERVICE_CATEGORY_ORDER: Array<{ key: string; title: string }> = [
  { key: "course_play",    title: "Игра на поле" },
  { key: "lesson_trial",   title: "Пробные занятия" },
  { key: "lesson",         title: "Тренировки" },
  { key: "lesson_kids",    title: "Детские тренировки" },
  { key: "intro_course",   title: "Вводный курс" },
  { key: "academic_holes", title: "Академические лунки" },
  { key: "driving_range",  title: "Драйвинг-рэндж" },
  { key: "rental",         title: "Аренда" },
];

function canonicalServiceName(name: string): string {
  // "Игра на 9 лунок (будни)" → "Игра на 9 лунок"
  return name.replace(/\s*\((?:будни|выходные|понедельник\/вторник)\)\s*$/iu, "").trim();
}

type ServiceGroup = { key: string; canonical: string; ids: number[]; category: string };
type ServiceCategoryBucket = { category: string; title: string; groups: ServiceGroup[] };

function groupServices(services: Service[]): ServiceCategoryBucket[] {
  const order = new Map(SERVICE_CATEGORY_ORDER.map((c, i) => [c.key, i]));
  const titleByKey = new Map(SERVICE_CATEGORY_ORDER.map((c) => [c.key, c.title]));
  const byKey = new Map<string, ServiceGroup>();
  for (const s of services) {
    if (!s.active) continue;
    const canonical = canonicalServiceName(s.name);
    const key = `${s.category}::${canonical.toLowerCase()}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, canonical, ids: [], category: s.category };
      byKey.set(key, g);
    }
    g.ids.push(s.id);
  }
  const buckets = new Map<string, ServiceGroup[]>();
  for (const g of byKey.values()) {
    if (!buckets.has(g.category)) buckets.set(g.category, []);
    buckets.get(g.category)!.push(g);
  }
  const cats = Array.from(buckets.keys()).sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b),
  );
  return cats.map((cat) => ({
    category: cat,
    title: titleByKey.get(cat) ?? cat,
    groups: buckets.get(cat)!.slice().sort((a, b) => a.canonical.localeCompare(b.canonical, "ru")),
  }));
}

function ServiceMultiSelect({
  services, selected, onChange,
}: {
  services: Service[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const buckets = useMemo(() => groupServices(services), [services]);
  const allGroups = useMemo(() => buckets.flatMap((b) => b.groups), [buckets]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // A group counts as "selected" iff every underlying service_id is in selected.
  const isGroupFullySelected = (g: ServiceGroup) => g.ids.every((id) => selectedSet.has(id));
  const isGroupPartial = (g: ServiceGroup) =>
    !isGroupFullySelected(g) && g.ids.some((id) => selectedSet.has(id));

  const fullySelectedGroups = allGroups.filter(isGroupFullySelected);
  const display =
    fullySelectedGroups.length === 0 ? "Услуга" :
    fullySelectedGroups.length === 1 ? `Услуга: ${fullySelectedGroups[0].canonical}` :
    `Услуга: ${fullySelectedGroups.length}`;

  const toggleGroup = (g: ServiceGroup) => {
    const next = new Set(selectedSet);
    if (isGroupFullySelected(g)) {
      for (const id of g.ids) next.delete(id);
    } else {
      for (const id of g.ids) next.add(id);
    }
    onChange(Array.from(next));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition",
          fullySelectedGroups.length > 0
            ? "bg-brand/10 border-brand/40 text-brand font-medium"
            : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50",
        )}
      >
        {display}
        <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[calc(100vw-2rem)] max-w-[28rem] max-h-80 overflow-y-auto bg-white rounded-lg shadow-xl border border-stone-200 py-1 sm:min-w-[22rem]">
          {buckets.length === 0 && (
            <div className="px-3 py-2 text-sm text-stone-400">Нет услуг</div>
          )}
          {buckets.map((bucket) => (
            <div key={bucket.category}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                {bucket.title}
              </div>
              {bucket.groups.map((g) => {
                const full = isGroupFullySelected(g);
                const partial = isGroupPartial(g);
                return (
                  <label
                    key={g.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={full}
                      ref={(el) => { if (el) el.indeterminate = partial; }}
                      onChange={() => toggleGroup(g)}
                    />
                    <span className="flex-1 whitespace-normal">{g.canonical}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── Trainers view ───────── */

function TrainersTimeline({
  date, bookings, instructors, onOpen, now, onTransition, onDelete, onExtend,
  isInstructor, canEditBookings, canDeleteBookings,
}: {
  date: string;
  bookings: Booking[];
  instructors: Instructor[];
  onOpen: (b: Booking) => void;
  now: number;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const todayISO = toISO(new Date());

  // Группировка броней по тренеру + показ только тех тренеров, у которых >=1 бронь.
  const byTrainer = useMemo(() => {
    const m: Record<number, Booking[]> = {};
    for (const b of bookings) {
      if (!b.instructor_id) continue;
      (m[b.instructor_id] ??= []).push(b);
    }
    return m;
  }, [bookings]);

  const visibleTrainers = useMemo(() => {
    const ids = Object.keys(byTrainer).map(Number);
    const byId = new Map(instructors.map((i) => [i.id, i]));
    return ids
      .map((id) => byId.get(id) || { id, name: `Тренер #${id}`, color: "#999", specialization: "", bio: "", phone: "", email: "", active: true })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [byTrainer, instructors]);

  if (visibleTrainers.length === 0) {
    return (
      <div className="card text-center py-16 text-stone-500">
        <GraduationCap size={32} className="mx-auto mb-2 text-stone-300" />
        На {fmtDDMM(date)} нет записей к тренерам.
        <div className="text-xs text-stone-400 mt-1">Столбик тренера появится, когда к нему запишется хотя бы один клиент.</div>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-auto">
      <div className="flex min-w-[36rem]" style={{ minHeight: TOTAL_HEIGHT + 32 }}>
        <HourGutter />
        {visibleTrainers.map((t) => (
          <TimelineColumn
            key={t.id}
            title={t.name}
            bookings={byTrainer[t.id] || []}
            isToday={date === todayISO}
            onOpen={onOpen}
            highlight={date === todayISO}
            now={now}
            onTransition={onTransition}
            onDelete={onDelete}
            onExtend={onExtend}
            isInstructor={isInstructor}
            canEditBookings={canEditBookings}
            canDeleteBookings={canDeleteBookings}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────── Resources view (Range 24 + Лунки 19/20) ───────── */

function ResourcesTimeline({
  date, bookings, resources, zones, onOpen, now, onTransition, onDelete, onExtend,
  isInstructor, canEditBookings, canDeleteBookings,
}: {
  date: string;
  bookings: Booking[];
  resources: Resource[];
  zones: Zone[];
  onOpen: (b: Booking) => void;
  now: number;
  onTransition: (id: number, to: string, reason?: string) => void;
  onDelete: (id: number) => void;
  onExtend: (b: Booking) => void;
  isInstructor: boolean;
  canEditBookings: boolean;
  canDeleteBookings: boolean;
}) {
  const todayISO = toISO(new Date());

  // Отбираем только ресурсы зон: driving (24 бокса) + academic (лунки 19/20).
  const targetZoneIds = useMemo(() => {
    return new Set(
      zones.filter((z) => z.code === "driving" || z.code === "academic").map((z) => z.id)
    );
  }, [zones]);

  const targetResources = useMemo(() => {
    return resources.filter((r) => targetZoneIds.has(r.zone_id));
  }, [resources, targetZoneIds]);

  const byResource = useMemo(() => {
    const m: Record<number, Booking[]> = {};
    for (const b of bookings) {
      if (!b.resource_id) continue;
      (m[b.resource_id] ??= []).push(b);
    }
    return m;
  }, [bookings]);

  const visibleResources = useMemo(() => {
    return targetResources
      .filter((r) => (byResource[r.id] || []).length > 0)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [targetResources, byResource]);

  if (visibleResources.length === 0) {
    return (
      <div className="card text-center py-16 text-stone-500">
        <LayoutGrid size={32} className="mx-auto mb-2 text-stone-300" />
        На {fmtDDMM(date)} нет записей на Драйвинг-рэндж и Лунки 19/20.
        <div className="text-xs text-stone-400 mt-1">Столбик ресурса появится, когда в него запишут хотя бы одну сессию.</div>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-auto">
      <div className="flex min-w-[36rem]" style={{ minHeight: TOTAL_HEIGHT + 32 }}>
        <HourGutter />
        {visibleResources.map((r) => (
          <TimelineColumn
            key={r.id}
            title={r.name}
            bookings={byResource[r.id] || []}
            isToday={date === todayISO}
            onOpen={onOpen}
            highlight={date === todayISO}
            now={now}
            onTransition={onTransition}
            onDelete={onDelete}
            onExtend={onExtend}
            isInstructor={isInstructor}
            canEditBookings={canEditBookings}
            canDeleteBookings={canDeleteBookings}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────── Late check-in banner ───────── */

function LateCheckInBanner({
  bookings, onCame, onNoShow, pending, isInstructor,
}: {
  bookings: Booking[];
  onCame: (id: number) => void;
  onNoShow: (id: number) => void;
  pending: boolean;
  isInstructor: boolean;
}) {
  return (
    <div
      className="mb-5 rounded-xl border-2 border-orange-300 bg-orange-50 px-4 py-3 shadow-sm"
      data-testid="late-checkin-banner"
    >
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="text-orange-600 mt-0.5 shrink-0" size={18} />
        <div className="text-sm text-orange-900">
          <div className="font-semibold">
            Опаздывают и не отмечены ({bookings.length})
          </div>
          <div className="text-xs text-orange-800/80">
            {isInstructor
              ? "Если гость пришёл — нажми «Пришёл». Пометить «Не пришёл» может только ресепшен."
              : "Подтверди, пришёл ли гость. Если ничего не сделать — система через какое-то время сама пометит как «не пришёл»."}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {bookings.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between gap-3 bg-white border border-orange-200 rounded-lg px-3 py-2"
            data-testid={`late-row-${b.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-stone-800 truncate">
                {b.customer_name || `Бронь #${b.id}`}
              </div>
              <div className="text-xs text-stone-500 truncate">
                {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                {b.resource_name && <> · {b.resource_name}</>}
                {b.instructor_name && <> · тренер {b.instructor_name}</>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={pending}
                onClick={() => onCame(b.id)}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
                data-testid={`late-came-${b.id}`}
              >
                <Check size={14} /> Пришёл
              </button>
              {!isInstructor && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onNoShow(b.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
                  data-testid={`late-noshow-${b.id}`}
                >
                  <XIcon size={14} /> Не пришёл
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── Extend dialog ───────── */

function ExtendDialog({
  booking, onClose, onSubmit, pending, error,
}: {
  booking: Booking;
  onClose: () => void;
  onSubmit: (minutes: number) => void;
  pending: boolean;
  error: Error | null;
}) {
  const endsAt = new Date(booking.ends_at);
  const startsAt = new Date(booking.starts_at);
  const endHours = String(endsAt.getHours()).padStart(2, "0");
  const endMinutes = String(endsAt.getMinutes()).padStart(2, "0");
  const currentEnd = `${endHours}:${endMinutes}`;

  const [target, setTarget] = useState(() => {
    const d = new Date(booking.ends_at);
    d.setMinutes(d.getMinutes() + 30);
    const maxMins = 22 * 60;
    let m = d.getHours() * 60 + d.getMinutes();
    if (m > maxMins) m = maxMins;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });

  const minutes = useMemo(() => {
    const [hh, mm] = target.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
    const newEnd = new Date(endsAt);
    newEnd.setHours(hh, mm, 0, 0);
    return Math.round((newEnd.getTime() - endsAt.getTime()) / 60000);
  }, [target, booking.ends_at]);

  const currentDurationMin = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));
  const newDurationMin = currentDurationMin + Math.max(0, minutes);
  const estimatedTotal = Math.round(
    (booking.total_kopecks / currentDurationMin) * newDurationMin
  );
  const deltaKopecks = estimatedTotal - booking.total_kopecks;

  const invalid = minutes <= 0 || minutes > 240;

  return (
    <div
      className="modal-overlay bg-black/30"
      onClick={onClose}
    >
      <div
        className="modal-panel max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-stone-200 flex items-center gap-2">
          <Clock size={18} className="text-indigo-600" />
          <div className="text-lg font-semibold">Продлить бронь</div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="text-sm text-stone-600">
            <div>
              <span className="text-stone-400">Клиент:</span>{" "}
              <span className="font-medium">{booking.customer_name || "—"}</span>
            </div>
            <div>
              <span className="text-stone-400">Сейчас до:</span>{" "}
              <span className="font-mono">{currentEnd}</span>
            </div>
            {booking.resource_name && (
              <div>
                <span className="text-stone-400">Ресурс:</span> {booking.resource_name}
              </div>
            )}
            {booking.instructor_name && (
              <div>
                <span className="text-stone-400">Тренер:</span> {booking.instructor_name}
              </div>
            )}
          </div>

          <div>
            <label className="label">Продлить до</label>
            <input
              type="time"
              className="input w-40"
              value={target}
              min={currentEnd}
              max="22:00"
              step={60}
              onChange={(e) => setTarget(e.target.value)}
              data-testid="extend-target"
            />
            <div className="text-xs text-stone-500 mt-1">
              Макс. продление: 240 минут. Должно быть после {currentEnd}.
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {[15, 30, 45, 60, 90].map((n) => (
              <button
                key={n}
                type="button"
                className="text-xs px-3 py-1 rounded-full border border-stone-300 hover:bg-stone-50"
                onClick={() => {
                  const d = new Date(endsAt);
                  d.setMinutes(d.getMinutes() + n);
                  const maxMins = 22 * 60;
                  let m = d.getHours() * 60 + d.getMinutes();
                  if (m > maxMins) m = maxMins;
                  setTarget(
                    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
                  );
                }}
              >
                +{n} мин
              </button>
            ))}
          </div>

          {!invalid && (
            <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-stone-500">Добавится</span>
                <span className="font-mono">+{minutes} мин</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Текущая стоимость</span>
                <span className="font-mono">{formatRub(booking.total_kopecks)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Доплата (≈)</span>
                <span className="font-mono text-emerald-700">+{formatRub(Math.max(0, deltaKopecks))}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Итого (≈)</span>
                <span className="font-mono text-brand">{formatRub(estimatedTotal)}</span>
              </div>
              <div className="text-[11px] text-stone-400">
                Финальную цену пересчитает сервер по прайсу услуги.
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
              {error.message}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-200 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={pending}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={invalid || pending}
            onClick={() => onSubmit(minutes)}
            data-testid="extend-submit"
          >
            {pending ? "Продлеваем…" : "Продлить"}
          </button>
        </div>
      </div>
    </div>
  );
}
