import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "./useAuth";

/**
 * Subscribe to /api/sse/events while logged in. Each pushed event invalidates
 * the matching React Query cache key so any open page (Dashboard, Customers,
 * Memberships…) re-fetches the changed slice without F5.
 *
 * Single connection per browser tab — mounted once in the protected layout.
 * The browser auto-reconnects EventSource if the network blips.
 */
export function useRealtime() {
  const qc = useQueryClient();
  const { data: me } = useMe();

  useEffect(() => {
    if (!me) return;

    const url = "/api/sse/events";
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("hello", () => {
      // server greeted us — connection is live
    });

    // Map of event type → list of React Query key prefixes to invalidate.
    // Keys must match what the components actually use (see Dashboard,
    // Bookings, BookingDialog, BookingScenarioDialog, Analytics, Audit…).
    const inval = (keys: string[]) => {
      for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
    };

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        switch (payload.type) {
          case "bookings":
            inval([
              "bookings", "bookings-all", "bookings-day",
              "dash-bookings", "dash-sched",
              "cal-events", "stats",
              "business-analytics", "audit",
            ]);
            break;
          case "customers":
            inval(["customers", "audit", "business-analytics"]);
            break;
          case "memberships":
            inval([
              "memberships", "customer-memberships",
              "customers",
              "business-analytics", "audit",
            ]);
            break;
          case "events":
            inval(["events", "audit"]);
            break;
          default:
            // eslint-disable-next-line no-console
            console.debug("[realtime] unknown event:", payload);
        }
      } catch {
        // malformed event — skip
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects with exponential backoff. Nothing to do.
    };

    return () => {
      es.close();
    };
  }, [me, qc]);
}
