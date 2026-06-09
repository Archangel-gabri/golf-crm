import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { formatRub, formatTime, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01T00:00:00`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00`;
  return { from, to };
}

const STATUS_FILTERS = [
  { v: "all", l: "Все" },
  { v: "draft", l: "Черновик" },
  { v: "confirmed", l: "Подтверждены" },
  { v: "checked_in", l: "Заехали" },
  { v: "completed", l: "Завершены" },
  { v: "no_show", l: "Не пришли" },
  { v: "cancelled", l: "Отменены" },
];

export default function Trainings() {
  const [ym, setYm] = useState(currentYM);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterInstructor, setFilterInstructor] = useState(0);
  const { isInstructor } = usePerms();
  const qc = useQueryClient();

  const { from, to } = monthBounds(ym);

  const { data, isLoading } = useQuery({
    queryKey: ["trainings", ym],
    queryFn: () => api.bookings({ from, to }),
  });

  const { data: instructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: api.instructors,
    enabled: !isInstructor,
  });

  const trainings = useMemo(() => {
    let list = (data || []).filter((b) => b.instructor_id != null);
    if (filterStatus !== "all") list = list.filter((b) => b.status === filterStatus);
    if (filterInstructor > 0) list = list.filter((b) => b.instructor_id === filterInstructor);
    return [...list].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  }, [data, filterStatus, filterInstructor]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["trainings", ym] });
    qc.invalidateQueries({ queryKey: ["bookings-all"] });
  };

  const transition = useMutation({
    mutationFn: ({ id, to }: { id: number; to: string }) => api.transition(id, to),
    onSuccess: invalidate,
  });

  const colSpan = isInstructor ? 6 : 7;

  return (
    <div className="page max-w-7xl" data-testid="trainings-page">
      <div className="page-head mb-5">
        <h1 className="text-2xl font-semibold">
          {isInstructor ? "Мои тренировки" : "Тренировки за месяц"}
        </h1>
        <div className="text-sm text-stone-500 mt-1">{trainings.length} записей</div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="month"
          className="input max-w-[160px]"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
        />
        {!isInstructor && instructors && instructors.length > 0 && (
          <select
            className="input max-w-[200px]"
            value={filterInstructor}
            onChange={(e) => setFilterInstructor(Number(e.target.value))}
          >
            <option value={0}>Все тренеры</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setFilterStatus(v)}
              className={
                "px-2.5 py-1 rounded-full text-xs border " +
                (filterStatus === v
                  ? "bg-brand text-white border-brand"
                  : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50")
              }
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0 table-shell">
        <table className="min-w-[700px] w-full text-sm">
          <thead className="text-left text-stone-500 bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Время</th>
              <th className="px-3 py-2 font-medium">Клиент</th>
              {!isInstructor && <th className="px-3 py-2 font-medium">Тренер</th>}
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium text-right">Сумма</th>
              <th className="px-3 py-2 font-medium text-center">Действия</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colSpan} className="py-10 text-center text-stone-400">Загрузка…</td>
              </tr>
            ) : trainings.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-10 text-center text-stone-400">Тренировок не найдено</td>
              </tr>
            ) : (
              trainings.map((b) => {
                const isClosed = b.status === "completed" || b.status === "cancelled" || b.status === "no_show";
                const canConfirm = !isClosed && b.status === "draft";
                const canNoShow = !isClosed && (b.status === "confirmed" || b.status === "checked_in");
                return (
                  <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(b.starts_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                    </td>
                    <td className="px-3 py-2">{b.customer_name || "—"}</td>
                    {!isInstructor && (
                      <td className="px-3 py-2 text-stone-600">{b.instructor_name || "—"}</td>
                    )}
                    <td className="px-3 py-2">
                      <span className={"text-xs px-2 py-0.5 rounded-full border " + statusColor(b.status)}>
                        {statusLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatRub(b.total_kopecks)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-center">
                        {canConfirm && (
                          <button
                            type="button"
                            title="Подтвердить"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: b.id, to: "confirmed" })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <CheckCircle2 size={12} /> Подтвердить
                          </button>
                        )}
                        {canNoShow && (
                          <button
                            type="button"
                            title="Не пришёл(а)"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: b.id, to: "no_show" })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50"
                          >
                            <UserX size={12} /> Не пришёл
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
