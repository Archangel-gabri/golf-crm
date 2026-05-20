import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

function trainerTypeLabel(type?: string) {
  return type === "external" ? "Другой тренер" : "Клубный тренер";
}

export default function Instructors() {
  const { data } = useQuery({ queryKey: ["instructors"], queryFn: api.instructors });
  const groups = useMemo(() => {
    const list = data || [];
    return [
      { key: "club", label: "Клубные тренеры", items: list.filter((i) => i.trainer_type !== "external") },
      { key: "external", label: "Другие тренеры", items: list.filter((i) => i.trainer_type === "external") },
    ].filter((g) => g.items.length > 0);
  }, [data]);

  return (
    <div className="page max-w-7xl" data-testid="instructors-page">
      <h1 className="text-2xl font-semibold mb-6">Тренеры</h1>
      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.key}>
            <h2 className="text-lg font-semibold text-stone-800 mb-3">{group.label}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.items.map((i) => (
                <div key={i.id} className="card" data-testid={`instructor-${i.id}`}>
                  <div className="flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
                      style={{ background: i.color }}
                    >
                      {i.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{i.name}</div>
                      <div className="text-xs font-medium text-brand mt-0.5">{trainerTypeLabel(i.trainer_type)}</div>
                      <div className="text-sm text-stone-500">{i.specialization}</div>
                      {i.phone && <div className="text-xs text-stone-400 mt-0.5 font-mono">{i.phone}</div>}
                    </div>
                  </div>
                  {i.bio && <p className="text-sm text-stone-600 mt-3 leading-relaxed">{i.bio}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
