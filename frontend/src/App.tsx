import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import Dashboard from "@/pages/Dashboard";
import TeeSheet from "@/pages/TeeSheet";
import Customers from "@/pages/Customers";
import Catalog from "@/pages/Catalog";
import ServiceEditor from "@/pages/ServiceEditor";
import InstructorEditor from "@/pages/InstructorEditor";
import Instructors from "@/pages/Instructors";
import Coupons from "@/pages/Coupons";
import Bookings from "@/pages/Bookings";
import Trainings from "@/pages/Trainings";
import Analytics from "@/pages/Analytics";
import Audit from "@/pages/Audit";
import Staff from "@/pages/Staff";
import Settings from "@/pages/Settings";
import Memberships from "@/pages/Memberships";
import MembershipSales from "@/pages/MembershipSales";
import MySchedule from "@/pages/MySchedule";
import TrainersSchedule from "@/pages/TrainersSchedule";
import EventsCalendar from "@/pages/EventsCalendar";

function Protected({ children }: { children: JSX.Element }) {
  const { data: user, isLoading } = useMe();
  const loc = useLocation();
  // Open one SSE channel per logged-in tab — auto-invalidates React Query
  // caches when other users mutate bookings / customers / memberships.
  useRealtime();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-stone-500">
        Загрузка…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Force the user to change a default/temporary password before doing anything else.
  if (user.must_change_password && loc.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// Guards: block roles from pages they don't own.
function AdminOrManagerOnly({ children }: { children: JSX.Element }) {
  const { data: user } = useMe();
  if (!user) return null;
  if (user.role === "admin" || user.role === "manager") return children;
  return <Navigate to="/" replace />;
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const { data: user } = useMe();
  if (!user) return null;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function NotInstructor({ children }: { children: JSX.Element }) {
  const { data: user } = useMe();
  if (!user) return null;
  if (user.role === "instructor") return <Navigate to="/" replace />;
  return children;
}

function InstructorOnly({ children }: { children: JSX.Element }) {
  const { data: user } = useMe();
  if (!user) return null;
  if (user.role !== "instructor") return <Navigate to="/" replace />;
  return children;
}

function ManagerOrAbove({ children }: { children: JSX.Element }) {
  const { data: user } = useMe();
  if (!user) return null;
  if (user.role === "admin" || user.role === "manager") return children;
  return <Navigate to="/" replace />;
}

function HomeRoute() {
  return <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/change-password"
        element={
          <Protected>
            <ChangePassword />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="analytics" element={<AdminOrManagerOnly><Analytics /></AdminOrManagerOnly>} />
        <Route path="tee-sheet" element={<NotInstructor><TeeSheet /></NotInstructor>} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="trainings" element={<Trainings />} />
        <Route path="customers" element={<Customers />} />
        <Route path="my-schedule" element={<InstructorOnly><MySchedule /></InstructorOnly>} />
        <Route path="trainers-schedule" element={<NotInstructor><TrainersSchedule /></NotInstructor>} />
        {/* Editor routes — manager+ only */}
        <Route path="catalog" element={<ManagerOrAbove><ServiceEditor /></ManagerOrAbove>} />
        <Route path="instructors" element={<ManagerOrAbove><InstructorEditor /></ManagerOrAbove>} />
        {/* View routes — любой авторизованный */}
        <Route path="catalog-view" element={<Catalog />} />
        <Route path="instructors-view" element={<Instructors />} />
        <Route path="coupons" element={<Coupons />} />
        <Route path="memberships" element={<Memberships />} />
        <Route path="membership-sales" element={<MembershipSales />} />
        <Route path="events" element={<AdminOnly><EventsCalendar /></AdminOnly>} />
        <Route path="staff" element={<AdminOnly><Staff /></AdminOnly>} />
        <Route path="audit" element={<AdminOnly><Audit /></AdminOnly>} />
        <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
