import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useLogin, useMe } from "@/hooks/useAuth";

export default function Login() {
  const { data: user } = useMe();
  const nav = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username, password });
      nav("/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Ошибка входа");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand to-brand-dark p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md"
        data-testid="login-form"
      >
        <div className="text-center mb-6">
          <div className="text-brand font-bold text-3xl tracking-tight">GolfAdmin</div>
          <div className="text-stone-500 mt-1">Крылатское</div>
        </div>

        <label className="label">Логин</label>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          name="username"
          data-testid="username"
          required
        />

        <label className="label mt-4">Пароль</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          name="password"
          data-testid="password"
          required
        />

        {error && (
          <div
            className="mt-4 bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200"
            data-testid="login-error"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full mt-6"
          disabled={login.isPending}
          data-testid="login-submit"
        >
          {login.isPending ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
