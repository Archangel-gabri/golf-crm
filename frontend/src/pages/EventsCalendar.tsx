import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Baby, BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Circle,
  Clock, Flag, MapPin, PartyPopper, Pencil, Plus, Save, Trash2, Trophy,
  Users, Wrench, X, type LucideIcon,
} from "lucide-react";
import { api, type ClubEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

type EventForm = {
  id?: number;
  title: string;
  category: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  capacity: string;
  color: string;
  description: string;
  active: boolean;
};

const CATEGORIES: Array<{ code: string; label: string; color: string; Icon: LucideIcon }> = [
  { code: "tournament", label: "Турнир", color: "#155E3F", Icon: Trophy },
  { code: "corporate", label: "Корпоратив", color: "#3A6EA5", Icon: BriefcaseBusiness },
  { code: "kids", label: "Детское", color: "#8B5A96", Icon: Baby },
  { code: "club", label: "Клубное", color: "#C9A961", Icon: Flag },
  { code: "maintenance", label: "Техработы", color: "#B98A3C", Icon: Wrench },
  { code: "holiday", label: "Праздник", color: "#B91C1C", Icon: PartyPopper },
  { code: "other", label: "Другое", color: "#78716C", Icon: Circle },
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(d: Date, months: number) {
  const next = new Date(d);
  next.setMonth(next.getMonth() + months, 1);
  return next;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function mondayStart(d: Date) {
  const next = new Date(d);
  const day = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - day);
  return next;
}

function composeISO(day: string, time: string) {
  return `${day}T${time}:00`;
}

function splitDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: toDateISO(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function eventTouchesDay(event: ClubEvent, dayISO: string) {
  const dayStart = new Date(`${dayISO}T00:00:00`).getTime();
  const dayEnd = new Date(`${dayISO}T23:59:59`).getTime();
  return new Date(event.starts_at).getTime() <= dayEnd && new Date(event.ends_at).getTime() >= dayStart;
}

function eventTimeLabel(event: ClubEvent) {
  if (event.all_day) return "Весь день";
  const s = new Date(event.starts_at);
  const e = new Date(event.ends_at);
  return `${pad(s.getHours())}:${pad(s.getMinutes())}–${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function categoryFor(code: string) {
  return CATEGORIES.find((c) => c.code === code) || CATEGORIES[CATEGORIES.length - 1];
}

function hexToRgba(color: string | null | undefined, alpha: number) {
  const raw = (color || "#155E3F").trim();
  const short = raw.match(/^#([0-9a-f]{3})$/i);
  const full = raw.match(/^#([0-9a-f]{6})$/i);
  const hex = full?.[1] || short?.[1]?.split("").map((c) => c + c).join("");
  if (!hex) return `rgba(21, 94, 63, ${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function emptyForm(dayISO: string): EventForm {
  return {
    title: "",
    category: "club",
    startDate: dayISO,
    startTime: "10:00",
    endDate: dayISO,
    endTime: "12:00",
    allDay: false,
    location: "",
    capacity: "",
    color: "#C9A961",
    description: "",
    active: true,
  };
}

function formFromEvent(event: ClubEvent): EventForm {
  const start = splitDateTime(event.starts_at);
  const end = splitDateTime(event.ends_at);
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    allDay: event.all_day,
    location: event.location || "",
    capacity: event.capacity == null ? "" : String(event.capacity),
    color: event.color || categoryFor(event.category).color,
    description: event.description || "",
    active: event.active,
  };
}

function formToPayload(form: EventForm): Partial<ClubEvent> {
  return {
    title: form.title.trim(),
    category: form.category,
    starts_at: composeISO(form.startDate, form.allDay ? "00:00" : form.startTime),
    ends_at: composeISO(form.endDate, form.allDay ? "23:59" : form.endTime),
    all_day: form.allDay,
    location: form.location.trim(),
    description: form.description.trim(),
    capacity: form.capacity.trim() ? Number(form.capacity) : null,
    color: form.color,
    active: form.active,
  };
}

export default function EventsCalendar() {
  const qc = useQueryClient();
  const today = toDateISO(new Date());
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(today);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<EventForm | null>(null);

  const gridStart = useMemo(() => mondayStart(startOfMonth(cursor)), [cursor]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const queryFrom = `${toDateISO(days[0])}T00:00:00`;
  const queryTo = `${toDateISO(days[days.length - 1])}T23:59:59`;

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", queryFrom, queryTo, includeInactive],
    queryFn: () => api.events({ from: queryFrom, to: queryTo, include_inactive: includeInactive }),
  });

  const save = useMutation({
    mutationFn: (form: EventForm) => {
      const payload = formToPayload(form);
      return form.id ? api.updateEvent(form.id, payload) : api.createEvent(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      setEditing(null);
    },
  });

  const monthTitle = cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const selectedEvents = events
    .filter((event) => eventTouchesDay(event, selectedDay))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const upcomingEvents = events
    .filter((event) => new Date(event.ends_at).getTime() >= Date.now() && event.active)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, 6);

  return (
    <div className="page max-w-[1600px]" data-testid="events-calendar-page">
      <div className="page-head mb-5 sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="text-brand" size={26} />
            <h1 className="text-2xl font-semibold sm:text-3xl">Календарь мероприятий</h1>
          </div>
          <p className="text-sm text-stone-500 mt-1">
            Отдельный календарь клубных событий: турниры, корпоративы, детские дни и технические окна.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setEditing(emptyForm(selectedDay))}
          data-testid="new-event-btn"
        >
          <Plus size={16} /> Новое мероприятие
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card p-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Предыдущий месяц">
                <ChevronLeft size={16} />
              </button>
              <button
                className="btn-ghost text-sm"
                onClick={() => {
                  const now = new Date();
                  setCursor(startOfMonth(now));
                  setSelectedDay(toDateISO(now));
                }}
              >
                Сегодня
              </button>
              <button className="btn-ghost" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Следующий месяц">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="text-lg font-semibold capitalize">{monthTitle}</div>
            <label className="inline-flex items-center gap-2 text-sm text-stone-600">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Показывать скрытые
            </label>
          </div>

          <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-2">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayISO = toDateISO(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const dayEvents = events
                .filter((event) => eventTouchesDay(event, dayISO))
                .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
              const isSelected = selectedDay === dayISO;
              const isToday = today === dayISO;
              return (
                <div
                  key={dayISO}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "min-h-[112px] border-b border-r border-stone-100 p-1.5 text-left outline-none transition hover:bg-brand/5 sm:min-h-[132px] sm:p-2",
                    !inMonth && "bg-stone-50/70 text-stone-400",
                    isSelected && "bg-brand/10 ring-1 ring-inset ring-brand/30"
                  )}
                  onClick={() => setSelectedDay(dayISO)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedDay(dayISO);
                  }}
                  data-testid={`event-day-${dayISO}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium",
                        isToday && "bg-brand text-white"
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] leading-none text-stone-500 sm:text-[11px]">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 sm:hidden">
                    {dayEvents.slice(0, 4).map((event) => {
                      const category = categoryFor(event.category);
                      const Icon = category.Icon;
                      const color = event.color || category.color;
                      return (
                        <button
                          key={event.id}
                          type="button"
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-xl border shadow-sm transition hover:scale-105 active:scale-95",
                            !event.active && "opacity-50"
                          )}
                          style={{
                            borderColor: hexToRgba(color, 0.45),
                            backgroundColor: hexToRgba(color, 0.13),
                            color,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDay(dayISO);
                            setEditing(formFromEvent(event));
                          }}
                          aria-label={`${category.label}: ${event.title}`}
                          title={`${category.label}: ${event.title}`}
                        >
                          <Icon size={18} strokeWidth={2.35} />
                        </button>
                      );
                    })}
                    {dayEvents.length > 4 && (
                      <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-xl border border-stone-200 bg-white px-1 text-xs font-semibold text-stone-500 shadow-sm">
                        +{dayEvents.length - 4}
                      </span>
                    )}
                  </div>
                  <div className="hidden space-y-1 sm:block">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={cn(
                          "w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-left text-xs shadow-sm hover:border-brand/40",
                          !event.active && "opacity-50"
                        )}
                        style={{ borderLeftWidth: 4, borderLeftColor: event.color }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDay(dayISO);
                          setEditing(formFromEvent(event));
                        }}
                        title={event.title}
                      >
                        <div className="truncate font-medium text-stone-800">{event.title}</div>
                        <div className="truncate text-[11px] text-stone-500">{eventTimeLabel(event)}</div>
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[11px] text-stone-400">+{dayEvents.length - 3} ещё</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Выбранный день</div>
                <div className="text-xl font-semibold mt-0.5">
                  {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                    weekday: "long",
                  })}
                </div>
              </div>
              <button className="btn-ghost text-sm" onClick={() => setEditing(emptyForm(selectedDay))}>
                <Plus size={14} /> Добавить
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {isLoading ? (
                <div className="py-6 text-center text-sm text-stone-400">Загрузка…</div>
              ) : selectedEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-200 px-3 py-6 text-center text-sm text-stone-400">
                  На этот день мероприятий нет.
                </div>
              ) : (
                selectedEvents.map((event) => (
                  <EventRow key={event.id} event={event} onEdit={() => setEditing(formFromEvent(event))} />
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="font-semibold">Ближайшие мероприятия</div>
            <div className="mt-3 space-y-2">
              {upcomingEvents.length === 0 ? (
                <div className="text-sm text-stone-400">Пока ничего не запланировано.</div>
              ) : (
                upcomingEvents.map((event) => (
                  <EventRow key={event.id} event={event} compact onEdit={() => setEditing(formFromEvent(event))} />
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {editing && (
        <EventModal
          form={editing}
          setForm={setEditing}
          onClose={() => setEditing(null)}
          onSubmit={(form) => save.mutate(form)}
          onDelete={(id) => remove.mutate(id)}
          pending={save.isPending || remove.isPending}
          error={(save.error || remove.error) as Error | null}
        />
      )}
    </div>
  );
}

function EventRow({ event, onEdit, compact = false }: { event: ClubEvent; onEdit: () => void; compact?: boolean }) {
  const category = categoryFor(event.category);
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-left hover:border-brand/40 hover:bg-brand/5",
        !event.active && "opacity-55",
        compact && "py-2"
      )}
      onClick={onEdit}
      data-testid={`event-row-${event.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: event.color || category.color }} />
            <span className="truncate font-medium">{event.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1"><Clock size={12} />{eventTimeLabel(event)}</span>
            {event.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{event.location}</span>}
            {event.capacity != null && <span className="inline-flex items-center gap-1"><Users size={12} />{event.capacity}</span>}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
          {category.label}
        </span>
      </div>
    </button>
  );
}

function EventModal({
  form,
  setForm,
  onClose,
  onSubmit,
  onDelete,
  pending,
  error,
}: {
  form: EventForm;
  setForm: (next: EventForm | null) => void;
  onClose: () => void;
  onSubmit: (form: EventForm) => void;
  onDelete: (id: number) => void;
  pending: boolean;
  error: Error | null;
}) {
  const update = (patch: Partial<EventForm>) => setForm({ ...form, ...patch });

  return (
    <div className="modal-overlay bg-black/30 sm:items-start" onClick={onClose}>
      <form
        className="modal-panel max-w-3xl overflow-y-auto p-0 lg:max-h-[calc(100svh-2rem)]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        data-testid="event-edit-modal"
      >
        <div className="flex items-start justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={20} className="text-brand" />
            <div>
              <div className="text-lg font-semibold">
                {form.id ? "Правка мероприятия" : "Новое мероприятие"}
              </div>
              <div className="text-xs text-stone-500">
                Событие попадёт только в календарь мероприятий и не блокирует бронирования.
              </div>
            </div>
          </div>
          <button type="button" className="text-stone-400 hover:text-stone-700" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="label">Название *</label>
            <input
              className="input"
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              data-testid="event-title"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label">Категория</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => {
                  const category = categoryFor(e.target.value);
                  update({ category: category.code, color: category.color });
                }}
              >
                {CATEGORIES.map((category) => (
                  <option key={category.code} value={category.code}>{category.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Цвет</label>
              <input
                type="color"
                className="h-[42px] w-20 rounded-lg border border-stone-300 bg-white px-2"
                value={form.color}
                onChange={(e) => update({ color: e.target.value })}
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => update({ allDay: e.target.checked })}
            />
            Весь день
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Дата начала</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
            </div>
            <div>
              <label className="label">Время начала</label>
              <input
                className="input"
                type="time"
                value={form.startTime}
                disabled={form.allDay}
                onChange={(e) => update({ startTime: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Дата окончания</label>
              <input className="input" type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />
            </div>
            <div>
              <label className="label">Время окончания</label>
              <input
                className="input"
                type="time"
                value={form.endTime}
                disabled={form.allDay}
                onChange={(e) => update({ endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <label className="label">Место</label>
              <input
                className="input"
                maxLength={160}
                value={form.location}
                onChange={(e) => update({ location: e.target.value })}
                placeholder="например, клубный дом"
              />
            </div>
            <div>
              <label className="label">Участников</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.capacity}
                onChange={(e) => update({ capacity: e.target.value })}
                placeholder="без лимита"
              />
            </div>
          </div>

          <div>
            <label className="label">Описание</label>
            <textarea
              className="input min-h-28"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => update({ active: e.target.checked })}
            />
            Показывать в календаре
          </label>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {form.id && (
              <button
                type="button"
                className="btn-ghost text-red-600 hover:bg-red-50"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Удалить мероприятие «${form.title}»?`)) onDelete(form.id!);
                }}
              >
                <Trash2 size={15} /> Удалить
              </button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {form.id ? <Pencil size={15} /> : <Save size={15} />}
              {pending ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
