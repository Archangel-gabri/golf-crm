import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Edit2, X, Plus, Trash2, Infinity as InfinityIcon, UserPlus, Search } from "lucide-react";
import { api, type MembershipPlan, type ActiveMembership } from "@/lib/api";
import { formatRub, cn } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

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

function daysLeft(endsOn: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endsOn);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
}

export default function Memberships() {
  const qc = useQueryClient();
  const { canEditCatalog } = usePerms();
  const { data } = useQuery({ queryKey: ["memberships"], queryFn: api.memberships });
  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ["memberships-active"],
    queryFn: api.activeMemberships,
  });
  const [editing, setEditing] = useState<Partial<MembershipPlan> | null>(null);
  const [unlimitedTrainings, setUnlimitedTrainings] = useState(true);
  const [showIssue, setShowIssue] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setUnlimitedTrainings(!editing.max_trainings);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (p: Partial<MembershipPlan>) => {
      const body: Partial<MembershipPlan> = {
        ...p,
        max_trainings: unlimitedTrainings ? 0 : Number(p.max_trainings ?? 0),
      };
      return p.id ? api.updateMembership(p.id, body) : api.createMembership(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memberships"] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteMembershipPlan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memberships"] }),
  });

  const revoke = useMutation({
    mutationFn: (mid: number) => api.revokeMembership(mid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memberships-active"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  return (
    <div className="page max-w-7xl" data-testid="memberships-page">
      <div className="page-head mb-5 sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold">Абонементы</h1>
          <p className="text-sm text-stone-500 mt-1 max-w-3xl">
            Абонемент — пакет, который клуб продаёт гостю на фиксированный срок.
            Может покрывать тренировки (гость не платит за тренера) и/или давать скидку
            на услуги. Привязка к клиенту — в карточке клиента или при создании брони.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn-ghost border border-stone-300"
            onClick={() => setShowIssue(true)}
            data-testid="issue-membership-btn"
          >
            <UserPlus size={16} /> Выдать клиенту
          </button>
          {canEditCatalog && (
            <button
              className="btn-primary"
              onClick={() => setEditing({
                name: "", tier: 1, price_kopecks: 0, duration_days: 90,
                discount_percent: 0, priority_booking_days: 0,
                covers_training: true, max_trainings: 0, active: true,
              })}
              data-testid="new-membership-btn"
            >
              <Plus size={16} /> Новый абонемент
            </button>
          )}
        </div>
      </div>

      {data?.length === 0 && (
        <div className="card py-16 text-center text-stone-500">
          Пока нет абонементов. Нажмите «Новый абонемент», чтобы создать первый.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {data?.map((p) => (
          <div key={p.id} className="card relative" data-testid={`plan-${p.id}`}>
            {canEditCatalog && (
              <div className="absolute top-3 right-3 flex gap-1">
                <button
                  className="w-8 h-8 rounded-lg text-stone-400 hover:text-brand hover:bg-brand/5 flex items-center justify-center"
                  onClick={() => setEditing(p)}
                  title="Редактировать"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  className="w-8 h-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                  onClick={() => {
                    if (confirm(`Удалить абонемент «${p.name}»? Если он привязан к клиентам, он будет архивирован.`)) {
                      del.mutate(p.id);
                    }
                  }}
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold mb-3 bg-brand/10 text-brand">
              <Crown size={12} /> Абонемент
            </div>
            <h3 className="text-xl font-bold">{p.name}</h3>
            <div className="text-3xl font-semibold text-brand mt-2">
              {p.price_kopecks ? formatRub(p.price_kopecks) : "Бесплатно"}
            </div>
            <div className="text-sm text-stone-500 mb-3">на {p.duration_days} дней</div>
            <ul className="text-sm space-y-1.5 text-stone-700">
              {p.covers_all_services && (
                <li className="text-emerald-700 font-semibold">
                  ✓ Все услуги без доплаты
                  {p.max_trainings > 0 && <span className="text-stone-500 font-normal"> · до {p.max_trainings} посещений</span>}
                </li>
              )}
              {!p.covers_all_services && p.covers_training && (
                <li className="text-emerald-700">
                  ✓ Тренировки без доплаты
                  {p.max_trainings > 0 && <span className="text-stone-500"> · до {p.max_trainings}</span>}
                </li>
              )}
              {p.discount_percent > 0 && (
                <li>Скидка на услуги: <b>{p.discount_percent}%</b></li>
              )}
              {p.priority_booking_days > 0 && (
                <li>Приоритет брони: <b>{p.priority_booking_days} дн.</b></li>
              )}
              {p.description && <li className="text-stone-500">{p.description}</li>}
              {!p.active && <li className="text-red-600">Неактивен (архив)</li>}
            </ul>
          </div>
        ))}
      </div>

      {/* ── Active customer memberships ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-800">
            Активные абонементы клиентов
            {!activeLoading && activeData && (
              <span className="ml-2 text-sm font-normal text-stone-500">({activeData.length})</span>
            )}
          </h2>
        </div>

        {activeLoading ? (
          <div className="card py-8 text-center text-stone-400 text-sm">Загрузка…</div>
        ) : !activeData?.length ? (
          <div className="card py-8 text-center text-stone-400 text-sm">
            Нет активных абонементов. Выдайте абонемент клиенту — кнопка «Выдать клиенту» выше.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <div className="table-shell">
              <table className="min-w-[700px] w-full text-sm">
                <thead className="text-left text-stone-500">
                  <tr>
                    <th className="pb-2 font-medium">Клиент</th>
                    <th className="pb-2 font-medium">Абонемент</th>
                    <th className="pb-2 font-medium">Куплен</th>
                    <th className="pb-2 font-medium">Действует до</th>
                    <th className="pb-2 font-medium">Тренировки</th>
                    <th className="pb-2 font-medium">Скидка</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((m) => {
                    const left = daysLeft(m.ends_on);
                    const urgent = left <= 7;
                    return (
                      <tr key={m.id} className="border-t border-stone-100">
                        <td className="py-2.5">
                          <div className="font-medium">{m.customer_name}</div>
                          {m.customer_phone && <div className="text-xs text-stone-400">{m.customer_phone}</div>}
                        </td>
                        <td className="font-medium text-brand">{m.plan_name}</td>
                        <td className="text-stone-500">{formatDate(m.purchased_at)}</td>
                        <td>
                          <span className={cn(urgent ? "text-amber-600 font-semibold" : "")}>
                            {formatDate(m.ends_on)}
                          </span>
                          <span className="ml-1 text-xs text-stone-400">({left} дн.)</span>
                        </td>
                        <td>
                          {m.plan_covers_training ? (
                            m.plan_max_trainings > 0 ? (
                              <span className="text-emerald-700">
                                {Math.max(0, m.plan_max_trainings - m.trainings_used)}/{m.plan_max_trainings}
                              </span>
                            ) : (
                              <span className="text-emerald-700">∞</span>
                            )
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td>
                          {m.plan_discount_percent > 0
                            ? <span>−{m.plan_discount_percent}%</span>
                            : <span className="text-stone-300">—</span>}
                        </td>
                        <td className="text-right">
                          <button
                            className="text-xs text-red-500 hover:text-red-700 font-medium"
                            onClick={() => {
                              if (confirm(`Отозвать абонемент «${m.plan_name}» у ${m.customer_name}?`)) {
                                revoke.mutate(m.id);
                              }
                            }}
                          >
                            Отозвать
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form
            className="modal-panel max-w-lg p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}
            data-testid="plan-edit-modal"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">
                {editing.id ? "Правка абонемента" : "Новый абонемент"}
              </h2>
              <button type="button" onClick={() => setEditing(null)}><X size={20} /></button>
            </div>

            <label className="label">Название *</label>
            <input
              className="input" required
              placeholder="например, «30 дней безлимитных тренировок»"
              value={editing.name || ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              data-testid="plan-name"
            />

            <div className="form-grid-2 mt-3">
              <div>
                <label className="label">Цена, ₽</label>
                <input
                  type="number" min={0} className="input"
                  placeholder="например, 15000"
                  value={editing.price_kopecks ? Math.round(editing.price_kopecks / 100) : ""}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditing({ ...editing, price_kopecks: v === "" ? 0 : Number(v) * 100 });
                  }}
                  data-testid="plan-price"
                />
              </div>
              <div>
                <label className="label">Срок, дней *</label>
                <input
                  type="number" min={1} required className="input"
                  value={editing.duration_days || ""}
                  placeholder="30"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-stone-200 p-3 bg-stone-50/50 space-y-3">
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={!!editing.covers_all_services}
                  onChange={(e) => setEditing({ ...editing, covers_all_services: e.target.checked })}
                />
                <span className="leading-snug">
                  Все услуги бесплатно <span className="text-stone-500 font-normal">(поле, доп. услуги, тренировка — всё покрыто)</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={!!editing.covers_training}
                  onChange={(e) => setEditing({ ...editing, covers_training: e.target.checked })}
                />
                <span className="leading-snug">Только тренировки (гость не платит за тренера)</span>
              </label>
              {editing.covers_training && (
                <div className="mt-3 space-y-3 pl-6 border-l-2 border-stone-200">
                  <label className="flex items-start gap-2.5 text-sm text-stone-700 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                      checked={unlimitedTrainings}
                      onChange={(e) => {
                        setUnlimitedTrainings(e.target.checked);
                        if (e.target.checked) setEditing({ ...editing, max_trainings: 0 });
                      }}
                    />
                    <span className="inline-flex items-center gap-1.5 leading-snug">
                      <InfinityIcon size={14} className="text-brand shrink-0" />
                      Без лимита тренировок на период
                    </span>
                  </label>
                  {!unlimitedTrainings && (
                    <div>
                      <label className="label">Максимум тренировок</label>
                      <input
                        type="number" min={1} className="input"
                        value={editing.max_trainings || ""}
                        placeholder="например, 8"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setEditing({ ...editing, max_trainings: Number(e.target.value) })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="form-grid-2 mt-3">
              <div>
                <label className="label">Скидка на услуги, %</label>
                <input
                  type="number" min={0} max={100} className="input"
                  value={editing.discount_percent || ""}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditing({ ...editing, discount_percent: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Приоритет брони, дн.</label>
                <input
                  type="number" min={0} className="input"
                  value={editing.priority_booking_days || ""}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditing({ ...editing, priority_booking_days: Number(e.target.value) })}
                />
              </div>
            </div>

            <label className="label mt-3">Описание (для карточки)</label>
            <textarea
              className="input" rows={2}
              placeholder="Пара слов о том, для кого этот абонемент."
              value={editing.description || ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />

            <label className="flex items-start gap-2.5 text-sm mt-4 select-none cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <span className="leading-snug">Активен (доступен для продажи)</span>
            </label>

            {save.isError && (
              <div className="bg-red-50 text-red-700 text-sm p-2 rounded mt-3">
                {(save.error as any)?.message || "Ошибка"}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn-primary flex-1" disabled={save.isPending} data-testid="plan-submit">
                {save.isPending ? "…" : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showIssue && (
        <IssueMembershipModal
          plans={(data || []).filter((p) => p.active)}
          onClose={() => setShowIssue(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["memberships-active"] });
            qc.invalidateQueries({ queryKey: ["customers"] });
            setShowIssue(false);
          }}
        />
      )}
    </div>
  );
}

export function IssueMembershipModal({
  plans,
  onClose,
  onSuccess,
}: {
  plans: MembershipPlan[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [planId, setPlanId] = useState<number>(plans[0]?.id ?? 0);
  const [startsOn, setStartsOn] = useState(todayISO());
  const [customDays, setCustomDays] = useState("");

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.customers(),
  });

  const filtered = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers?.slice(0, 40) ?? [];
    return (customers || []).filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [customers, customerQuery]);

  const selected = plans.find((p) => p.id === planId);
  const effectiveDays = customDays ? Number(customDays) : (selected?.duration_days ?? 0);

  const assign = useMutation({
    mutationFn: () => {
      if (!customerId || !planId) throw new Error("Выберите клиента и тариф");
      return api.assignMembership(customerId, {
        plan_id: planId,
        starts_on: startsOn,
        ...(customDays ? { duration_days_override: Number(customDays) } : {}),
      });
    },
    onSuccess,
  });

  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-lg p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Выдать абонемент клиенту</h2>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        <label className="label">Клиент</label>
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-2.5 text-stone-400" />
          <input
            className={cn("input pl-9", customerId && "border-brand")}
            placeholder="Поиск по имени или телефону"
            value={customerQuery}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            onChange={(e) => {
              setCustomerQuery(e.target.value);
              setCustomerId(null);
              setCustomerName("");
            }}
          />
          {customerId && (
            <span className="absolute right-3 top-2.5 text-xs text-brand font-medium">✓ {customerName}</span>
          )}
          {showDropdown && !customerId && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-3 text-sm text-stone-400 text-center">Нет клиентов</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-brand/5 transition"
                    onMouseDown={() => {
                      setCustomerId(c.id);
                      setCustomerName(c.name);
                      setCustomerQuery(c.name);
                      setShowDropdown(false);
                    }}
                  >
                    <div className="font-medium">{c.name}</div>
                    {c.phone && <div className="text-xs text-stone-500">{c.phone}</div>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <label className="label">Тариф абонемента</label>
        <select
          className="input mb-3"
          value={planId}
          onChange={(e) => { setPlanId(Number(e.target.value)); setCustomDays(""); }}
          disabled={plans.length === 0}
        >
          {plans.length === 0 ? (
            <option value={0}>Нет активных тарифов</option>
          ) : (
            plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatRub(p.price_kopecks)} · {p.duration_days} дн.
                {p.covers_training ? " · тренировки покрыты" : ""}
                {p.discount_percent > 0 ? ` · −${p.discount_percent}%` : ""}
              </option>
            ))
          )}
        </select>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="label">Дата продажи / начало</label>
            <input
              type="date" className="input"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Срок{selected ? ` · по умолчанию ${selected.duration_days} дн.` : ""}
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

        {assign.isError && (
          <div className="bg-red-50 text-red-700 text-sm p-2 rounded mb-3">
            {(assign.error as any)?.message || "Ошибка"}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!customerId || !planId || effectiveDays <= 0 || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending
              ? "…"
              : customerId && planId && effectiveDays > 0
                ? `Выдать на ${effectiveDays} дн.`
                : "Выдать"}
          </button>
        </div>
      </div>
    </div>
  );
}
