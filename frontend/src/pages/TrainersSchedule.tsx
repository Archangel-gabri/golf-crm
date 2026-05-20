import { useEffect, useState } from "react";
import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, X as XIcon, Pencil, Save } from "lucide-react";
import { api, type Instructor, type TrainerSchedule, type TrainerScheduleDay, type TrainerScheduleDays } from "@/lib/api";
import { usePerms } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAY_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

type PendingPreview = {
  instructorName: string;
  effectiveFrom: string;
  currentDays: TrainerScheduleDays;
  pendingDays: TrainerScheduleDays;
};

type EditTarget = {
  instructor: Instructor;
  current: TrainerScheduleDays;
};

export default function TrainersSchedule() {
  const { isManager } = usePerms();
  const { data: instructors = [], isLoading: loadingList } = useQuery<Instructor[]>({
    queryKey: ["instructors"],
    queryFn: api.instructors,
  });

  const active = instructors.filter((i) => i.active);

  // Параллельно тянем расписания всех активных тренеров.
  const schedules = useQueries({
    queries: active.map((i) => ({
      queryKey: ["all-trainer-schedules", i.id],
      queryFn: () => api.instructorSchedule(i.id),
      staleTime: 30_000,
    })),
  });

  const [preview, setPreview] = useState<PendingPreview | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  if (loadingList) {
    return <div className="page text-stone-500">Загрузка…</div>;
  }

  return (
    <div className="page max-w-[1400px]" data-testid="trainers-schedule-page">
      <div className="flex items-center gap-3 mb-2">
        <CalendarClock className="text-brand" />
        <h1 className="text-2xl font-semibold sm:text-3xl">График тренеров</h1>
      </div>
      <div className="text-stone-600 mb-6">
        Недельный график каждого тренера. Если день закрыт — запись на него автоматически блокируется при создании брони.
        Тренер сам редактирует свой график через раздел «Мой график».
      </div>

      <div className="card p-0 overflow-auto">
        <table className="min-w-[980px] w-full text-sm border-collapse">
          <thead>
            <tr className="bg-stone-50 text-stone-600">
              <th className="px-4 py-2 text-left font-semibold sticky left-0 bg-stone-50 border-r border-stone-200">
                Тренер
              </th>
              {DAY_SHORT.map((d) => (
                <th key={d} className="px-3 py-2 text-center font-semibold">{d}</th>
              ))}
              {isManager && <th className="px-3 py-2 text-right font-semibold">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {active.map((i, idx) => {
              const q = schedules[idx];
              const sch = q.data as TrainerSchedule | undefined;
              const hasPending = !!sch?.pending_effective_from && !!sch?.pending_days;
              return (
                <tr key={i.id} className="border-t border-stone-100">
                  <td className="px-4 py-2 font-medium sticky left-0 bg-white border-r border-stone-200">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-stone-300"
                        style={{ background: i.color || "#999" }}
                      />
                      <span>{i.name}</span>
                    </div>
                    <div className="text-xs text-stone-400">{i.specialization}</div>
                    {hasPending && (
                      <button
                        type="button"
                        className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline mt-1 block text-left"
                        onClick={() =>
                          setPreview({
                            instructorName: i.name,
                            effectiveFrom: sch!.pending_effective_from!,
                            currentDays: sch!.days,
                            pendingDays: sch!.pending_days!,
                          })
                        }
                        data-testid={`pending-badge-${i.id}`}
                        title="Посмотреть новый график"
                      >
                        новый график с{" "}
                        {new Date(sch!.pending_effective_from!).toLocaleDateString("ru-RU")} →
                      </button>
                    )}
                  </td>
                  {q.isLoading ? (
                    <td colSpan={isManager ? 8 : 7} className="px-3 py-2 text-center text-stone-400 text-xs">
                      загрузка…
                    </td>
                  ) : (
                    <>
                      {Array.from({ length: 7 }, (_, dayIdx) => {
                        const d = sch?.days?.[String(dayIdx)];
                        const enabled = !!d?.enabled;
                        return (
                          <td
                            key={dayIdx}
                            className={cn(
                              "px-3 py-2 text-center align-middle",
                              enabled ? "bg-emerald-50/60" : "bg-rose-50/40"
                            )}
                          >
                            {enabled ? (
                              <div className="text-xs">
                                <div className="font-mono font-semibold text-emerald-700">
                                  {d!.start}–{d!.end}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-rose-500">выходной</span>
                            )}
                          </td>
                        );
                      })}
                      {isManager && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                            onClick={() => setEditTarget({ instructor: i, current: sch?.days || {} })}
                            data-testid={`edit-trainer-schedule-${i.id}`}
                            title="Мгновенно изменить (без 7-дневной задержки)"
                          >
                            <Pencil size={13} /> Изменить
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {active.length === 0 && (
              <tr>
                <td colSpan={isManager ? 9 : 8} className="px-4 py-8 text-center text-stone-400">
                  Активные тренеры отсутствуют.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-stone-500 flex items-center gap-4">
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-emerald-50/60 border border-emerald-200 rounded" /> Работает
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-rose-50/40 border border-rose-200 rounded" /> Выходной
        </div>
      </div>

      {preview && <PendingPreviewModal data={preview} onClose={() => setPreview(null)} />}
      {editTarget && (
        <AdminScheduleEditor
          target={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

function AdminScheduleEditor({
  target, onClose,
}: {
  target: EditTarget;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState<TrainerScheduleDays>(() => normalizeDays(target.current));

  useEffect(() => {
    setDays(normalizeDays(target.current));
  }, [target.instructor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (d: TrainerScheduleDays) =>
      api.adminUpdateInstructorSchedule(target.instructor.id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-trainer-schedules"] });
      qc.invalidateQueries({ queryKey: ["my-schedule"] });
      onClose();
    },
  });

  function setDay(idx: number, patch: Partial<TrainerScheduleDay>) {
    setDays((prev) => ({
      ...prev,
      [String(idx)]: { ...prev[String(idx)], ...patch },
    }));
  }

  return (
    <div
      className="modal-overlay bg-black/30"
      onClick={onClose}
    >
      <div
        className="modal-panel max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil size={18} className="text-brand" />
            <div>
              <div className="text-lg font-semibold">
                Изменить график — {target.instructor.name}
              </div>
              <div className="text-xs text-stone-500">
                Админ/менеджер применяет изменения <span className="font-medium">сразу</span>, без 7-дневной задержки.
                Если у тренера был отложенный график — он будет заменён.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-stone-400 hover:text-stone-700"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
          {DAY_FULL.map((label, idx) => {
            const d = days[String(idx)];
            return (
              <div
                key={idx}
                className={cn(
                  "grid grid-cols-1 gap-3 px-3 py-2 rounded-lg border sm:grid-cols-[auto_1fr_auto_auto] sm:items-center",
                  d.enabled ? "bg-white border-stone-200" : "bg-stone-50 border-stone-200"
                )}
              >
                <label className="flex items-center gap-2 cursor-pointer w-40">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={(e) => setDay(idx, { enabled: e.target.checked })}
                  />
                  <span className={cn("text-sm font-medium", d.enabled ? "text-stone-800" : "text-stone-400")}>
                    {label}
                  </span>
                </label>
                <div className="text-xs text-stone-500">
                  {d.enabled ? `с ${d.start} до ${d.end}` : "выходной"}
                </div>
                <input
                  type="time"
                  value={d.start}
                  disabled={!d.enabled}
                  onChange={(e) => setDay(idx, { start: e.target.value })}
                  className="input max-w-[110px] disabled:opacity-40"
                  step={300}
                />
                <input
                  type="time"
                  value={d.end}
                  disabled={!d.enabled}
                  onChange={(e) => setDay(idx, { end: e.target.value })}
                  className="input max-w-[110px] disabled:opacity-40"
                  step={300}
                />
              </div>
            );
          })}
          {save.error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
              {(save.error as Error).message}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-200 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={save.isPending}>
            Отмена
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => save.mutate(days)}
            disabled={save.isPending}
            data-testid="admin-schedule-save"
          >
            <Save size={14} />
            {save.isPending ? "Применяем…" : "Применить сразу"}
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeDays(src: TrainerScheduleDays): TrainerScheduleDays {
  const out: TrainerScheduleDays = {};
  for (let i = 0; i < 7; i++) {
    const k = String(i);
    const d = src?.[k];
    out[k] = {
      enabled: !!d?.enabled,
      start: d?.start || "10:00",
      end: d?.end || (i < 5 ? "20:00" : "18:00"),
    };
  }
  return out;
}

function PendingPreviewModal({
  data, onClose,
}: {
  data: PendingPreview;
  onClose: () => void;
}) {
  const effDate = new Date(data.effectiveFrom);
  return (
    <div
      className="modal-overlay bg-black/30"
      onClick={onClose}
    >
      <div
        className="modal-panel max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-amber-600" />
            <div>
              <div className="text-lg font-semibold">Новый график — {data.instructorName}</div>
              <div className="text-xs text-stone-500">
                вступит в силу с{" "}
                <span className="font-mono font-medium text-amber-700">
                  {effDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-stone-400 hover:text-stone-700"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="table-shell">
          <table className="min-w-[620px] w-full text-sm">
            <thead>
              <tr className="text-stone-500 text-xs uppercase">
                <th className="text-left px-3 py-2 font-semibold">День</th>
                <th className="text-left px-3 py-2 font-semibold">Сейчас</th>
                <th className="text-left px-3 py-2 font-semibold">Станет</th>
              </tr>
            </thead>
            <tbody>
              {DAY_FULL.map((label, idx) => {
                const cur = data.currentDays?.[String(idx)];
                const nxt = data.pendingDays?.[String(idx)];
                const curStr = cur?.enabled ? `${cur.start}–${cur.end}` : "выходной";
                const nxtStr = nxt?.enabled ? `${nxt.start}–${nxt.end}` : "выходной";
                const changed = curStr !== nxtStr;
                return (
                  <tr
                    key={idx}
                    className={cn(
                      "border-t border-stone-100",
                      changed ? "bg-amber-50/50" : ""
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-stone-700">{label}</td>
                    <td
                      className={cn(
                        "px-3 py-2 font-mono",
                        cur?.enabled ? "text-stone-600" : "text-rose-500"
                      )}
                    >
                      {curStr}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 font-mono",
                        nxt?.enabled ? "text-emerald-700 font-semibold" : "text-rose-500"
                      )}
                    >
                      {nxtStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="mt-4 text-xs text-stone-500">
            Подсвеченные строки — там, где график изменится. Админ может принять изменение досрочно через профиль тренера.
          </div>
        </div>

        <div className="px-6 py-3 border-t border-stone-200 flex justify-end">
          <button className="btn-primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
