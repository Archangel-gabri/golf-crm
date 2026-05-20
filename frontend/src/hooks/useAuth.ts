import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type User } from "@/lib/api";

export function useMe() {
  return useQuery<User | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e: any) {
        if (e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.clear();
    },
  });
}

/** Centralised role → capability matrix. One place to reason about access. */
export function usePerms() {
  const { data: user } = useMe();
  const role = user?.role ?? "guest";
  const isAdmin = role === "admin";
  const isManager = isAdmin || role === "manager";
  const isStaff = role === "staff";
  const isInstructor = role === "instructor";
  return {
    user,
    role,
    isAdmin,
    isManager,
    isStaff,
    isInstructor,
    /** Can create/edit/delete catalog items (services, trainers, memberships, coupons) */
    canEditCatalog: isManager,
    /** Can edit customer records */
    canEditCustomers: isManager || isStaff || isInstructor,
    /** Can see analytics */
    canSeeAnalytics: isManager,
    /** Can edit/delete bookings (beyond status transitions) */
    canEditBookings: isManager || isStaff || isInstructor,
    /** Can create new bookings */
    canCreateBookings: isManager || isStaff || isInstructor,
    /** Can delete bookings — только ресепшен/менеджер/админ. Тренер не может. */
    canDeleteBookings: isManager || isStaff,
    /** Can extend an existing booking by N minutes */
    canExtendBookings: isManager || isStaff || isInstructor,
  };
}
