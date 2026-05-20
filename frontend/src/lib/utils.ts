import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRub(kopecks: number): string {
  const rub = Math.round(kopecks / 100);
  return `${rub.toLocaleString("ru-RU")} ₽`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

export function statusLabel(s: string): string {
  const m: Record<string, string> = {
    draft: "Черновик",
    confirmed: "Подтверждена",
    checked_in: "Пришёл (check-in)",
    completed: "Завершена",
    cancelled: "Отменена",
    no_show: "Не пришёл",
    paid: "Оплачено",
    pending: "Не оплачено",
    authorized: "Авторизовано",
    refunded: "Возврат",
    partially_refunded: "Частичный возврат",
    failed: "Ошибка",
    canceled: "Отменена",
    requires_action: "Требует действия",
  };
  return m[s] ?? s;
}

export function statusColor(s: string): string {
  const m: Record<string, string> = {
    confirmed: "bg-brand/10 text-brand border-brand/30",
    checked_in: "bg-blue-50 text-blue-700 border-blue-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
    no_show: "bg-orange-50 text-orange-700 border-orange-200",
    draft: "bg-stone-100 text-stone-600 border-stone-300",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-stone-100 text-stone-600 border-stone-300",
  };
  return m[s] ?? "bg-stone-100 text-stone-600 border-stone-300";
}
