import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Calculator, AlertCircle, Clock } from "lucide-react";
import { api, type Booking, type Resource } from "@/lib/api";
import { formatRub } from "@/lib/utils";
import { usePerms } from "@/hooks/useAuth";

type Mode =
  | { mode: "create"; resource: Resource; date: string; time: string }
  | { mode: "edit"; booking: Booking };

type Props = Mode & { onClose: () => void };

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocalISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export default function BookingDialog(props: Props) {
  const qc = useQueryClient();
  const perms = usePerms();
  const isInstructor = perms.isInstructor;
  const myInstructorId = perms.user?.instructor_id ?? 0;

  const { data: services } = useQuery({ queryKey: ["services"], queryFn: api.services });
  const { data: instructors } = useQuery({ queryKey: ["instructors"], queryFn: api.instructors });
  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: () => api.customers() });
  const { data: resources } = useQuery({ queryKey: ["visible-resources"], queryFn: api.visibleResources });
  const { data: resourceServices } = useQuery({
    queryKey: ["resource-services-map"],
    queryFn: api.resourceServicesMap,
  });
  const instructorGroups = useMemo(() => {
    const list = instructors || [];
    return [
      { key: "club", label: "Клубные тренеры", items: list.filter((i) => i.trainer_type !== "external") },
      { key: "external", label: "Другие тренеры", items: list.filter((i) => i.trainer_type === "external") },
    ].filter((g) => g.items.length > 0);
  }, [instructors]);

  const isCreate = props.mode === "create";
  const initial = isCreate
    ? {
      service_id: 0,
      instructor_id: isInstructor ? myInstructorId : 0,
      customer_id: 0,
      resource_id: props.resource.id,
      starts_at: `${props.date}T${props.time}:00`,
      duration_min: 60,
      guests: 1,
      coupon_code: "",
      comment: "",
      manual_price: "",
    }
    : (() => {
      const b = props.booking;
      const dur = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
      return {
        service_id: b.service_id || 0,
        instructor_id: b.instructor_id || 0,
        customer_id: b.customer_id || 0,
        resource_id: b.resource_id || 0,
        starts_at: b.starts_at.slice(0, 16),
        duration_min: dur,
        guests: b.guests,
        coupon_code: "",
        comment: b.comment,
        manual_price: "",
      };
    })();

  const [form, setForm] = useState(initial);
  const [quote, setQuote] = useState<any>(null);
  const [quickCustomer, setQuickCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live price quote via debounce
  useEffect(() => {
    if (!form.service_id) { setQuote(null); return; }
    const t = setTimeout(() => {
      api.priceQuote({
        service_id: form.service_id || null,
        instructor_id: form.instructor_id || null,
        guests: form.guests,
        duration_min: form.duration_min,
        coupon_code: form.coupon_code,
      }).then(setQuote).catch(() => setQuote(null));
    }, 200);
    return () => clearTimeout(t);
  }, [form.service_id, form.instructor_id, form.guests, form.duration_min, form.coupon_code]);

  const createMut = useMutation({
    mutationFn: api.createBooking,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings-day"] });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["cal-events"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      props.onClose();
    },
    onError: (e: any) => setError(e.message || "Ошибка"),
  });

  const editMut = useMutation({
    mutationFn: (body: any) => api.editBooking((props as any).booking.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings-day"] });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["cal-events"] });
      props.onClose();
    },
    onError: (e: any) => setError(e.message || "Ошибка"),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let customerId: number | undefined = form.customer_id || undefined;
    if (quickCustomer && quickCustomer.name.trim()) {
      const c = await api.createCustomer({
        name: quickCustomer.name,
        phone: quickCustomer.phone,
      });
      customerId = c.id;
    }

    const startDate = new Date(form.starts_at);
    const endDate = new Date(startDate.getTime() + form.duration_min * 60_000);
    const starts = toLocalISO(startDate);
    const ends = toLocalISO(endDate);
    const manualPriceKopecks = form.manual_price ? Number(form.manual_price) * 100 : undefined;

    if (isCreate) {
      createMut.mutate({
        resource_id: form.resource_id,
        service_id: form.service_id || undefined,
        instructor_id: form.instructor_id || undefined,
        customer_id: customerId,
        starts_at: starts,
        ends_at: ends,
        guests: form.guests,
        comment: form.comment,
        coupon_code: form.coupon_code,
        ...(manualPriceKopecks !== undefined && { price_kopecks: manualPriceKopecks }),
      });
    } else {
      editMut.mutate({
        resource_id: form.resource_id || null,
        service_id: form.service_id || null,
        instructor_id: form.instructor_id || null,
        customer_id: customerId ?? null,
        starts_at: starts,
        ends_at: ends,
        guests: form.guests,
        comment: form.comment,
        coupon_code: form.coupon_code,
        manual_price_kopecks: manualPriceKopecks,
      });
    }
  }

  const activeResource = useMemo(
    () => resources?.find((r) => r.id === form.resource_id),
    [resources, form.resource_id]
  );

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <form
        className="modal-panel max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        data-testid="booking-dialog"
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-stone-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold">{isCreate ? "Новая бронь" : `Правка брони #${(props as any).booking?.id}`}</h2>
            <div className="text-xs text-stone-500">
              {activeResource?.name} · {form.starts_at.replace("T", " ")}
            </div>
          </div>
          <button type="button" onClick={props.onClose} className="text-stone-400 hover:text-stone-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="form-grid-2">
            <div>
              <label className="label">Ресурс</label>
              <select
                className="input" value={form.resource_id}
                onChange={(e) => setForm({ ...form, resource_id: Number(e.target.value) })}
              >
                <option value={0}>—</option>
                {resources?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Время начала</label>
              <input
                type="datetime-local"
                className="input" value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-grid-3">
            <div>
              <label className="label">Длительность, мин</label>
              <input
                type="number" min={5} max={480} step={5}
                className="input" value={form.duration_min}
                onChange={(e) => setForm({ ...form, duration_min: Math.max(5, Number(e.target.value) || 60) })}
                data-testid="dialog-duration"
                placeholder="введите минуты"
              />
              <div className="flex gap-1 mt-1.5">
                {[15, 30, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="text-xs px-2 py-0.5 rounded border border-stone-300 text-stone-600 hover:border-brand hover:text-brand inline-flex items-center gap-1"
                    onClick={() =>
                      setForm({ ...form, duration_min: Math.min(480, form.duration_min + m) })
                    }
                    data-testid={`dialog-extend-${m}`}
                    title="Добавить минуты к длительности"
                  >
                    <Clock size={11} /> +{m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Гостей</label>
              <input
                type="number" min={1} max={20} className="input" value={form.guests}
                onChange={(e) => setForm({ ...form, guests: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
            <div>
              <label className="label">Статус</label>
              <div className="h-[42px] flex items-center">
                <span className="text-xs bg-brand/10 text-brand px-2 py-1 rounded-full border border-brand/20">
                  {isCreate ? "черновик" : (props as any).booking?.status}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="label">
              Услуга
              {form.resource_id && resourceServices && resourceServices[String(form.resource_id)]?.length > 0 && (
                <span className="text-xs font-normal text-brand ml-2">
                  · отфильтровано по ресурсу
                </span>
              )}
            </label>
            <select
              className="input" value={form.service_id}
              onChange={(e) => {
                const sid = Number(e.target.value);
                const svc = services?.find((s) => s.id === sid);
                setForm({
                  ...form,
                  service_id: sid,
                  duration_min: svc?.duration_min || form.duration_min,
                });
              }}
              data-testid="dialog-service"
            >
              <option value={0}>—</option>
              {(services || [])
                .filter((s) => {
                  if (!form.resource_id) return true;
                  const allowed = resourceServices?.[String(form.resource_id)];
                  if (!allowed || allowed.length === 0) return true;
                  return allowed.includes(s.id);
                })
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {formatRub(s.base_price_kopecks)}{s.group_size ? ` · до ${s.group_size}` : ""}
                  </option>
                ))}
            </select>
          </div>

          <div className="form-grid-2">
            <div>
              <label className="label">Тренер</label>
              <select
                className="input" value={form.instructor_id}
                onChange={(e) => setForm({ ...form, instructor_id: Number(e.target.value) })}
                disabled={isInstructor}
                title={isInstructor ? "Тренер может ставить брони только на себя" : undefined}
                data-testid="dialog-instructor"
              >
                <option value={0}>—</option>
                {instructorGroups.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {group.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}{i.tags?.length ? ` · ${i.tags.slice(0, 2).join(", ")}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Промокод</label>
              <input
                className="input font-mono uppercase" value={form.coupon_code}
                onChange={(e) => setForm({ ...form, coupon_code: e.target.value.toUpperCase() })}
                placeholder="Напр. WELCOME10"
                data-testid="dialog-coupon"
              />
            </div>
          </div>

          <div>
            <label className="label flex items-center justify-between">
              <span>Клиент</span>
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() => setQuickCustomer(quickCustomer ? null : { name: "", phone: "" })}
              >
                {quickCustomer ? "Выбрать из списка" : "+ Быстро создать"}
              </button>
            </label>
            {quickCustomer ? (
              <div className="form-grid-2 gap-2">
                <input
                  className="input" placeholder="ФИО *" value={quickCustomer.name}
                  onChange={(e) => setQuickCustomer({ ...quickCustomer, name: e.target.value })}
                  data-testid="dialog-quick-name"
                />
                <input
                  className="input" placeholder="Телефон" value={quickCustomer.phone}
                  onChange={(e) => setQuickCustomer({ ...quickCustomer, phone: e.target.value })}
                />
              </div>
            ) : (
              <select
                className="input" value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: Number(e.target.value) })}
                data-testid="dialog-customer"
              >
                <option value={0}>—</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input" rows={2} value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
          </div>

          {/* Price breakdown */}
          {quote && (
            <div className="bg-stone-50 rounded-lg p-4 space-y-1 text-sm" data-testid="dialog-quote">
              <div className="font-semibold text-stone-700 flex items-center gap-2 mb-2">
                <Calculator size={14} /> Расчёт стоимости
              </div>
              <div className="flex justify-between">
                <span>База</span>
                <span className="font-mono">{formatRub(quote.base_kopecks)}</span>
              </div>
              {quote.discount_kopecks > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Скидка по промокоду</span>
                  <span className="font-mono">-{formatRub(quote.discount_kopecks)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-stone-200 pt-1.5 mt-1.5">
                <span>Итого</span>
                <span className="font-mono text-brand">{formatRub(quote.total_kopecks)}</span>
              </div>
              {quote.coupon_error && (
                <div className="text-red-600 text-xs flex items-center gap-1 mt-1">
                  <AlertCircle size={12} /> {quote.coupon_error}
                </div>
              )}
              {quote.notes?.length > 0 && (
                <div className="text-xs text-stone-500 mt-1">
                  {quote.notes.map((n: string, i: number) => <div key={i}>• {n}</div>)}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">Ручная цена, ₽ (переопределить расчёт)</label>
            <input
              type="number" className="input" placeholder="оставьте пустым для авто-расчёта"
              value={form.manual_price}
              onChange={(e) => setForm({ ...form, manual_price: e.target.value })}
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-2 rounded border border-red-200">{error}</div>
          )}
        </div>

        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:p-5 border-t border-stone-200 sticky bottom-0 bg-white">
          <button type="button" className="btn-ghost flex-1" onClick={props.onClose}>Отмена</button>
          <button
            className="btn-primary flex-1"
            disabled={createMut.isPending || editMut.isPending}
            data-testid="dialog-submit"
          >
            {createMut.isPending || editMut.isPending ? "…" : isCreate ? "Создать" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
