import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Edit2, Trash2, Phone, Mail, Clock, Users, UserPlus, Unlink } from "lucide-react";
import { api, type Instructor, type Customer, type TrainerScheduleDays, type TrainerScheduleDay } from "@/lib/api";

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function emptyDays(): TrainerScheduleDays {
  const out: TrainerScheduleDays = {};
  for (let d = 0; d < 7; d++) {
    out[String(d)] = { enabled: d < 5, start: "10:00", end: "20:00" };
  }
  return out;
}

/** Deterministic pastel colour per trainer name (so avatars feel consistent). */
function colorForName(name: string) {
  const palette = ["#2E9A6A", "#3A6EA5", "#8B5A96", "#C9A961", "#B98A3C", "#7A5A10", "#C13B3B"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000;
  return palette[h % palette.length];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function trainerTypeLabel(type?: string) {
  return type === "external" ? "Другой тренер" : "Клубный тренер";
}

export default function InstructorEditor() {
  const qc = useQueryClient();
  const { data: instructors } = useQuery({ queryKey: ["instructors-all"], queryFn: api.instructors });
  const [editing, setEditing] = useState<Partial<Instructor> | null>(null);
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [clientsInstructorId, setClientsInstructorId] = useState<number | null>(null);
  const groupedInstructors = useMemo(() => {
    const list = instructors || [];
    return [
      { key: "club", label: "Клубные тренеры", items: list.filter((i) => i.trainer_type !== "external") },
      { key: "external", label: "Другие тренеры", items: list.filter((i) => i.trainer_type === "external") },
    ].filter((g) => g.items.length > 0);
  }, [instructors]);

  const save = useMutation({
    mutationFn: async (i: Partial<Instructor>) => {
      const body: Partial<Instructor> = {
        name: i.name || "",
        trainer_type: i.trainer_type || "club",
        specialization: i.specialization || "",
        phone: i.phone || "",
        email: i.email || "",
        bio: i.bio || "",
        color: i.color || colorForName(i.name || ""),
        active: i.active ?? true,
      };
      if (i.id) return api.updateInstructor(i.id, body);
      return api.createInstructor(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructors-all"] });
      qc.invalidateQueries({ queryKey: ["instructors"] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteInstructor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructors-all"] });
      qc.invalidateQueries({ queryKey: ["instructors"] });
    },
  });

  return (
    <div className="page max-w-6xl" data-testid="instructor-editor-page">
      <div className="page-head mb-6 sm:items-start">
        <div>
          <h1 className="text-3xl font-semibold">Тренеры</h1>
          <p className="text-sm text-stone-500 mt-1">Добавьте тренера и короткое описание от него самого.</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setEditing({ name: "", trainer_type: "club", specialization: "", phone: "", email: "", bio: "", active: true })}
          data-testid="new-instructor-btn"
        >
          <Plus size={18} /> Добавить тренера
        </button>
      </div>

      <div className="space-y-7">
        {groupedInstructors.map((group) => (
          <section key={group.key}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-stone-800">{group.label}</h2>
              <span className="text-xs text-stone-500">{group.items.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {group.items.map((i) => (
                <div key={i.id} className="card" data-testid={`instr-card-${i.id}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-semibold shrink-0"
                      style={{ background: i.color || colorForName(i.name) }}
                    >
                      {initials(i.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-lg font-semibold truncate">{i.name}</div>
                      <div className="text-xs font-medium text-brand mt-0.5">{trainerTypeLabel(i.trainer_type)}</div>
                      {i.specialization && (
                        <div className="text-sm text-stone-500 mt-0.5">{i.specialization}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
                        {i.phone && (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone size={14} className="text-stone-400" /> {i.phone}
                          </span>
                        )}
                        {i.email && (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail size={14} className="text-stone-400" /> {i.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        className="w-9 h-9 rounded-lg border border-stone-200 text-stone-500 hover:text-brand hover:border-brand/40 flex items-center justify-center"
                        title="Клиенты тренера"
                        onClick={() => setClientsInstructorId(i.id)}
                      >
                        <Users size={16} />
                      </button>
                      <button
                        className="w-9 h-9 rounded-lg border border-stone-200 text-stone-500 hover:text-brand hover:border-brand/40 flex items-center justify-center"
                        title="График работы"
                        onClick={() => setSchedulingId(i.id)}
                        data-testid={`schedule-instructor-${i.id}`}
                      >
                        <Clock size={16} />
                      </button>
                      <button
                        className="w-9 h-9 rounded-lg border border-stone-200 text-stone-500 hover:text-brand hover:border-brand/40 flex items-center justify-center"
                        title="Редактировать"
                        onClick={() => setEditing(i)}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        className="w-9 h-9 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center"
                        title="Удалить"
                        onClick={() => {
                          if (confirm(`Удалить тренера «${i.name}»? Это действие нельзя отменить.`)) {
                            remove.mutate(i.id);
                          }
                        }}
                        data-testid={`delete-instructor-${i.id}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {i.bio ? (
                    <p className="mt-4 text-stone-700 leading-relaxed">{i.bio}</p>
                  ) : (
                    <p className="mt-4 text-sm text-stone-400 italic">
                      Нет описания. Нажмите «Редактировать», чтобы добавить текст от тренера.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {instructors?.length === 0 && (
          <div className="card py-16 text-center text-stone-500">
            Пока нет тренеров. Нажмите «Добавить тренера».
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form
            className="modal-panel max-w-lg p-4 sm:p-7"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold">{editing.id ? "Правка тренера" : "Новый тренер"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-stone-400 hover:text-stone-700">
                <X size={22} />
              </button>
            </div>

            <label className="label">ФИО тренера *</label>
            <input
              className="input" required value={editing.name || ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Иванов Иван Иванович"
              data-testid="instr-name"
            />

            <label className="label mt-4">Категория тренера</label>
            <select
              className="input"
              value={editing.trainer_type || "club"}
              onChange={(e) => setEditing({ ...editing, trainer_type: e.target.value as "club" | "external" })}
            >
              <option value="club">Клубный тренер</option>
              <option value="external">Другой тренер</option>
            </select>

            <label className="label mt-4">Специализация</label>
            <input
              className="input" value={editing.specialization || ""}
              onChange={(e) => setEditing({ ...editing, specialization: e.target.value })}
              placeholder="напр. PGA Pro, уроки на поле"
            />

            <div className="form-grid-2 mt-4">
              <div>
                <label className="label">Телефон</label>
                <input
                  className="input" value={editing.phone || ""}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  placeholder="+7 ..."
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email" className="input" value={editing.email || ""}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  placeholder="trainer@club.ru"
                />
              </div>
            </div>

            <label className="label mt-4">Описание от тренера</label>
            <textarea
              className="input min-h-[140px] leading-relaxed"
              placeholder="Пару строк от самого тренера: опыт, методика, с кем работает."
              value={editing.bio || ""}
              onChange={(e) => setEditing({ ...editing, bio: e.target.value })}
            />

            {save.isError && (
              <div className="bg-red-50 text-red-700 text-sm p-2 rounded mt-3">
                {(save.error as any)?.message || "Ошибка"}
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn-primary flex-1" disabled={save.isPending} data-testid="instr-submit">
                {save.isPending ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      )}

      {schedulingId !== null && (
        <ScheduleDialog
          instructorId={schedulingId}
          onClose={() => setSchedulingId(null)}
        />
      )}

      {clientsInstructorId !== null && (
        <InstructorClientsPanel
          instructorId={clientsInstructorId}
          instructorName={instructors?.find((i) => i.id === clientsInstructorId)?.name ?? ""}
          onClose={() => setClientsInstructorId(null)}
        />
      )}
    </div>
  );
}

function ScheduleDialog({
  instructorId,
  onClose,
}: { instructorId: number; onClose: () => void }) {
  const [days, setDays] = useState<TrainerScheduleDays>(emptyDays());
  const { data: full } = useQuery({
    queryKey: ["instructor-full", instructorId],
    queryFn: () => api.getInstructor(instructorId),
  });

  useEffect(() => {
    if (full && (full as any).working_hours) {
      const raw = (full as any).working_hours || {};
      const normalized: TrainerScheduleDays = {};
      for (let d = 0; d < 7; d++) {
        const k = String(d);
        const src = raw[k] || {};
        normalized[k] = {
          enabled: !!src.enabled,
          start: src.start || "10:00",
          end: src.end || "20:00",
        };
      }
      setDays(normalized);
    }
  }, [full]);

  const save = useMutation({
    mutationFn: async () => {
      const f = full as any;
      if (!f) return;
      return api.updateInstructor(instructorId, {
        name: f.name,
        trainer_type: f.trainer_type || "club",
        phone: f.phone,
        email: f.email,
        bio: f.bio,
        color: f.color,
        specialization: f.specialization,
        active: f.active,
        // сервер принимает working_hours как JSON — отправим нормализованный dict
        ...({ working_hours: days } as any),
      });
    },
    onSuccess: onClose,
  });

  function setDay(key: string, patch: Partial<TrainerScheduleDay>) {
    setDays({ ...days, [key]: { ...days[key], ...patch } });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-xl p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">График работы</h2>
            <div className="text-sm text-stone-500">{(full as any)?.name || ""}</div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={22} />
          </button>
        </div>

        <div className="space-y-2">
          {DAY_LABELS.map((label, idx) => {
            const k = String(idx);
            const d = days[k];
            return (
              <label
                key={k}
                className={
                  "flex flex-wrap items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer " +
                  (d.enabled ? "border-brand/40 bg-brand/5" : "border-stone-200")
                }
              >
                <input
                  type="checkbox" checked={d.enabled}
                  onChange={(e) => setDay(k, { enabled: e.target.checked })}
                />
                <span className="w-8 font-medium">{label}</span>
                <input
                  type="time" className="input !w-28 !py-1" value={d.start}
                  disabled={!d.enabled}
                  onChange={(e) => setDay(k, { start: e.target.value })}
                />
                <span className="text-stone-400">—</span>
                <input
                  type="time" className="input !w-28 !py-1" value={d.end}
                  disabled={!d.enabled}
                  onChange={(e) => setDay(k, { end: e.target.value })}
                />
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary flex-1"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Сохраняем…" : "Сохранить график"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstructorClientsPanel({
  instructorId,
  instructorName,
  onClose,
}: { instructorId: number; instructorName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const { data: linked = [] } = useQuery({
    queryKey: ["instructor-customers", instructorId],
    queryFn: () => api.instructorCustomers(instructorId),
  });
  const { data: allCustomers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.customers(),
  });

  const linkedIds = new Set(linked.map((c) => c.id));

  const filteredLinked = linked.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q);
  });

  const filteredAll = allCustomers.filter((c) => {
    if (linkedIds.has(c.id)) return false;
    const q = search.toLowerCase();
    return q && (c.name.toLowerCase().includes(q) || (c.phone || "").includes(q));
  });

  const link = useMutation({
    mutationFn: (customerId: number) => api.linkInstructorCustomer(instructorId, customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructor-customers", instructorId] });
      setSearch("");
      setShowAddExisting(false);
    },
  });

  const unlink = useMutation({
    mutationFn: (customerId: number) => api.unlinkInstructorCustomer(instructorId, customerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instructor-customers", instructorId] }),
  });

  const createAndLink = useMutation({
    mutationFn: async () => {
      const c = await api.createCustomer({ name: quickName.trim(), phone: quickPhone.trim() });
      await api.linkInstructorCustomer(instructorId, c.id);
      return c;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructor-customers", instructorId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setQuickName("");
      setQuickPhone("");
      setShowQuickCreate(false);
    },
  });

  const updateCustomer = useMutation({
    mutationFn: (c: Customer) => api.updateCustomer(c.id, { name: c.name, phone: c.phone, email: c.email, notes: c.notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructor-customers", instructorId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setEditingCustomer(null);
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel max-w-lg p-4 sm:p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Клиенты тренера</h2>
            <p className="text-sm text-stone-500">{instructorName}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={22} /></button>
        </div>

        {/* Search + add buttons */}
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Поиск по имени или телефону"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowAddExisting(!!e.target.value); }}
          />
          <button
            type="button"
            className="btn-ghost border border-stone-300 rounded-lg px-3 py-2 text-sm whitespace-nowrap"
            onClick={() => setShowQuickCreate((v) => !v)}
          >
            <UserPlus size={15} className="inline mr-1" />
            Новый
          </button>
        </div>

        {/* Quick create form */}
        {showQuickCreate && (
          <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 space-y-2">
            <div className="text-sm font-medium text-brand mb-1">Создать нового клиента и добавить к тренеру</div>
            <input
              className="input"
              placeholder="ФИО клиента *"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
            />
            <input
              className="input"
              inputMode="tel"
              placeholder="Телефон (необязательно)"
              value={quickPhone}
              onChange={(e) => setQuickPhone(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={() => { setShowQuickCreate(false); setQuickName(""); setQuickPhone(""); }}
              >Отмена</button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!quickName.trim() || createAndLink.isPending}
                onClick={() => createAndLink.mutate()}
              >Создать и добавить</button>
            </div>
          </div>
        )}

        {/* Search results for linking existing */}
        {showAddExisting && filteredAll.length > 0 && (
          <div>
            <div className="text-xs text-stone-500 mb-1">Добавить из базы:</div>
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-40 overflow-auto">
              {filteredAll.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-brand/5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    {c.phone && <div className="text-xs text-stone-500">{c.phone}</div>}
                  </div>
                  <button
                    type="button"
                    className="text-brand text-xs font-semibold hover:underline whitespace-nowrap"
                    onClick={() => link.mutate(c.id)}
                  >+ Добавить</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked clients list */}
        <div className="flex-1 min-h-0">
          <div className="text-xs text-stone-500 mb-1">{linked.length} клиент(ов)</div>
          {filteredLinked.length === 0 ? (
            <div className="text-center text-stone-400 text-sm py-8">Нет клиентов</div>
          ) : (
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-80 overflow-auto">
              {filteredLinked.map((c) =>
                editingCustomer?.id === c.id ? (
                  <div key={c.id} className="p-3 space-y-2 bg-stone-50">
                    <input
                      className="input text-sm"
                      value={editingCustomer.name}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                      placeholder="ФИО"
                    />
                    <input
                      className="input text-sm"
                      value={editingCustomer.phone ?? ""}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                      placeholder="Телефон"
                    />
                    <input
                      className="input text-sm"
                      value={editingCustomer.notes ?? ""}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                      placeholder="Заметки"
                    />
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost flex-1 text-sm py-1" onClick={() => setEditingCustomer(null)}>Отмена</button>
                      <button
                        type="button"
                        className="btn-primary flex-1 text-sm py-1"
                        disabled={updateCustomer.isPending}
                        onClick={() => updateCustomer.mutate(editingCustomer)}
                      >Сохранить</button>
                    </div>
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2.5 hover:bg-stone-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-stone-500 flex gap-3">
                        {c.phone && <span>{c.phone}</span>}
                        {c.notes && <span className="truncate max-w-[180px]">{c.notes}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Редактировать"
                      className="w-8 h-8 rounded-lg border border-stone-200 text-stone-500 hover:text-brand hover:border-brand/40 flex items-center justify-center"
                      onClick={() => setEditingCustomer(c as Customer)}
                    ><Edit2 size={14} /></button>
                    <button
                      type="button"
                      title="Убрать из списка тренера"
                      className="w-8 h-8 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 flex items-center justify-center"
                      onClick={() => unlink.mutate(c.id)}
                    ><Unlink size={14} /></button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
