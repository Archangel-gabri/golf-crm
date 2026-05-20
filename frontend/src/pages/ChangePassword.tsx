import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe, useLogout } from "@/hooks/useAuth";

export default function ChangePassword() {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = useLogout();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const forced = user?.must_change_password === true;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("Новый пароль — минимум 8 символов");
    if (next !== confirm) return setError("Новый пароль и подтверждение не совпадают");
    if (next === current) return setError("Новый пароль должен отличаться от текущего");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand to-brand-dark p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md"
        data-testid="change-password-form"
      >
        <div className="text-center mb-6">
          <div className="text-brand font-bold text-2xl tracking-tight">Смена пароля</div>
          {forced && (
            <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg text-sm p-3 mt-3 text-left">
              На вашем аккаунте установлен временный пароль. Чтобы продолжить работу,
              задайте новый — минимум 8 символов, не совпадающий с логином.
            </div>
          )}
          {user && (
            <div className="text-stone-500 mt-2 text-sm">
              {user.name} · {user.username}
            </div>
          )}
        </div>

        <label className="label">Текущий пароль</label>
        <input
          className="input"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoFocus
          required
          data-testid="cp-current"
        />

        <label className="label mt-4">Новый пароль</label>
        <input
          className="input"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={8}
          required
          data-testid="cp-new"
        />

        <label className="label mt-4">Повторите новый пароль</label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
          data-testid="cp-confirm"
        />

        {error && (
          <div
            className="mt-4 bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200"
            data-testid="cp-error"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full mt-6"
          disabled={busy}
          data-testid="cp-submit"
        >
          {busy ? "Сохранение…" : "Сменить пароль"}
        </button>

        {forced && (
          <button
            type="button"
            className="w-full mt-3 text-stone-500 text-sm hover:text-stone-700"
            onClick={() => logout.mutate()}
          >
            Выйти из аккаунта
          </button>
        )}
      </form>
    </div>
  );
}
