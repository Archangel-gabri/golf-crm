import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Save, Check } from "lucide-react";
import { api, type TrainerScheduleDay, type TrainerScheduleDays } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function defaultDays(): TrainerScheduleDays {
  const out: TrainerScheduleDays = {};
  for (let i = 0; i < 7; i++) {
    out[String(i)] = {
      enabled: i < 5,
      start: "10:00",
      end: i < 5 ? "20:00" : "18:00",
    };
  }
  return out;
}

export default function MySchedule() {
  const qc = useQueryClient();
  const { data: sch, isLoading } = useQuery({
    queryKey: ["my-schedule"],
    queryFn: api.mySchedule,
  });

  const [days, setDays] = useState<TrainerScheduleDays>(defaultDays);
  const [savedTick, setSavedTick] = useState(false);

  // Если есть отложенный график — редактируем его (это превратится в новую отложенную версию).
  // Иначе редактируем текущий.
  useEffect(() => {
    if (!sch) return;
    setDays((sch.pending_days as TrainerScheduleDays | null) || sch.days);
  }, [sch]);

  const save = useMutation({
    mutationFn: (d: TrainerScheduleDays) => api.updateMySchedule(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-schedule"] });
      qc.invalidateQueries({ queryKey: ["all-trainer-schedules"] });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    },
  });

  function setDay(idx: number, patch: Partial<TrainerScheduleDay>) {
    setDays((prev) => ({
      ...prev,
      [String(idx)]: { ...prev[String(idx)], ...patch },
    }));
  }

  if (isLoading) {
    return <div className="page text-stone-500">Загрузка…</div>;
  }

  return (
    <div className="page max-w-4xl" data-testid="my-schedule-page">
      <div className="flex items-center gap-3 mb-2">
        <CalendarClock className="text-brand" />
        <h1 className="text-3xl font-semibold">Мой график</h1>
      </div>
      <div className="text-stone-600 mb-4">
        Отметь, когда ты работаешь. Ресепшен не сможет поставить тебе занятие в выходной или за пределами окна.
        {sch?.instructor_name && (
          <span className="ml-2 text-stone-400">· {sch.instructor_name}</span>
        )}
      </div>

      {/* Информация про задержку 7 дней */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-6">
        <div className="font-semibold mb-0.5">Изменения вступают в силу через 7 дней.</div>
        Это сделано, чтобы ты не мог в день в день поменять расписание и оставить ресепшен в неудобном положении.
        Срочно поправить может только администратор клуба.
        {sch?.pending_effective_from && (
          <div className="mt-2 text-amber-800">
            Сейчас редактируется график, который вступит в силу с{" "}
            <span className="font-mono font-semibold">
              {new Date(sch.pending_effective_from).toLocaleDateString("ru-RU")}
            </span>.
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {DAY_LABELS.map((label, idx) => {
          const d = days[String(idx)] || { enabled: false, start: "10:00", end: "18:00" };
          return (
            <div
              key={idx}
              className={cn(
                "grid grid-cols-1 gap-3 px-4 py-3 border-b last:border-b-0 border-stone-100 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center sm:gap-4 sm:px-5",
                d.enabled ? "bg-white" : "bg-stone-50"
              )}
            >
              <label className="flex items-center gap-2 cursor-pointer w-44">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDay(idx, { enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className={cn("font-medium", d.enabled ? "text-stone-800" : "text-stone-400")}>
                  {label}
                </span>
              </label>
              <div className="text-sm text-stone-500">
                {d.enabled ? `Работаю с ${d.start} до ${d.end}` : "Выходной"}
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
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => save.mutate(days)}
          disabled={save.isPending}
          data-testid="save-schedule"
        >
          <Save size={16} />
          {save.isPending ? "Сохраняем…" : "Сохранить график"}
        </button>
        {savedTick && (
          <span className="inline-flex items-center gap-1 text-emerald-700 text-sm">
            <Check size={14} /> Сохранено
          </span>
        )}
        {save.error && (
          <span className="text-rose-600 text-sm">{(save.error as Error).message}</span>
        )}
      </div>

      <div className="mt-6 card bg-amber-50 border border-amber-200 text-amber-900 text-sm">
        <div className="font-semibold mb-1">Быстрые пресеты</div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-1 rounded-full border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-xs"
            onClick={() => {
              const d: TrainerScheduleDays = {};
              for (let i = 0; i < 7; i++) d[String(i)] = { enabled: i < 5, start: "10:00", end: "20:00" };
              setDays(d);
            }}
          >
            Будни 10–20, выходные выкл
          </button>
          <button
            className="px-3 py-1 rounded-full border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-xs"
            onClick={() => {
              const d: TrainerScheduleDays = {};
              for (let i = 0; i < 7; i++) d[String(i)] = { enabled: true, start: "09:00", end: "21:00" };
              setDays(d);
            }}
          >
            Каждый день 09–21
          </button>
          <button
            className="px-3 py-1 rounded-full border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-xs"
            onClick={() => {
              const d: TrainerScheduleDays = {};
              for (let i = 0; i < 7; i++) d[String(i)] = { enabled: false, start: "10:00", end: "18:00" };
              setDays(d);
            }}
          >
            Все выходные
          </button>
        </div>
      </div>

      <div className="mt-4 text-xs text-stone-400">
        Короткие дни: {DAY_SHORT.map((s, i) => (
          <span key={i} className={cn("mx-1", days[String(i)]?.enabled ? "text-emerald-600" : "text-rose-400")}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
