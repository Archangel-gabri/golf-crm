import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Customer, type CustomerVisit } from "@/lib/api";
import { Plus, Search, X, Edit2, Trash2 } from "lucide-react";
import { formatRub, cn } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

export default function Customers() {
  const qc = useQueryClient();
  const { canEditCustomers, canSeeCreatedBy } = usePerms();
  const [q, setQ] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [visitsCustomer, setVisitsCustomer] = useState<Customer | null>(null);

  const { data } = useQuery({
    queryKey: ["customers", q, createdFrom, createdTo],
    queryFn: () => api.customers(q || undefined, {
      created_from: createdFrom || undefined,
      created_to: createdTo || undefined,
    }),
  });

  const save = useMutation({
    mutationFn: (c: Partial<Customer>) =>
      c.id ? api.updateCustomer(c.id, c) : api.createCustomer(c),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });

  return (
    <div className="page max-w-7xl" data-testid="customers-page">
      <div className="page-head mb-5">
        <h1 className="text-2xl font-semibold">Клиенты</h1>
        {canEditCustomers && (
          <button
            className="btn-primary"
            onClick={() => setEditing({ name: "", phone: "", email: "", notes: "" })}
            data-testid="new-customer-btn"
          >
            <Plus size={16} /> Новый клиент
          </button>
        )}
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-2.5 text-stone-400" />
            <input
              className="input pl-9"
              placeholder="Поиск по имени, телефону, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="customer-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="w-full text-xs text-stone-500 sm:w-auto whitespace-nowrap">Добавлены:</span>
            <input
              type="date"
              className="input py-2 text-sm w-[140px]"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              placeholder="с"
              title="Клиенты, добавленные не раньше этой даты"
            />
            <span className="text-stone-400">—</span>
            <input
              type="date"
              className="input py-2 text-sm w-[140px]"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              placeholder="по"
              title="Клиенты, добавленные не позже этой даты"
            />
            {(createdFrom || createdTo) && (
              <button
                type="button"
                className="text-xs text-stone-500 hover:text-brand px-2"
                onClick={() => { setCreatedFrom(""); setCreatedTo(""); }}
                title="Сбросить фильтр по датам"
              >
                сбросить
              </button>
            )}
          </div>
        </div>

        <div className="table-shell">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="pb-2 font-medium">Имя</th>
              <th className="pb-2 font-medium">Телефон</th>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium text-right">Визитов</th>
              <th className="pb-2 font-medium text-right pr-6">Потратил</th>
              <th className="pb-2 font-medium pl-4">Абонементы</th>
              {canSeeCreatedBy && <th className="pb-2 font-medium">Кто завёл</th>}
              <th className="pb-2 font-medium">Машина</th>
              <th className="pb-2 font-medium">Заметки</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody data-testid="customer-list">
            {data?.length ? (
              data.map((c) => (
                <tr key={c.id} className="border-t border-stone-100" data-testid={`customer-${c.id}`}>
                  <td className="py-2.5 font-medium">{c.name}</td>
                  <td>{c.phone}</td>
                  <td className="text-stone-600">{c.email}</td>
                  <td className="text-right font-semibold whitespace-nowrap">
                    <button
                      className="hover:text-brand hover:underline cursor-pointer"
                      onClick={() => setVisitsCustomer(c as Customer)}
                      title="Посмотреть историю посещений"
                    >
                      {c.visits ?? 0}
                    </button>
                  </td>
                  <td className="text-right font-semibold text-brand whitespace-nowrap pr-6">
                    {formatRub(c.total_spent_kopecks ?? 0)}
                  </td>
                  <td className="pl-4 min-w-[260px]">
                    {c.active_memberships && c.active_memberships.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.active_memberships.map((label, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-medium whitespace-normal"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  {canSeeCreatedBy && (
                    <td className="text-stone-500 text-xs whitespace-nowrap">
                      {c.created_by_name || "—"}
                    </td>
                  )}
                  <td className="text-stone-600">
                    {c.car_brand} {c.car_number && <span className="font-mono text-xs">{c.car_number}</span>}
                  </td>
                  <td className="text-stone-500 truncate max-w-xs">{c.notes}</td>
                  <td className="text-right whitespace-nowrap">
                    {canEditCustomers ? (
                      <>
                        <button className="text-stone-500 hover:text-brand mr-2" onClick={() => setEditing(c)} title="Редактировать">
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="text-red-500 hover:text-red-700"
                          onClick={() => { if (confirm(`Удалить ${c.name}?`)) del.mutate(c.id); }}
                          data-testid={`delete-customer-${c.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={canSeeCreatedBy ? 10 : 9} className="py-10 text-center text-stone-400">
                  Клиентов не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {visitsCustomer && (
        <VisitsModal customer={visitsCustomer} onClose={() => setVisitsCustomer(null)} />
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form
            className="modal-panel max-w-md p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            data-testid="customer-edit-modal"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing.id ? "Правка клиента" : "Новый клиент"}</h2>
              <button type="button" onClick={() => setEditing(null)}><X size={20} /></button>
            </div>
            <label className="label">ФИО *</label>
            <input
              name="name" className="input" required data-testid="input-name"
              value={editing.name || ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <label className="label mt-3">Телефон</label>
            <input
              className="input" data-testid="input-phone"
              value={editing.phone || ""}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
            />
            <label className="label mt-3">Email</label>
            <input
              type="email" className="input" data-testid="input-email"
              value={editing.email || ""}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
            />
            <div className="form-grid-2 mt-3">
              <div>
                <label className="label">Марка машины</label>
                <input
                  className="input" value={editing.car_brand || ""}
                  onChange={(e) => setEditing({ ...editing, car_brand: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Номер</label>
                <input
                  className="input font-mono" value={editing.car_number || ""}
                  onChange={(e) => setEditing({ ...editing, car_number: e.target.value })}
                />
              </div>
            </div>
            <label className="label mt-3">Дата рождения</label>
            <input
              type="date" className="input" value={editing.birthdate || ""}
              onChange={(e) => setEditing({ ...editing, birthdate: e.target.value || null })}
            />
            <label className="label mt-3">Заметки</label>
            <textarea
              className="input" rows={2}
              value={editing.notes || ""}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm mt-3">
              <input type="checkbox" checked={editing.consent_marketing || false}
                     onChange={(e) => setEditing({ ...editing, consent_marketing: e.target.checked })} />
              Согласие на маркетинг
            </label>

            {editing.id && <CustomerMembershipSection customerId={editing.id} />}

            {save.isError && (
              <div className="bg-red-50 text-red-700 text-sm p-2 rounded mt-3">
                {(save.error as any)?.message || "Ошибка"}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn-primary flex-1" disabled={save.isPending} data-testid="submit-customer">
                {save.isPending ? "…" : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Подтверждена",
  completed: "Завершена",
  checked_in: "На месте",
  cancelled: "Отменена",
  no_show: "Не пришёл",
  draft: "Черновик",
  held: "Удержана",
};

function VisitsModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { data: visits, isLoading } = useQuery({
    queryKey: ["customer-visits", customer.id],
    queryFn: () => api.customerVisits(customer.id),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-2xl w-full p-4 sm:p-6 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">История посещений</h2>
            <div className="text-sm text-stone-500">{customer.name}</div>
          </div>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-stone-400">Загрузка...</div>
        ) : !visits?.length ? (
          <div className="py-10 text-center text-stone-400">Посещений пока нет</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500 border-b border-stone-200">
              <tr>
                <th className="pb-2 font-medium">Дата</th>
                <th className="pb-2 font-medium">Услуга</th>
                <th className="pb-2 font-medium">Тренер</th>
                <th className="pb-2 font-medium">Зона</th>
                <th className="pb-2 font-medium text-right">Гостей</th>
                <th className="pb-2 font-medium text-right">Сумма</th>
                <th className="pb-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.booking_id} className="border-t border-stone-100">
                  <td className="py-2 whitespace-nowrap font-mono text-xs">
                    {new Date(v.date).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="py-2">{v.service_name || "—"}</td>
                  <td className="py-2">{v.instructor_name || "—"}</td>
                  <td className="py-2">{v.resource_name || "—"}</td>
                  <td className="py-2 text-right">{v.guests}</td>
                  <td className="py-2 text-right font-semibold text-brand whitespace-nowrap">
                    {formatRub(v.total_kopecks)}
                  </td>
                  <td className="py-2">
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded",
                      v.status === "completed" ? "bg-emerald-50 text-emerald-700" :
                      v.status === "cancelled" ? "bg-red-50 text-red-600" :
                      v.status === "no_show" ? "bg-amber-50 text-amber-700" :
                      "bg-stone-100 text-stone-600"
                    )}>
                      {STATUS_LABELS[v.status] || v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const [datePart] = value.split("T");
  const [y, m, d] = datePart.split("-");
  return y && m && d ? `${d}.${m}.${y}` : datePart;
}

function CustomerMembershipSection({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { data: memberships } = useQuery({
    queryKey: ["cust-memb", customerId],
    queryFn: () => api.customerMemberships(customerId),
  });
  const { data: plans } = useQuery({ queryKey: ["memberships"], queryFn: api.memberships });
  const [pickPlan, setPickPlan] = useState<number>(0);
  const [startsOn, setStartsOn] = useState<string>(todayISO());
  const [customDays, setCustomDays] = useState<string>("");

  const selected = plans?.find((p) => p.id === pickPlan);
  const effectiveDays = customDays ? Number(customDays) : (selected?.duration_days ?? 0);

  const assign = useMutation({
    mutationFn: (body: { plan_id: number; starts_on: string; duration_days_override?: number }) =>
      api.assignMembership(customerId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cust-memb", customerId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setPickPlan(0);
      setCustomDays("");
      setStartsOn(todayISO());
    },
  });
  const revoke = useMutation({
    mutationFn: (mid: number) => api.revokeMembership(mid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cust-memb", customerId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const today = todayISO();

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <div className="label">Абонементы клиента</div>
      {memberships?.length ? (
        <div className="space-y-2 mb-3">
          {memberships.map((m) => {
            const expired = m.ends_on < today;
            const parts: string[] = [];
            if (m.plan_covers_training) {
              if (m.plan_max_trainings > 0) {
                const left = Math.max(0, m.plan_max_trainings - m.trainings_used);
                parts.push(`тренировок ${left}/${m.plan_max_trainings}`);
              } else {
                parts.push("тренировки ∞");
              }
            }
            if (m.plan_discount_percent > 0) parts.push(`−${m.plan_discount_percent}%`);
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded text-sm",
                  expired ? "bg-stone-100 text-stone-500" : "bg-emerald-50 border border-emerald-100"
                )}
              >
                <div>
                  <div className="font-semibold">{m.plan_name}</div>
                  <div className="text-xs mt-0.5">
                    куплен {formatDate(m.purchased_at)} · действует {formatDate(m.starts_on)} → {formatDate(m.ends_on)}
                    {parts.length > 0 && ` · ${parts.join(" · ")}`}
                    {expired && " · истёк"}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                  onClick={() => { if (confirm(`Отозвать абонемент «${m.plan_name}»?`)) revoke.mutate(m.id); }}
                >
                  Отозвать
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-stone-500 mb-2">Активных абонементов нет.</div>
      )}

      <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
        <div className="text-sm font-medium text-stone-700 mb-2">Выдать абонемент</div>
        <div className="grid grid-cols-1 gap-2">
          <select
            className="input"
            value={pickPlan}
            onChange={(e) => {
              setPickPlan(Number(e.target.value));
              setCustomDays("");
            }}
          >
            <option value={0}>— выбрать абонемент —</option>
            {plans?.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.duration_days} дн.
                {p.covers_training ? " · тренировки покрыты" : ""}
                {p.discount_percent > 0 ? ` · −${p.discount_percent}%` : ""}
              </option>
            ))}
          </select>
          {pickPlan > 0 && (
            <div className="form-grid-2 gap-2">
              <div>
                <label className="label text-xs">Дата продажи / начало</label>
                <input
                  type="date" className="input"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div>
                <label className="label text-xs">
                  Срок (дней){selected ? ` · по умолчанию ${selected.duration_days}` : ""}
                </label>
                <input
                  type="number" min={1} className="input"
                  placeholder={selected ? String(selected.duration_days) : "30"}
                  value={customDays}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!pickPlan || assign.isPending || effectiveDays <= 0}
            onClick={() => {
              if (!pickPlan) return;
              assign.mutate({
                plan_id: pickPlan,
                starts_on: startsOn,
                ...(customDays ? { duration_days_override: Number(customDays) } : {}),
              });
            }}
          >
            {assign.isPending
              ? "…"
              : pickPlan && effectiveDays > 0
                ? `Выдать на ${effectiveDays} дн.`
                : "Выдать"}
          </button>
          {assign.isError && (
            <div className="text-xs text-red-600">
              {(assign.error as any)?.message || "Ошибка"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
