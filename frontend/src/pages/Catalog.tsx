import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatRub } from "@/lib/utils";

const CATEGORIES: Record<string, string> = {
  driving_range: "Драйвинг-рэндж",
  academic_holes: "Академические лунки",
  course_play: "Поле 9/18 лунок",
  lesson_trial: "Пробные тренировки",
  lesson: "Тренировки",
  lesson_kids: "Детские тренировки",
  intro_course: "Вводный курс",
  rental: "Аренда оборудования",
};

const CATEGORY_ORDER = [
  "driving_range",
  "academic_holes",
  "course_play",
  "lesson_trial",
  "lesson",
  "lesson_kids",
  "intro_course",
  "rental",
];

const TRAINING_CATEGORIES = new Set(["lesson_trial", "lesson", "lesson_kids"]);

function serviceSort(a: NonNullable<Awaited<ReturnType<typeof api.services>>>[number], b: NonNullable<Awaited<ReturnType<typeof api.services>>>[number]) {
  if (TRAINING_CATEGORIES.has(a.category) && TRAINING_CATEGORIES.has(b.category)) {
    const groupA = a.group_size ?? 99;
    const groupB = b.group_size ?? 99;
    if (groupA !== groupB) return groupA - groupB;
  }
  return a.name.localeCompare(b.name, "ru");
}

export default function Catalog() {
  const { data } = useQuery({ queryKey: ["services"], queryFn: api.services });

  const grouped = (data || []).reduce<Record<string, typeof data>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {} as any);

  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="page max-w-7xl" data-testid="catalog-page">
      <h1 className="page-title mb-6">Каталог услуг</h1>
      <div className="space-y-6">
        {orderedCats.map((cat) => (
          <div key={cat} className="card">
            <h2 className="font-semibold mb-3 text-stone-800 text-lg">{CATEGORIES[cat] ?? cat}</h2>
            <div className="table-shell">
            <table className="min-w-[720px] w-full text-base">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="pb-2 font-medium">Название</th>
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 font-medium">Длительность</th>
                  <th className="pb-2 font-medium">Гр.</th>
                  <th className="pb-2 font-medium text-right">Цена</th>
                </tr>
              </thead>
              <tbody>
                {[...grouped[cat]!].sort(serviceSort).map((s) => (
                  <tr key={s.id} className="border-t border-stone-100">
                    <td className="py-2 font-medium">{s.name}</td>
                    <td className="text-stone-500 font-mono text-sm">{s.sku}</td>
                    <td>{s.duration_min} мин</td>
                    <td>{s.group_size ?? "—"}</td>
                    <td className="text-right font-semibold">{formatRub(s.base_price_kopecks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
