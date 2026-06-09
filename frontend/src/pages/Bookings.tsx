import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatRub, formatTime, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

const STATUS_FILTERS = [
  { v: "all", l: "Все" },
  { v: "confirmed", l: "Подтверждены" },
  { v: "checked_in", l: "Зарегистр." },
  { v: "completed", l: "Завершены" },
  { v: "cancelled", l: "Отменены" },
  { v: "no_show", l: "Неявки" },
];

export default function Bookings() {
  const [filter, setFilter] = useState<string>("all");
  const perms = usePerms();

  const { data } = useQuery({ queryKey: ["bookings-all"], queryFn: () => api.bookings() });
  const bookings = data || [];
  const counts = bookings.reduce<Record<string, number>>(
    (acc, b) => {
      acc.all += 1;
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    },
    { all: 0 },
  );
  const filtered = bookings.filter((b) => filter === "all" || b.status === filter);

  return (
    <div className="page max-w-7xl" data-testid="bookings-page">
      <div className="page-head mb-5">
        <div>
          <h1 className="text-2xl font-semibold">
            {perms.isInstructor ? "Мои брони" : "Все брони"}
          </h1>
          <div className="text-sm text-stone-500 mt-1">{counts.all} записей</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={
              "px-3 py-1 rounded-full text-sm border " +
              (filter === v ? "bg-brand text-white border-brand" : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50")
            }
            data-testid={`filter-${v}`}
          >
            {l} <span className="font-semibold tabular-nums">{counts[v] || 0}</span>
          </button>
        ))}
      </div>

      <div className="card p-0 table-shell">
        <table className="min-w-[820px] w-full text-sm">
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
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-stone-400">Броней не найдено</td>
              </tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50" data-testid={`row-booking-${b.id}`}>
                  <td className="px-3 py-2 font-mono text-xs text-stone-500">#{b.id}</td>
                  <td className="px-3 py-2">{formatDate(b.starts_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {formatTime(b.starts_at)}-{formatTime(b.ends_at)}
                  </td>
                  <td className="px-3 py-2">{b.customer_name || "-"}</td>
                  <td className="px-3 py-2 text-stone-600">{b.instructor_name || "-"}</td>
                  <td className="px-3 py-2">
                    <div>{b.service_name || "-"}</div>
                    <div className="text-xs text-stone-500">{b.resource_name || ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"text-xs px-2 py-0.5 rounded-full border " + statusColor(b.status)}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{formatRub(b.total_kopecks)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
