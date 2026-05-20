import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Trash2, Edit2, Infinity as InfinityIcon } from "lucide-react";
import { api, type Coupon } from "@/lib/api";
import { usePerms } from "@/hooks/useAuth";

export default function Coupons() {
  const qc = useQueryClient();
  const { canEditCatalog } = usePerms();
  const { data } = useQuery({ queryKey: ["coupons"], queryFn: api.coupons });
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null);

  // Toggles control whether the corresponding fields are "∞" (forever / unlimited).
  // Derived from the coupon being edited so re-open preserves admin intent.
  const [foreverDates, setForeverDates] = useState(true);
  const [unlimitedUses, setUnlimitedUses] = useState(true);
  const [unlimitedPerUser, setUnlimitedPerUser] = useState(true);

  useEffect(() => {
    if (!editing) return;
    setForeverDates(!editing.valid_from && !editing.valid_to);
    setUnlimitedUses(!editing.max_uses);
    setUnlimitedPerUser(!editing.max_uses_per_user);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (body: Partial<Coupon>) => {
      // Normalize payload based on toggles before hitting the API.
      const payload: Partial<Coupon> = {
        ...body,
        valid_from: foreverDates ? null : (body.valid_from || null),
        valid_to: foreverDates ? null : (body.valid_to || null),
        max_uses: unlimitedUses ? 0 : Number(body.max_uses ?? 0),
        max_uses_per_user: unlimitedPerUser ? 0 : Number(body.max_uses_per_user ?? 0),
      };
      return payload.id ? api.updateCoupon(payload.id, payload) : api.createCoupon(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteCoupon(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  return (
    <div className="page max-w-7xl" data-testid="coupons-page">
      <div className="page-head mb-5">
        <h1 className="text-2xl font-semibold">Промокоды и скидки</h1>
        {canEditCatalog && (
          <button
            className="btn-primary"
            onClick={() => setEditing({
              code: "", kind: "percent", active: true,
              valid_from: null, valid_to: null, max_uses: 0, max_uses_per_user: 0,
            })}
          >
            <Plus size={16} /> Новый промокод
          </button>
        )}
      </div>

      <div className="card p-0 overflow-auto">
        <table className="min-w-[860px] w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200 text-left text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Код</th>
              <th className="px-3 py-2 font-medium">Тип</th>
              <th className="px-3 py-2 font-medium">Значение</th>
              <th className="px-3 py-2 font-medium">Период</th>
              <th className="px-3 py-2 font-medium">Использовано</th>
              <th className="px-3 py-2 font-medium">Лимит</th>
              <th className="px-3 py-2 font-medium">Активен</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!data?.length && (
              <tr><td colSpan={8} className="py-10 text-center text-stone-400">Промокодов нет</td></tr>
            )}
            {data?.map((c) => (
              <tr key={c.id} className="border-b border-stone-100">
                <td className="px-3 py-2 font-mono font-semibold">{c.code}</td>
                <td className="px-3 py-2">{c.kind === "percent" ? "%" : "₽"}</td>
                <td className="px-3 py-2 font-semibold">
                  {c.kind === "percent" ? `${c.value}%` : `${c.value} ₽`}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-stone-500">
                  {c.valid_from || "—"} / {c.valid_to || "—"}
                </td>
                <td className="px-3 py-2 text-stone-600">{c.used_count}</td>
                <td className="px-3 py-2 text-stone-600">{c.max_uses || "∞"}</td>
                <td className="px-3 py-2">
                  <span className={c.active ? "text-emerald-600" : "text-stone-400"}>
                    {c.active ? "✓" : "✗"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {canEditCatalog ? (
                    <>
                      <button className="text-stone-500 hover:text-brand mr-2" onClick={() => setEditing(c)}>
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="text-red-500 hover:text-red-700"
                        onClick={() => { if (confirm(`Удалить ${c.code}?`)) del.mutate(c.id); }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="text-stone-300 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form
            className="modal-panel max-w-md p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing.id ? "Правка" : "Новый промокод"}</h2>
              <button type="button" onClick={() => setEditing(null)}><X size={20} /></button>
            </div>

            <label className="label">Код *</label>
            <input
              className="input font-mono uppercase" required
              value={editing.code || ""}
              onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
              autoFocus
            />

            <div className="form-grid-2 mt-3">
              <div>
                <label className="label">Тип</label>
                <select
                  className="input" value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as any })}
                >
                  <option value="percent">Процент %</option>
                  <option value="fixed">Фикс ₽</option>
                </select>
              </div>
              <div>
                <label className="label">Значение</label>
                <input
                  type="number" required min={1} className="input"
                  value={editing.value || ""}
                  placeholder={editing.kind === "percent" ? "10" : "500"}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditing({ ...editing, value: v === "" ? undefined : Number(v) });
                  }}
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-stone-200 p-3 bg-stone-50/50">
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={foreverDates}
                  onChange={(e) => {
                    setForeverDates(e.target.checked);
                    if (e.target.checked) setEditing({ ...editing, valid_from: null, valid_to: null });
                  }}
                />
                <span className="inline-flex items-center gap-1.5 leading-snug">
                  <InfinityIcon size={14} className="text-brand shrink-0" />
                  Действует бессрочно
                </span>
              </label>
              {!foreverDates && (
                <div className="form-grid-2 mt-3">
                  <div>
                    <label className="label">Активен с</label>
                    <input
                      type="date" className="input"
                      value={editing.valid_from || ""}
                      onChange={(e) => setEditing({ ...editing, valid_from: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <label className="label">Активен до</label>
                    <input
                      type="date" className="input"
                      value={editing.valid_to || ""}
                      onChange={(e) => setEditing({ ...editing, valid_to: e.target.value || null })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-stone-200 p-3 bg-stone-50/50">
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={unlimitedUses}
                  onChange={(e) => {
                    setUnlimitedUses(e.target.checked);
                    if (e.target.checked) setEditing({ ...editing, max_uses: 0 });
                  }}
                />
                <span className="inline-flex items-center gap-1.5 leading-snug">
                  <InfinityIcon size={14} className="text-brand shrink-0" />
                  Без общего лимита использований
                </span>
              </label>
              {!unlimitedUses && (
                <div className="mt-3">
                  <label className="label">Максимум использований всего</label>
                  <input
                    type="number" min={1} className="input"
                    value={editing.max_uses || ""}
                    placeholder="напр. 100"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEditing({ ...editing, max_uses: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-stone-200 p-3 bg-stone-50/50">
              <label className="flex items-start gap-2.5 text-sm font-medium text-stone-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                  checked={unlimitedPerUser}
                  onChange={(e) => {
                    setUnlimitedPerUser(e.target.checked);
                    if (e.target.checked) setEditing({ ...editing, max_uses_per_user: 0 });
                  }}
                />
                <span className="inline-flex items-center gap-1.5 leading-snug">
                  <InfinityIcon size={14} className="text-brand shrink-0" />
                  Без лимита на одного клиента
                </span>
              </label>
              {!unlimitedPerUser && (
                <div className="mt-3">
                  <label className="label">Максимум на одного клиента</label>
                  <input
                    type="number" min={1} className="input"
                    value={editing.max_uses_per_user || ""}
                    placeholder="напр. 3"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEditing({ ...editing, max_uses_per_user: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm select-none cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 mt-0.5 shrink-0 accent-brand"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <span className="leading-snug">Активен</span>
            </label>

            {save.isError && (
              <div className="bg-red-50 text-red-700 text-sm p-2 rounded mt-3">
                {(save.error as any)?.message || "Ошибка"}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn-primary flex-1" disabled={save.isPending}>
                {save.isPending ? "…" : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
