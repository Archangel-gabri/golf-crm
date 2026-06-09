import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Edit2, CheckCircle2, UserX, Clock, Trash2, AlertCircle, Crown } from "lucide-react";
import { api, type Booking } from "@/lib/api";
import { formatRub, formatTime, cn } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

type Props = {
  booking: Booking;
  onClose: () => void;
  onEdit: () => void;
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function addMinutesTo(isoEnd: string, min: number): string {
  const d = new Date(isoEnd);
  d.setMinutes(d.getMinutes() + min);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function currentEnd(b: Booking): string {
  const d = new Date(b.ends_at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  confirmed: "Подтверждена",
  checked_in: "Заехал",
  completed: "Завершена",
  cancelled: "Отменена",
  no_show: "Не пришёл",
};

export default function BookingActionPanel({ booking: b, onClose, onEdit }: Props) {
  const qc = useQueryClient();
  const { isInstructor, canDeleteBookings } = usePerms();

  // Load customer memberships to check if "apply membership" is available
  const { data: customerMemberships } = useQuery({
    queryKey: ["customer-memberships", b.customer_id],
    queryFn: () => b.customer_id ? api.customerMemberships(b.customer_id) : Promise.resolve([]),
    enabled: !!b.customer_id && !!b.instructor_id,
  });
  const bookingDay = b.starts_at.slice(0, 10);
  const hasActiveMembershipForTraining = (customerMemberships || []).some(
    (m) => m.active && m.plan_covers_training && m.starts_on <= bookingDay && m.ends_on >= bookingDay
      && (m.plan_max_trainings === 0 || m.trainings_used < m.plan_max_trainings)
  );
  const [showExtend, setShowExtend] = useState(false);
  const [extendTo, setExtendTo] = useState(() => addMinutesTo(b.ends_at, 30));
  const [extendError, setExtendError] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bookings-day"] });
    qc.invalidateQueries({ queryKey: ["bookings-all"] });
    qc.invalidateQueries({ queryKey: ["cal-events"] });
    qc.invalidateQueries({ queryKey: ["dash-bookings"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const transition = useMutation({
    mutationFn: (to: string) => api.transition(b.id, to),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const del = useMutation({
    mutationFn: () => api.deleteBooking(b.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const extend = useMutation({
    mutationFn: (minutes: number) => api.extendBooking(b.id, minutes),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e: any) => setExtendError(e.message || "Ошибка"),
  });

  const applyMembership = useMutation({
    mutationFn: () => api.applyMembership(b.id),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["customer-memberships", b.customer_id] });
      onClose();
    },
  });

  const endDate = new Date(b.ends_at);
  function handleExtend() {
    const [h, m] = extendTo.split(":").map(Number);
    const target = new Date(b.ends_at);
    target.setHours(h, m, 0, 0);
    const minutes = Math.round((target.getTime() - endDate.getTime()) / 60000);
    if (minutes <= 0) { setExtendError("Новое время должно быть позже текущего окончания"); return; }
    if (minutes > 240) { setExtendError("Максимум 240 минут"); return; }
    setExtendError("");
    extend.mutate(minutes);
  }

  const isClosed = b.status === "completed" || b.status === "cancelled";
  const canConfirm = !isClosed && b.status !== "confirmed" && b.status !== "checked_in";
  const canCheckIn = !isClosed && b.status === "confirmed";
  const canNoShow = !isClosed && (b.status === "confirmed" || b.status === "checked_in");
  const canExtend = !isClosed;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-sm p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-stone-200 bg-stone-50">
          <div>
            <div className="font-semibold text-stone-900">{b.customer_name || "—"}</div>
            <div className="text-xs text-stone-500 mt-0.5">
              {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
              {b.resource_name && <span> · {b.resource_name}</span>}
            </div>
            {b.instructor_name && (
              <div className="text-xs text-stone-500">Тренер: {b.instructor_name}</div>
            )}
            <div className="text-xs text-stone-500 mt-1">
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-[11px] font-medium",
                b.status === "confirmed" && "bg-emerald-100 text-emerald-700",
                b.status === "checked_in" && "bg-blue-100 text-blue-700",
                b.status === "completed" && "bg-stone-200 text-stone-600",
                b.status === "cancelled" && "bg-red-100 text-red-600",
                b.status === "no_show" && "bg-amber-100 text-amber-700",
                b.status === "draft" && "bg-stone-100 text-stone-500",
              )}>
                {STATUS_LABELS[b.status] ?? b.status}
              </span>
              <span className="ml-2 font-semibold text-brand">{formatRub(b.total_kopecks)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Extend panel */}
        {showExtend && (
          <div className="p-4 border-b border-stone-100 bg-amber-50">
            <div className="text-sm font-medium text-stone-700 mb-2">
              Продлить до (сейчас до {currentEnd(b)})
            </div>
            <input
              type="time"
              className="input text-sm mb-2"
              value={extendTo}
              onChange={(e) => setExtendTo(e.target.value)}
            />
            <div className="flex gap-1 mb-2">
              {[15, 30, 45, 60, 90].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="text-xs px-2 py-1 rounded border border-stone-300 bg-white hover:border-brand hover:text-brand"
                  onClick={() => setExtendTo(addMinutesTo(b.ends_at, m))}
                >
                  +{m}
                </button>
              ))}
            </div>
            {extendError && (
              <div className="text-xs text-red-600 flex items-center gap-1 mb-2">
                <AlertCircle size={12} /> {extendError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost flex-1 text-sm py-1.5"
                onClick={() => { setShowExtend(false); setExtendError(""); }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary flex-1 text-sm py-1.5"
                disabled={extend.isPending}
                onClick={handleExtend}
              >
                {extend.isPending ? "…" : "Продлить"}
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="divide-y divide-stone-100">
          <ActionBtn icon={<Edit2 size={16} />} label="Изменить параметры" onClick={() => { onClose(); onEdit(); }} />
          {canConfirm && (
            <ActionBtn
              icon={<CheckCircle2 size={16} className="text-emerald-600" />}
              label="Подтвердить"
              onClick={() => transition.mutate("confirmed")}
              loading={transition.isPending}
            />
          )}
          {canCheckIn && (
            <ActionBtn
              icon={<CheckCircle2 size={16} className="text-blue-600" />}
              label="Отметить заехал"
              onClick={() => transition.mutate("checked_in")}
              loading={transition.isPending}
            />
          )}
          {canNoShow && (
            <ActionBtn
              icon={<UserX size={16} className="text-amber-600" />}
              label="Не пришёл(а)"
              onClick={() => transition.mutate("no_show")}
              loading={transition.isPending}
            />
          )}
          {canExtend && !showExtend && (
            <ActionBtn
              icon={<Clock size={16} className="text-brand" />}
              label="Продлить"
              onClick={() => setShowExtend(true)}
            />
          )}
          {!isClosed && !isInstructor && b.instructor_id && hasActiveMembershipForTraining && b.total_kopecks > 0 && (
            <ActionBtn
              icon={<Crown size={16} className="text-emerald-600" />}
              label="Покрыть тренировку абонементом"
              labelClass="text-emerald-700"
              onClick={() => {
                if (confirm(`Списать тренировку с абонемента для ${b.customer_name || "клиента"}? Стоимость брони уменьшится.`)) {
                  applyMembership.mutate();
                }
              }}
              loading={applyMembership.isPending}
            />
          )}
          {(!isClosed || canDeleteBookings) && (
            <ActionBtn
              icon={<Trash2 size={16} className="text-red-500" />}
              label="Удалить"
              labelClass="text-red-600"
              onClick={() => {
                if (confirm(`Удалить бронь ${b.customer_name || "#" + b.id}?`)) del.mutate();
              }}
              loading={del.isPending}
            />
          )}
        </div>

        {transition.error && (
          <div className="px-4 pb-3 text-xs text-red-600">
            {(transition.error as any).message}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon, label, labelClass, onClick, loading,
}: {
  icon: React.ReactNode;
  label: string;
  labelClass?: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50 transition text-left"
      onClick={onClick}
      disabled={loading}
    >
      <span className="shrink-0 text-stone-400">{icon}</span>
      <span className={cn("font-medium text-stone-700", labelClass)}>
        {loading ? "…" : label}
      </span>
    </button>
  );
}
