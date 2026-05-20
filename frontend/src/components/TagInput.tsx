import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
};

export default function TagInput({ value, onChange, suggestions = [], placeholder }: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(input.toLowerCase())
  ).slice(0, 8);

  function add(t: string) {
    const v = t.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setInput("");
  }

  return (
    <div className="relative" ref={ref}>
      <div className="input flex flex-wrap gap-1.5 min-h-[42px] cursor-text" onClick={() => setOpen(true)}>
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 bg-brand/10 text-brand text-xs px-2 py-1 rounded-full">
            {t}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}
              className="hover:text-red-600"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[100px] outline-none bg-transparent text-sm"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (input.trim()) add(input);
            } else if (e.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length ? "" : (placeholder || "теги (Enter)")}
        />
      </div>
      {open && (filtered.length > 0 || input.trim()) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-auto">
          {input.trim() && !suggestions.includes(input.trim()) && !value.includes(input.trim()) && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-stone-100 text-brand font-medium"
              onClick={() => add(input)}
            >
              + Добавить «{input.trim()}»
            </button>
          )}
          {filtered.map((s) => (
            <button
              type="button"
              key={s}
              className="w-full text-left px-3 py-2 text-sm hover:bg-stone-100"
              onClick={() => add(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
