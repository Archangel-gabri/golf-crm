import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Booking } from "@/lib/api";
import { formatRub, formatTime, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { Edit2, Trash2, Clock, Plus } from "lucide-react";
import BookingDialog from "@/components/BookingDialog";
import { usePerms } from "@/hooks/useAuth";

function nowHHMM(): string {
  const d = new Date();
  // округляем до ближайших 5 минут
  const mins = Math.round(d.getMinutes() / 5) * 5;
  d.setMinutes(mins, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Bookings() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const perms = usePerms();

  const { data } = useQuery({ queryKey: ["bookings-all"], queryFn: () => api.bookings() });
  const { data: resources } = useQuery({
    queryKey: ["visible-resources"],
    queryFn: api.visibleResources,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bookings-all"] });
    qc.invalidateQueries({ queryKey: ["bookings-day"] });
    qc.invalidateQueries({ queryKey: ["cal-events"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const transition = useMutation({
    mutationFn: ({ id, to, reason }: { id: number; to: string; reason?: string }) =>
      api.transition(id, to, reason),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteBooking(id),
    onSuccess: invalidate,
  });

  const extend = useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) =>
      api.extendBooking(id, minutes),
    onSuccess: invalidate,
    onError: (e: any) => alert(e.message || "Не удалось продлить"),
  });

  const filtered = (data || []).filter((b) => filter === "all" || b.status === filter);

  return (
    <div className="page max-w-7xl" data-testid="bookings-page">
      <div className="page-head mb-5">
        <h1 className="text-2xl font-semibold">
          {perms.isInstructor ? "Мои брони" : "Все брони"}
        </h1>
        {perms.canCreateBookings && resources && resources.length > 0 && (
          <button
            className="btn-primary"
            onClick={() => setCreating(true)}
            data-testid="new-booking-btn"
          >
            <Plus size={16} /> Новая бронь
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { v: "all", l: "Все" },
          { v: "confirmed", l: "Подтверждены" },
          { v: "checked_in", l: "Зарегистр." },
          { v: "completed", l: "Завершены" },
          { v: "cancelled", l: "Отменены" },
          { v: "no_show", l: "Неявки" },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={
              "px-3 py-1 rounded-full text-sm border " +
              (filter === v ? "bg-brand text-white border-brand" : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50")
            }
            data-testid={`filter-${v}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="card p-0 table-shell">
        <table className="min-w-[920px] w-full text-sm">
          <thead className="text-left text-stone-500 bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Время</th>
              <th className="px-3 py-2 font-medium">Клиент</th>
              <th className="px-3 py-2 font-medium">Тренер</th>
              <th className="px-3 py-2 font-medium">Услуга / Ресурс</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium text-right">Сумма</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-stone-400">Броней не найдено</td>
              </tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50" data-testid={`row-booking-${b.id}`}>
                  <td className="px-3 py-2 font-mono text-xs text-stone-500">#{b.id}</td>
                  <td className="px-3 py-2">{formatDate(b.starts_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                  </td>
                  <td className="px-3 py-2">{b.customer_name || "—"}</td>
                  <td className="px-3 py-2 text-stone-600">{b.instructor_name || "—"}</td>
                  <td className="px-3 py-2">
                    <div>{b.service_name || "—"}</div>
                    <div className="text-xs text-stone-500">{b.resource_name || ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"text-xs px-2 py-0.5 rounded-full border " + statusColor(b.status)}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{formatRub(b.total_kopecks)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {perms.canEditBookings && (
                      <button
                        className="text-stone-500 hover:text-brand mr-2"
                        onClick={() => setEditing(b)}
                        title="Редактировать"
                        data-testid={`edit-booking-${b.id}`}
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                    {perms.canExtendBookings && b.status !== "completed" && b.status !== "cancelled" && (
                      <ExtendMenu
                        id={b.id}
                        pending={extend.isPending}
                        onPick={(m) => extend.mutate({ id: b.id, minutes: m })}
                      />
                    )}
                    <TransitionActions booking={b} onAct={(to, reason) => transition.mutate({ id: b.id, to, reason })} />
                    {perms.canDeleteBookings && (
                      <button
                        className="text-red-500 hover:text-red-700 ml-2"
                        onClick={() => {
                          if (confirm(`Удалить бронь #${b.id}? Это безвозвратно. Чтобы отменить, используйте кнопку статуса.`)) {
                            del.mutate(b.id);
                          }
                        }}
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && <BookingDialog mode="edit" booking={editing} onClose={() => setEditing(null)} />}
      {creating && resources && resources.length > 0 && (
        <BookingDialog
          mode="create"
          resource={resources[0]}
          date={todayISO()}
          time={nowHHMM()}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function ExtendMenu({
  id,
  pending,
  onPick,
}: {
  id: number;
  pending: boolean;
  onPick: (minutes: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block mr-2">
      <button
        className="text-stone-500 hover:text-brand"
        title="Продлить"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        data-testid={`extend-booking-${id}`}
      >
        <Clock size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-20 p-1 flex gap-1 whitespace-nowrap">
            {[15, 30, 60].map((m) => (
              <button
                key={m}
                className="px-2 py-1 text-xs rounded hover:bg-brand hover:text-white border border-stone-200"
                onClick={() => {
                  setOpen(false);
                  onPick(m);
                }}
              >
                +{m}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function TransitionActions({
  booking,
  onAct,
}: {
  booking: Booking;
  onAct: (to: string, reason?: string) => void;
}) {
  const actions: Array<{ to: string; label: string; className?: string }> = [];
  if (booking.status === "confirmed") {
    actions.push({ to: "checked_in", label: "Check-in" });
    actions.push({ to: "no_show", label: "No-show", className: "text-orange-600" });
    actions.push({ to: "cancelled", label: "Отменить", className: "text-red-600" });
  } else if (booking.status === "checked_in") {
    actions.push({ to: "completed", label: "Завершить", className: "text-emerald-700" });
  } else if (booking.status === "no_show") {
    actions.push({ to: "completed", label: "Пробить", className: "text-emerald-700" });
  }
  return (
    <>
      {actions.map((a) => (
        <button
          key={a.to}
          onClick={() => onAct(a.to, a.to === "cancelled" ? prompt("Причина отмены:") || "" : "")}
          className={"text-xs px-2 py-0.5 rounded border border-stone-300 hover:bg-stone-100 mr-1 " + (a.className || "")}
          data-testid={`action-${booking.id}-${a.to}`}
        >
          {a.label}
        </button>
      ))}
    </>
  );
}
