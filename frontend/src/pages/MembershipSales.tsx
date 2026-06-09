import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Search } from "lucide-react";
import { api, type MembershipSale } from "@/lib/api";
import { formatRub } from "@/lib/utils";
import { IssueMembershipModal } from "@/pages/Memberships";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function thirtyDaysAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const [datePart] = value.split("T");
  const [y, m, d] = datePart.split("-");
  return y && m && d ? `${d}.${m}.${y}` : datePart;
}

export default function MembershipSales() {
  const qc = useQueryClient();
  const [fromDate, setFromDate] = useState(thirtyDaysAgoISO());
  const [toDate, setToDate] = useState(todayISO());
  const [customerSearch, setCustomerSearch] = useState("");
  const [showIssue, setShowIssue] = useState(false);

  const { data: plans } = useQuery({ queryKey: ["memberships"], queryFn: api.memberships });
  const activePlans = useMemo(() => (plans || []).filter((p) => p.active), [plans]);

  const { data: sales, isLoading } = useQuery({
    queryKey: ["membership-sales", fromDate, toDate],
    queryFn: () => api.membershipSales({ from_: fromDate, to_: toDate }),
  });

  const filtered = useMemo(() => {
    if (!sales) return [] as MembershipSale[];
    const q = customerSearch.trim().toLowerCase();
    let result = [...sales].sort(
      (a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime()
    );
    if (q) {
      result = result.filter(
        (s) =>
          s.customer_name.toLowerCase().includes(q) ||
          (s.customer_phone && s.customer_phone.includes(q))
      );
    }
    return result;
  }, [sales, customerSearch]);

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, s) => sum + s.plan_price_kopecks, 0),
    [filtered]
  );

  return (
    <div className="page max-w-7xl">
      <div className="page-head mb-5 sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold">Продажи абонементов</h1>
          <p className="text-sm text-stone-500 mt-1 max-w-2xl">
            История продаж абонементов клиентам клуба.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowIssue(true)}>
          <ShoppingBag size={16} /> Продать абонемент
        </button>
      </div>

      <div className="card mb-4 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">От</label>
          <input
            type="date"
            className="input"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">До</label>
          <input
            type="date"
            className="input"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className="min-w-[220px]">
          <label className="label">Клиент</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-stone-400" />
            <input
              className="input pl-9"
              placeholder="Поиск по имени или телефону"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-stone-500 mb-0.5">Итого за период</div>
          <div className="text-xl font-bold text-brand">{formatRub(totalRevenue)}</div>
          <div className="text-xs text-stone-500">{filtered.length} продаж</div>
        </div>
      </div>

      {isLoading ? (
        <div className="card py-8 text-center text-stone-400 text-sm">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="card py-12 text-center text-stone-400 text-sm">
          Нет продаж за выбранный период
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="table-shell">
            <table className="min-w-[800px] w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="pb-2 font-medium">Дата продажи</th>
                  <th className="pb-2 font-medium">Клиент</th>
                  <th className="pb-2 font-medium">Абонемент</th>
                  <th className="pb-2 font-medium">Стоимость</th>
                  <th className="pb-2 font-medium">Действует до</th>
                  <th className="pb-2 font-medium">Тренировок осталось</th>
                  <th className="pb-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const coversTr = s.plan_covers_training || s.plan_covers_all_services;
                  const trainingsLeft =
                    coversTr && s.plan_max_trainings > 0
                      ? Math.max(0, s.plan_max_trainings - s.trainings_used)
                      : null;
                  return (
                    <tr key={s.id} className="border-t border-stone-100">
                      <td className="py-2.5 text-stone-600">{formatDate(s.purchased_at)}</td>
                      <td className="py-2.5">
                        <div className="font-medium">{s.customer_name}</div>
                        {s.customer_phone && (
                          <div className="text-xs text-stone-400">{s.customer_phone}</div>
                        )}
                      </td>
                      <td className="py-2.5 font-medium text-brand">{s.plan_name}</td>
                      <td className="py-2.5 font-semibold">{formatRub(s.plan_price_kopecks)}</td>
                      <td className="py-2.5 text-stone-600">{formatDate(s.ends_on)}</td>
                      <td className="py-2.5">
                        {coversTr ? (
                          trainingsLeft !== null ? (
                            <span className="text-emerald-700">
                              {trainingsLeft}/{s.plan_max_trainings}
                            </span>
                          ) : (
                            <span className="text-emerald-700">∞</span>
                          )
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={
                            s.active
                              ? "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700"
                              : "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-stone-100 text-stone-500"
                          }
                        >
                          {s.active ? "Активен" : "Истёк"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showIssue && (
        <IssueMembershipModal
          plans={activePlans}
          onClose={() => setShowIssue(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["membership-sales"] });
            qc.invalidateQueries({ queryKey: ["memberships-active"] });
            qc.invalidateQueries({ queryKey: ["customers"] });
            setShowIssue(false);
          }}
        />
      )}
    </div>
  );
}
