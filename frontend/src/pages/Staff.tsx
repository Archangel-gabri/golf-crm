import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Instructor, type Staff as StaffType } from "@/lib/api";
import { Plus, X, Shield, Trash2 } from "lucide-react";

type RoleChoiceValue = "admin" | "staff" | "instructor_club" | "instructor_external";

const ROLE_CHOICES: Array<{
  value: RoleChoiceValue;
  label: string;
  role: string;
  trainerType?: Instructor["trainer_type"];
}> = [
  { value: "admin", label: "Руководитель", role: "admin" },
  { value: "staff", label: "Ресепшен / сотрудник", role: "staff" },
  { value: "instructor_club", label: "Инструктор клуба", role: "instructor", trainerType: "club" },
  { value: "instructor_external", label: "Другой инструктор", role: "instructor", trainerType: "external" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Руководитель",
  staff: "Ресепшен / сотрудник",
  instructor: "Инструктор",
  manager: "Менеджер",
  accounting: "Касса",
};

function staffRoleLabel(user: StaffType, instructor?: Instructor) {
  if (user.role === "instructor") {
    if (!instructor) return "Инструктор (без карточки)";
    return instructor.trainer_type === "external" ? "Другой инструктор" : "Инструктор клуба";
  }
  return ROLE_LABELS[user.role] || user.role;
}

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

export default function Staff() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["staff"], queryFn: api.staff });
  const { data: instructors = [] } = useQuery({ queryKey: ["instructors"], queryFn: api.instructors });
  const [creating, setCreating] = useState(false);
  const [roleChoice, setRoleChoice] = useState<RoleChoiceValue>("staff");

  const instructorById = useMemo(
    () => new Map(instructors.map((i) => [i.id, i])),
    [instructors],
  );
  const selectedRole = ROLE_CHOICES.find((r) => r.value === roleChoice) || ROLE_CHOICES[1];
  const instructorOptions = useMemo(() => {
    if (!selectedRole.trainerType) return [];
    return instructors
      .filter((i) => i.active && i.trainer_type === selectedRole.trainerType)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [instructors, selectedRole.trainerType]);

  const create = useMutation({
    mutationFn: (body: any) => api.createStaff(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setRoleChoice("staff");
      setCreating(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteStaff(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api.updateStaff(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  const closeCreate = () => {
    setCreating(false);
    setRoleChoice("staff");
    create.reset();
  };

  return (
    <div className="page max-w-6xl" data-testid="staff-page">
      <div className="page-head mb-5">
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <button
          className="btn-primary"
          onClick={() => {
            create.reset();
            setRoleChoice("staff");
            setCreating(true);
          }}
          data-testid="new-staff-btn"
        >
          <Plus size={16} /> Добавить
        </button>
      </div>

      <div className="card p-0 overflow-auto">
        <table className="min-w-[860px] w-full text-sm">
          <thead className="text-left text-stone-500 bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2 font-medium">Логин</th>
              <th className="px-3 py-2 font-medium">ФИО</th>
              <th className="px-3 py-2 font-medium">Роль</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Последний вход</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-b border-stone-100" data-testid={`staff-${u.id}`}>
                <td className="px-3 py-2 font-mono">{u.username}</td>
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">
                  <span className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded border border-brand/20">
                    <Shield size={10} className="inline mr-1" />
                    {staffRoleLabel(u, u.instructor_id ? instructorById.get(u.instructor_id) : undefined)}
                  </span>
                  {u.role === "instructor" && (
                    <div className="text-xs text-stone-500 mt-1">
                      {u.instructor_id ? instructorById.get(u.instructor_id)?.name || "Карточка тренера не найдена" : "Карточка тренера не выбрана"}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-stone-600">{u.email || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-stone-500">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString("ru-RU") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <label className="inline-flex items-center gap-1 mr-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={u.active}
                      onChange={(e) => toggleActive.mutate({ id: u.id, active: e.target.checked })}
                    />
                    <span className="text-xs text-stone-600">активен</span>
                  </label>
                  <button
                    className="text-red-600 hover:text-red-800"
                    onClick={() => {
                      if (confirm(`Удалить сотрудника ${u.username}?`)) del.mutate(u.id);
                    }}
                    data-testid={`delete-staff-${u.id}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="modal-overlay" onClick={closeCreate}>
          <form
            className="modal-panel max-w-md p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            data-testid="new-staff-modal"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target as HTMLFormElement);
              create.mutate({
                username: formString(fd, "username"),
                name: formString(fd, "name"),
                email: formString(fd, "email"),
                role: selectedRole.role,
                instructor_id: selectedRole.role === "instructor" ? Number(fd.get("instructor_id")) : null,
                password: formString(fd, "password"),
              });
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Новый сотрудник</h2>
              <button type="button" onClick={closeCreate}>
                <X size={20} />
              </button>
            </div>
            <label className="label">Логин *</label>
            <input name="username" className="input" required autoFocus />
            <label className="label mt-3">ФИО *</label>
            <input name="name" className="input" required />
            <label className="label mt-3">Email</label>
            <input name="email" type="email" className="input" />
            <label className="label mt-3">Роль *</label>
            <select
              name="role_choice"
              className="input"
              value={roleChoice}
              onChange={(e) => setRoleChoice(e.target.value as RoleChoiceValue)}
              required
            >
              {ROLE_CHOICES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {selectedRole.role === "instructor" && (
              <div className="mt-3">
                <label className="label">Карточка тренера *</label>
                <select key={roleChoice} name="instructor_id" className="input" required defaultValue="">
                  <option value="" disabled>Выберите тренера</option>
                  {instructorOptions.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
                <p className="text-xs text-stone-500 mt-1">
                  Если нужного имени нет, сначала добавьте его во вкладке «Тренеры».
                </p>
              </div>
            )}
            <label className="label mt-3">Пароль *</label>
            <input name="password" type="password" className="input" required minLength={4} />

            {create.isError && (
              <div className="mt-3 bg-red-50 text-red-700 text-sm p-2 rounded border border-red-200">
                {(create.error as any)?.message || "Ошибка"}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" className="btn-ghost flex-1" onClick={closeCreate}>Отмена</button>
              <button
                className="btn-primary flex-1"
                disabled={create.isPending || (selectedRole.role === "instructor" && instructorOptions.length === 0)}
                data-testid="submit-staff"
              >
                {create.isPending ? "…" : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
