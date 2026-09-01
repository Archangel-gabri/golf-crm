import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Bookmark, User, UserCog, Tag } from "lucide-react";
import { api, type SearchHit } from "@/lib/api";

const ICONS: Record<string, any> = {
  booking: Bookmark,
  customer: User,
  instructor: UserCog,
  service: Tag,
};

const ROUTES: Record<string, (id: number) => string> = {
  booking: () => "/bookings",
  customer: () => "/customers",
  instructor: () => "/instructors",
  service: () => "/catalog",
};

export default function CommandPalette() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(q.trim()).then(setHits).catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setCursor(0);
  }, [hits]);

  if (!open) return null;

  function pick(h: SearchHit) {
    setOpen(false);
    setQ("");
    nav(ROUTES[h.kind]?.(h.id) || "/");
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-start justify-center p-3 pt-16 sm:p-4 sm:pt-24"
      onClick={() => setOpen(false)}
      data-testid="cmdk-overlay"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="cmdk-palette"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200">
          <Search size={18} className="text-stone-400" />
          <input
            autoFocus
            placeholder="Поиск по броням (по id), клиентам, тренерам, услугам…"
            className="min-w-0 flex-1 outline-none bg-transparent text-base"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter" && hits[cursor]) {
                pick(hits[cursor]);
              }
            }}
            data-testid="cmdk-input"
          />
          <kbd className="hidden text-xs text-stone-400 border border-stone-200 rounded px-1.5 py-0.5 sm:inline">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-auto py-2">
          {!hits.length && q.length >= 2 && (
            <div className="text-center text-stone-400 py-8 text-sm">Ничего не найдено</div>
          )}
          {!q && (
            <div className="text-center text-stone-400 py-8 text-sm">
              Начните вводить (минимум 2 символа)
            </div>
          )}
          {hits.map((h, i) => {
            const Icon = ICONS[h.kind];
            return (
              <button
                key={`${h.kind}-${h.id}`}
                onClick={() => pick(h)}
                className={
                  "w-full flex items-center gap-3 px-4 py-2 text-left " +
                  (i === cursor ? "bg-brand/10" : "hover:bg-stone-50")
                }
                data-testid={`cmdk-hit-${i}`}
              >
                <Icon size={16} className="text-stone-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{h.title}</div>
                  <div className="text-xs text-stone-500 truncate">{h.subtitle}</div>
                </div>
                <span className="text-xs text-stone-400">{h.kind}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
