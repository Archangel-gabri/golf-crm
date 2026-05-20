import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function Audit() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");

  const { data } = useQuery({
    queryKey: ["audit", entity, action],
    queryFn: () => api.auditLog(entity || undefined, action || undefined),
  });

  return (
    <div className="page max-w-7xl" data-testid="audit-page">
      <h1 className="text-2xl font-semibold mb-5">Журнал изменений</h1>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input max-w-[220px]">
          <option value="">Все сущности</option>
          <option value="booking">Брони</option>
          <option value="customer">Клиенты</option>
          <option value="user">Сотрудники</option>
          <option value="service">Услуги</option>
          <option value="instructor">Тренеры</option>
          <option value="resource">Ресурсы</option>
          <option value="setting">Настройки</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="input max-w-[220px]">
          <option value="">Все действия</option>
          <option value="create">Создание</option>
          <option value="update">Изменение</option>
          <option value="delete">Удаление</option>
          <option value="login">Вход</option>
          <option value="login_failed">Неудачный вход</option>
          <option value="payment">Оплата</option>
          <option value="cancel">Отмена</option>
        </select>
      </div>

      <div className="card p-0 overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="text-left text-stone-500 bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2 font-medium">Время</th>
              <th className="px-3 py-2 font-medium">Пользователь</th>
              <th className="px-3 py-2 font-medium">Действие</th>
              <th className="px-3 py-2 font-medium">Сущность</th>
              <th className="px-3 py-2 font-medium">Описание</th>
              <th className="px-3 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {!data?.length && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-stone-400">
                  Записей не найдено
                </td>
              </tr>
            )}
            {data?.map((e) => (
              <tr key={e.id} className="border-b border-stone-100" data-testid={`audit-row-${e.id}`}>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {new Date(e.at).toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2">{e.actor_username || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2">
                  <span className="text-xs bg-stone-100 px-2 py-0.5 rounded">
                    {e.entity}
                    {e.entity_id ? ` #${e.entity_id}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2">{e.summary}</td>
                <td className="px-3 py-2 font-mono text-xs text-stone-500">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
