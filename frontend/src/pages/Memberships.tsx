import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Edit2, X, Plus, Trash2, Infinity as InfinityIcon } from "lucide-react";
import { api, type MembershipPlan } from "@/lib/api";
import { formatRub } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

export default function Memberships() {
  const qc = useQueryClient();
  const { canEditCatalog } = usePerms();
  const { data } = useQuery({ queryKey: ["memberships"], queryFn: api.memberships });
  const [editing, setEditing] = useState<Partial<MembershipPlan> | null>(null);
  const [unlimitedTrainings, setUnlimitedTrainings] = useState(true);

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
        {canEditCatalog && (
          <button
            className="btn-primary"
            onClick={() => setEditing({
              name: "", tier: 1, price_kopecks: 0, duration_days: 30,
              discount_percent: 0, priority_booking_days: 0,
              covers_training: true, max_trainings: 0, active: true,
            })}
            data-testid="new-membership-btn"
          >
            <Plus size={16} /> Новый абонемент
          </button>
        )}
      </div>

      {data?.length === 0 && (
        <div className="card py-16 text-center text-stone-500">
          Пока нет абонементов. Нажмите «Новый абонемент», чтобы создать первый.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              {p.covers_training && (
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

            <div className="mt-4 rounded-lg border border-stone-200 p-3 bg-stone-50/50">
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={!!editing.covers_training}
                  onChange={(e) => setEditing({ ...editing, covers_training: e.target.checked })}
                />
                <span className="leading-snug">Покрывает тренировки (гость не платит за тренера)</span>
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
    </div>
  );
}
