import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Tag, GraduationCap, List, LogOut,
  BarChart3, Crown, ShieldCheck, History, Settings as SettingsIcon,
  Search, Ticket, CalendarClock, Menu, X,
} from "lucide-react";
import { useLogout, useMe } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import CommandPalette from "./CommandPalette";

type Entry = { to: string; label: string; icon: any; end?: boolean; adminOnly?: boolean };

// Full nav — filtered by role below.
// "staff" (ресепшен: Ольга, Арби) sees only bookings + catalog.
// "admin" (руководители: Дини + админ-аккаунт) видит всё.
const mainNavFull: Entry[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
  { to: "/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/bookings", label: "Брони", icon: List },
  { to: "/trainers-schedule", label: "График тренеров", icon: CalendarClock },
];

const catalogNav: Entry[] = [
  { to: "/customers", label: "Клиенты", icon: Users },
  { to: "/catalog", label: "Услуги", icon: Tag },
  { to: "/instructors", label: "Тренеры", icon: GraduationCap },
  { to: "/memberships", label: "Абонементы", icon: Crown },
  { to: "/coupons", label: "Промокоды", icon: Ticket },
];

const adminNav: Entry[] = [
  { to: "/staff", label: "Сотрудники", icon: ShieldCheck, adminOnly: true },
  { to: "/audit", label: "Журнал", icon: History, adminOnly: true },
  { to: "/settings", label: "Настройки", icon: SettingsIcon, adminOnly: true },
];

function roleLabel(role?: string) {
  switch (role) {
    case "admin": return "Руководитель";
    case "manager": return "Менеджер";
    case "staff": return "Администратор (ресепшен)";
    case "instructor": return "Тренер";
    case "accounting": return "Касса";
    default: return role || "";
  }
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useMe();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";
  const isStaff = user?.role === "staff";
  const isInstructor = user?.role === "instructor";

  // Основное меню — у тренера Дашборд + Мои брони + Мой график;
  // у ресепшена Дашборд + Брони + График тренеров; у менеджера/админа — всё.
  const mainNav: Entry[] = isInstructor
    ? [
      { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
      { to: "/bookings", label: "Мои брони", icon: List },
      { to: "/my-schedule", label: "Мой график", icon: CalendarClock },
    ]
    : isStaff
      ? [
        { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
        { to: "/bookings", label: "Брони", icon: List },
        { to: "/trainers-schedule", label: "График тренеров", icon: CalendarClock },
      ]
      : mainNavFull;

  // Справочники — тренер теперь может работать с клиентами (как ресепшен).
  // Осталось read-only просмотр каталога, абонементов, промокодов.
  const catalogMenu: Entry[] = isInstructor
    ? [
      { to: "/customers", label: "Клиенты", icon: Users },
      { to: "/catalog-view", label: "Услуги", icon: Tag },
      { to: "/memberships", label: "Абонементы", icon: Crown },
      { to: "/coupons", label: "Промокоды", icon: Ticket },
    ]
    : isStaff
      ? [
        { to: "/customers", label: "Клиенты", icon: Users },
        { to: "/catalog-view", label: "Услуги", icon: Tag },
        { to: "/instructors-view", label: "Тренеры", icon: GraduationCap },
        { to: "/memberships", label: "Абонементы", icon: Crown },
        { to: "/coupons", label: "Промокоды", icon: Ticket },
      ]
      : catalogNav;
  void isManager;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout.mutateAsync();
    navigate("/login", { replace: true });
  };

  const sidebar = (
    <Sidebar
      userName={user?.name}
      userRole={user?.role}
      isAdmin={isAdmin}
      mainNav={mainNav}
      catalogMenu={catalogMenu}
      onLogout={handleLogout}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="min-h-screen lg:flex">
      <div className="hidden lg:flex lg:w-64 lg:shrink-0">
        {sidebar}
      </div>

      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-stone-200 bg-white/95 px-4 shadow-sm backdrop-blur lg:hidden">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 text-stone-700"
          onClick={() => setMobileOpen(true)}
          aria-label="Открыть меню"
        >
          <Menu size={20} />
        </button>
        <div className="text-center leading-tight">
          <div className="font-semibold text-brand">GolfAdmin</div>
          <div className="text-xs text-stone-500">Крылатское</div>
        </div>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 text-stone-700"
          data-testid="open-cmdk-btn-mobile"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
          }}
          aria-label="Поиск"
        >
          <Search size={18} />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[min(88vw,22rem)] shadow-2xl">
            {sidebar}
            <button
              type="button"
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Закрыть меню"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}

function Sidebar({
  userName,
  userRole,
  isAdmin,
  mainNav,
  catalogMenu,
  onLogout,
  onNavigate,
}: {
  userName?: string;
  userRole?: string;
  isAdmin: boolean;
  mainNav: Entry[];
  catalogMenu: Entry[];
  onLogout: () => void;
  onNavigate: () => void;
}) {
  return (
    <aside className="flex h-full min-h-screen w-64 flex-col bg-brand text-white">
      <div className="p-5 border-b border-white/10">
        <div className="text-xl font-bold">GolfAdmin</div>
        <div className="text-sm opacity-80 mt-0.5">Крылатское</div>
      </div>

      <button
        className="mx-3 mt-3 flex items-center gap-2 text-base bg-white/10 hover:bg-white/15 rounded-lg px-3 py-2 text-white/80"
        data-testid="open-cmdk-btn"
        onClick={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
        }}
        title="Поиск"
      >
        <Search size={16} /> Поиск
      </button>

      <nav className="py-3 overflow-y-auto" data-testid="sidebar-nav">
        <Section label="" items={mainNav} onNavigate={onNavigate} />
        <Section label="Справочники" items={catalogMenu} onNavigate={onNavigate} />
        {isAdmin && <Section label="Администрирование" items={adminNav} onNavigate={onNavigate} />}
      </nav>

      <div className="mt-2 p-4 border-t border-white/10 text-base">
        <div className="font-medium" data-testid="current-user">{userName}</div>
        <div className="text-sm opacity-70 mb-3">{roleLabel(userRole)}</div>
        <button
          className="flex items-center gap-2 text-white/80 hover:text-white transition"
          onClick={onLogout}
          data-testid="logout-btn"
        >
          <LogOut size={18} /> Выйти
        </button>
      </div>
    </aside>
  );
}

function Section({ label, items, onNavigate }: { label: string; items: Entry[]; onNavigate: () => void }) {
  return (
    <div className="mt-3">
      {label && (
        <div className="px-5 pb-1.5 text-[10px] uppercase tracking-widest text-white/50 font-semibold">
          {label}
        </div>
      )}
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-5 py-2.5 text-base transition",
              isActive
                ? "bg-white/15 text-white border-l-2 border-brand-gold"
                : "text-white/80 hover:bg-white/10 hover:text-white"
            )
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </div>
  );
}
