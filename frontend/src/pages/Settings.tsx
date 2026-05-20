import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Save } from "lucide-react";

export default function Settings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      const initial: Record<string, string> = {};
      for (const s of data) initial[s.key] = s.value;
      setValues(initial);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.updateSetting(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const resetPrice = useMutation({
    mutationFn: () => api.resetServicesFromPrice(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["services-all"] });
      qc.invalidateQueries({ queryKey: ["memberships"] });
      qc.invalidateQueries({ queryKey: ["scenario-catalog"] });
      alert(`Каталог синхронизирован: ${r.total} услуг из прайса, новых записей: ${r.created}.`);
    },
  });

  return (
    <div className="page max-w-3xl" data-testid="settings-page">
      <h1 className="text-2xl font-semibold mb-6">Настройки клуба</h1>

      <div className="card">
        <h2 className="font-semibold mb-4">Сезон</h2>
        <p className="text-sm text-stone-500 mb-3">
          Auto — сезон определяется по месяцу (май–сентябрь = summer). Можно зафиксировать вручную.
        </p>
        <div className="flex flex-wrap gap-2">
          {["auto", "summer", "winter"].map((v) => (
            <button
              key={v}
              className={
                "px-4 py-2 rounded-lg border transition " +
                (values["season_mode"] === v
                  ? "bg-brand text-white border-brand"
                  : "bg-white border-stone-300 hover:bg-stone-50")
              }
              onClick={() => {
                setValues({ ...values, season_mode: v });
                save.mutate({ key: "season_mode", value: v });
              }}
              data-testid={`season-${v}`}
            >
              {v === "auto" ? "Авто" : v === "summer" ? "Лето" : "Зима"}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="font-semibold mb-3">Каталог услуг</h2>
        <p className="text-sm text-stone-500 mb-3">
          Синхронизировать каталог с официальным прайсом golfmsk.com/price:
          занятия, абонементы, вводный курс, поле 9/18 лунок, драйвинг-рэндж и аренда оборудования.
          Пользовательские услуги не удаляются.
        </p>
        <button
          className="btn-primary"
          onClick={() => {
            if (confirm("Синхронизировать каталог услуг и абонементов с официальным прайсом?")) {
              resetPrice.mutate();
            }
          }}
          disabled={resetPrice.isPending}
        >
          {resetPrice.isPending ? "…" : "Синхронизировать по прайсу"}
        </button>
      </div>

      <div className="card mt-4">
        <h2 className="font-semibold mb-4">Сырой список настроек</h2>
        <div className="table-shell">
        <table className="min-w-[620px] w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="pb-2 font-medium">Ключ</th>
              <th className="pb-2 font-medium">Значение</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.key} className="border-t border-stone-100">
                <td className="py-2 font-mono text-xs">{s.key}</td>
                <td className="py-2">
                  <input
                    className="input"
                    value={values[s.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                  />
                </td>
                <td className="py-2 text-right">
                  <button
                    className="btn-ghost text-sm"
                    onClick={() => save.mutate({ key: s.key, value: values[s.key] })}
                    disabled={save.isPending}
                  >
                    <Save size={14} /> Сохранить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
