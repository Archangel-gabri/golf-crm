export type Role = "admin" | "manager" | "staff" | "instructor" | "accounting";

export type User = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  instructor_id?: number | null;
  must_change_password?: boolean;
};

export type Resource = {
  id: number;
  zone_id: number;
  resource_type_id: number;
  name: string;
  code: string;
  capacity: number;
  sort_order: number;
  season: string;
  color: string;
  active: boolean;
};

export type Zone = {
  id: number;
  name: string;
  code: string;
  sort_order: number;
  active: boolean;
  resources: Resource[];
};

export type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  car_brand: string;
  car_number: string;
  birthdate: string | null;
  notes: string;
  consent_marketing: boolean;
  created_at: string;
  /** server-side aggregate — number of visited / confirmed / completed bookings */
  visits?: number;
  /** server-side aggregate — total money the customer brought in */
  total_spent_kopecks?: number;
  /** short labels of абонементы active right now, e.g. ["30 дней · 5/8"] */
  active_memberships?: string[];
  created_by_name?: string | null;
};

export type CustomerVisit = {
  booking_id: number;
  date: string;
  service_name: string | null;
  instructor_name: string | null;
  resource_name: string | null;
  guests: number;
  total_kopecks: number;
  status: string;
};

export type Coupon = {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  valid_from: string | null;
  valid_to: string | null;
  max_uses: number;
  max_uses_per_user: number;
  used_count: number;
  stackable: boolean;
  conditions: Record<string, any>;
  active: boolean;
};

export type PriceQuote = {
  base_kopecks: number;
  discount_kopecks: number;
  total_kopecks: number;
  coupon_code: string;
  coupon_valid: boolean;
  coupon_error: string;
  instructor_override: boolean;
  notes: string[];
};

export type Service = {
  id: number;
  category: string;
  name: string;
  sku: string;
  duration_min: number;
  tags?: string[];
  base_price_kopecks: number;
  group_size: number | null;
  season: string;
  is_trial: boolean;
  is_kids: boolean;
  requires_instructor: boolean;
  description?: string;
  active: boolean;
};

export type Instructor = {
  id: number;
  name: string;
  trainer_type: "club" | "external";
  specialization: string;
  color: string;
  bio: string;
  phone: string;
  email: string;
  active: boolean;
  tags?: string[];
  hourly_payout_kopecks?: number;
};

export type BookingItem = {
  id: number;
  kind: string;
  name: string;
  quantity: number;
  unit_price_kopecks: number;
  total_kopecks: number;
};

export type Booking = {
  id: number;
  resource_id: number | null;
  service_id: number | null;
  customer_id: number | null;
  instructor_id: number | null;
  starts_at: string;
  ends_at: string;
  guests: number;
  status: string;
  payment_status: string;
  price_kopecks: number;
  discount_kopecks: number;
  total_kopecks: number;
  comment: string;
  customer_name?: string | null;
  service_name?: string | null;
  resource_name?: string | null;
  instructor_name?: string | null;
  items?: BookingItem[];
};

export type BookingCategory =
  | "range"
  | "range_weekday_basket"
  | "range_weekend_hour"
  | "hole_19_20"
  | "course_9"
  | "course_9_weekday"
  | "course_9_weekend"
  | "course_9_mon_tue"
  | "course_18"
  | "course_18_weekday"
  | "course_18_weekend"
  | "course_18_mon_tue";
export type TrainingType = "trial" | "regular" | "kids";

export type ScenarioCategoryOption = {
  code: BookingCategory;
  title: string;
  short: string;
  detail: string;
  base_price_kopecks: number;
  duration_min: number;
  pool_capacity: number;
  basket_unit: boolean;
  basket_unit_label: string;
  per_guest: boolean;
};

export type ScenarioTrainingOption = {
  type: TrainingType;
  label: string;
  prices: Array<{ guests: number; sku: string; price_kopecks: number }>;
};

export type ScenarioCatalog = {
  categories: ScenarioCategoryOption[];
  trainings: ScenarioTrainingOption[];
};

export type ScenarioInput = {
  category: BookingCategory;
  guests: number;
  has_training: boolean;
  training_type?: TrainingType | null;
  trainer_id?: number | null;
  starts_at: string;
  ends_at: string;
  customer_id?: number | null;
  comment?: string;
  exclude_booking_id?: number | null;
  baskets?: number;
  addon_clubs?: number;
  addon_ball_baskets?: number;
  addon_trolleys?: number;
  addon_bags?: number;
  addon_golf_carts?: number;
  coupon_code?: string;
  membership_id?: number | null;
  membership_purchase_id?: number | null;
};

export type ScenarioQuote = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  base_price_kopecks: number;
  equipment_price_kopecks: number;
  equipment_label: string;
  equipment_items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit_price_kopecks: number;
    total_kopecks: number;
  }>;
  training_price_kopecks: number;
  total_kopecks: number;
  category_title: string;
  category_short: string;
  category_detail: string;
  training_label: string;
  trainer_name: string;
  resource_availability: { ok: boolean; message: string };
  trainer_availability: { ok: boolean; message: string };
  base_service_id: number | null;
  training_service_id: number | null;
  resource_id: number | null;
  duration_min: number;
  basket_unit: boolean;
  basket_unit_label: string;
  baskets: number;
  basket_unit_price_kopecks: number;
  subtotal_kopecks: number;
  membership_discount_kopecks: number;
  membership_purchase_price_kopecks: number;
  membership_purchase_label: string;
  membership_training_covered: boolean;
  coupon_discount_kopecks: number;
  discount_kopecks: number;
  coupon_code: string;
  coupon_label: string;
  coupon_error: string;
  membership_label: string;
  per_guest: boolean;
};

export type Slot = {
  resource_id: number;
  starts_at: string;
  ends_at: string;
  state: "free" | "booked" | "blackout";
  booking_id: number | null;
};

export type DashboardStats = {
  bookings_today: number;
  revenue_today_kopecks: number;
  customers_total: number;
  resources_active: number;
  upcoming: Booking[];
};

export type HeatmapCell = { weekday: number; hour: number; count: number };

export type DailyPoint = { day: string; revenue_kopecks: number; bookings: number };
export type DirectionRow = { code: string; label: string; revenue_kopecks: number; bookings: number; guests: number; extra?: string };
export type ZoneLoad = { zone: string; bookings: number; guests: number; hours: number };
export type ResourceLoad = {
  resource_id: number; name: string; zone: string;
  bookings: number; guests: number; hours: number;
};
export type ForecastDay = { day: string; revenue_kopecks: number; weekday: number };
export type WeekdayLoad = { weekday: number; label: string; bookings: number; guests: number };
export type TopCustomer = { customer_id: number; name: string; bookings: number; guests: number; top_zone: string; revenue_kopecks: number };

export type BusinessSummary = {
  revenue_today_kopecks: number;
  revenue_7d_kopecks: number;
  revenue_7d_prev_kopecks: number;
  revenue_30d_kopecks: number;
  bookings_today: number;
  bookings_7d: number;
  guests_7d: number;
  avg_check_7d_kopecks: number;
  top_zone_name: string;
  top_zone_guests: number;
  top_direction_label: string;
  top_direction_revenue_kopecks: number;
  revenue_by_day_30d: DailyPoint[];
  directions_30d: DirectionRow[];
  zone_load_30d: ZoneLoad[];
  resource_load_30d: ResourceLoad[];
  heatmap: HeatmapCell[];
  heatmap_max: number;
  top_weekdays: WeekdayLoad[];
  top_customers: TopCustomer[];
  forecast_next_7d: ForecastDay[];
  forecast_next_7d_total_kopecks: number;
  forecast_next_30d_total_kopecks: number;
  forecast_method: string;
  no_show_week: number;
  cancel_week: number;
  revpatt_kopecks: number;
  clients_count: number;
  resources_count: number;
  subscriptions_sold_7d: number;
  subscriptions_revenue_7d_kopecks: number;
  subscriptions_sold_30d: number;
  subscriptions_revenue_30d_kopecks: number;
  subscriptions_active: number;
  top_subscriptions_30d: Array<{
    plan_id: number;
    plan_name: string;
    count: number;
    revenue_kopecks: number;
  }>;
  total_revenue_today_kopecks: number;
  total_revenue_7d_kopecks: number;
  total_revenue_30d_kopecks: number;
  new_customers_7d: number;
  new_customers_30d: number;
};

export type Staff = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  instructor_id?: number | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type AuditEntry = {
  id: number;
  at: string;
  actor_username: string;
  action: string;
  entity: string;
  entity_id: number | null;
  summary: string;
  before: Record<string, any>;
  after: Record<string, any>;
  ip: string;
};

export type AppSetting = { key: string; value: string };

export type TrainerScheduleDay = { enabled: boolean; start: string; end: string };
export type TrainerScheduleDays = Record<string, TrainerScheduleDay>;
export type TrainerSchedule = {
  instructor_id: number;
  instructor_name: string;
  days: TrainerScheduleDays;
  pending_days?: TrainerScheduleDays | null;
  pending_effective_from?: string | null;
};

export type SearchHit = {
  kind: "booking" | "customer" | "instructor" | "service";
  icon: string;
  title: string;
  subtitle: string;
  id: number;
};

export type CalendarEvent = {
  id: number;
  resource_id: number | null;
  start: string;
  end: string;
  title: string;
  color: string;
  status: string;
  payment_status: string;
  total_kopecks: number;
  customer_name: string | null;
  service_name: string | null;
  instructor_name: string | null;
  guests: number;
};

export type ClubEvent = {
  id: number;
  title: string;
  category: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  description: string;
  capacity: number | null;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_id?: number | null;
};

export type ActiveMembership = {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  plan_id: number;
  plan_name: string;
  purchased_at: string;
  starts_on: string;
  ends_on: string;
  active: boolean;
  trainings_used: number;
  plan_covers_training: boolean;
  plan_max_trainings: number;
  plan_discount_percent: number;
  plan_covers_all_services: boolean;
};

export type MembershipPlan = {
  id: number;
  name: string;
  tier: number;
  price_kopecks: number;
  duration_days: number;
  discount_percent: number;
  priority_booking_days: number;
  description: string;
  covers_training: boolean;
  max_trainings: number;
  covers_all_services: boolean;
  active: boolean;
};

export type CustomerMembership = {
  id: number;
  customer_id: number;
  plan_id: number;
  purchased_at: string;
  starts_on: string;
  ends_on: string;
  active: boolean;
  trainings_used: number;
  plan_name: string;
  plan_tier: number;
  plan_discount_percent: number;
  plan_covers_training: boolean;
  plan_max_trainings: number;
  plan_covers_all_services: boolean;
};

export type MembershipSale = {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  plan_id: number;
  plan_name: string;
  plan_price_kopecks: number;
  plan_covers_training: boolean;
  plan_covers_all_services: boolean;
  plan_max_trainings: number;
  purchased_at: string;
  starts_on: string;
  ends_on: string;
  active: boolean;
  trainings_used: number;
};

export type Specialization = {
  id: number;
  name: string;
  code: string;
  description: string;
  applicable_categories: string[];
  sort_order: number;
  active: boolean;
};

const BASE = "/api";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string {
  const prefix = name + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  // Double-submit CSRF: echo the golf_csrf cookie back as a header on every
  // mutating request so the server can verify it. Cookie is set by the backend
  // CSRF middleware on the first GET response.
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie("golf_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(BASE + path, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const msg =
      (body && (body.detail?.message || body.detail || body.message)) ||
      res.statusText ||
      `HTTP ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // auth
  login: (username: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request<User>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/me/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  // resources
  resources: () => request<Resource[]>("/resources"),
  visibleResources: () => request<Resource[]>("/resources/visible"),
  zones: () => request<Zone[]>("/resources/zones"),
  slots: (resourceId: number, on: string, step = 30) =>
    request<Slot[]>(`/resources/${resourceId}/slots?on=${on}&step_minutes=${step}`),

  // bookings
  bookings: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    return request<Booking[]>(`/bookings${qs.toString() ? "?" + qs : ""}`);
  },
  createBooking: (body: Partial<Booking> & { coupon_code?: string }) =>
    request<Booking>("/bookings", { method: "POST", body: JSON.stringify(body) }),
  scenarioCatalog: () =>
    request<ScenarioCatalog>("/bookings/scenario/catalog"),
  scenarioQuote: (body: ScenarioInput) =>
    request<ScenarioQuote>("/bookings/scenario/quote", { method: "POST", body: JSON.stringify(body) }),
  createScenarioBooking: (body: ScenarioInput) =>
    request<Booking>("/bookings/scenario", { method: "POST", body: JSON.stringify(body) }),
  transition: (id: number, to: string, reason = "") =>
    request<Booking>(`/bookings/${id}/transition?to=${to}&reason=${encodeURIComponent(reason)}`, { method: "POST" }),
  applyMembership: (id: number) =>
    request<Booking>(`/bookings/${id}/apply-membership`, { method: "POST" }),
  patchBooking: (id: number, body: Partial<Booking>) =>
    request<Booking>(`/bookings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  editBooking: (id: number, body: {
    service_id?: number | null; instructor_id?: number | null;
    customer_id?: number | null; resource_id?: number | null;
    starts_at?: string; ends_at?: string; guests?: number;
    comment?: string; coupon_code?: string; manual_price_kopecks?: number;
  }) => request<Booking>(`/bookings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteBooking: (id: number) =>
    request<void>(`/bookings/${id}`, { method: "DELETE" }),
  extendBooking: (id: number, minutes: number) =>
    request<Booking>(`/bookings/${id}/extend`, {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),

  // trainer self-service
  mySchedule: () => request<TrainerSchedule>("/me/schedule"),
  updateMySchedule: (days: TrainerScheduleDays) =>
    request<TrainerSchedule>("/me/schedule", {
      method: "PUT",
      body: JSON.stringify({ days }),
    }),
  instructorSchedule: (id: number) =>
    request<TrainerSchedule>(`/me/schedule/${id}`),
  // Админ/менеджер — мгновенное изменение графика тренера (без 7-дневной задержки).
  adminUpdateInstructorSchedule: (id: number, days: TrainerScheduleDays) =>
    request<TrainerSchedule>(`/me/schedule/${id}`, {
      method: "PUT",
      body: JSON.stringify({ days }),
    }),

  // customers
  customers: (
    q?: string,
    opts?: { created_from?: string; created_to?: string },
  ) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (opts?.created_from) p.set("created_from", opts.created_from);
    if (opts?.created_to) p.set("created_to", opts.created_to);
    const s = p.toString();
    return request<Customer[]>(`/customers${s ? `?${s}` : ""}`);
  },
  getCustomer: (id: number) => request<Customer>(`/customers/${id}`),
  createCustomer: (body: Partial<Customer>) =>
    request<Customer>("/customers", { method: "POST", body: JSON.stringify(body) }),
  updateCustomer: (id: number, body: Partial<Customer>) =>
    request<Customer>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCustomer: (id: number) =>
    request<void>(`/customers/${id}`, { method: "DELETE" }),
  customerVisits: (id: number) =>
    request<CustomerVisit[]>(`/customers/${id}/visits`),

  // catalog
  services: () => request<Service[]>("/catalog/services"),
  instructors: () => request<Instructor[]>("/catalog/instructors"),

  // dashboard / analytics
  stats: () => request<DashboardStats>("/dashboard/stats"),
  businessAnalytics: () => request<BusinessSummary>("/analytics/business"),

  // search
  search: (q: string) => request<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),

  // calendar
  calendarEvents: (start: string, end: string) =>
    request<CalendarEvent[]>(
      `/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    ),
  moveBooking: (id: number, body: { starts_at: string; ends_at: string; resource_id?: number }) =>
    request<{ ok: boolean }>(`/calendar/bookings/${id}/move`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // club events calendar (admin-only)
  events: (params: { from?: string; to?: string; include_inactive?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.include_inactive) qs.set("include_inactive", "true");
    return request<ClubEvent[]>(`/events${qs.toString() ? "?" + qs : ""}`);
  },
  createEvent: (body: Partial<ClubEvent>) =>
    request<ClubEvent>("/events", { method: "POST", body: JSON.stringify(body) }),
  updateEvent: (id: number, body: Partial<ClubEvent>) =>
    request<ClubEvent>(`/events/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteEvent: (id: number) =>
    request<void>(`/events/${id}`, { method: "DELETE" }),

  // admin
  staff: () => request<Staff[]>("/admin/staff"),
  createStaff: (body: {
    username: string;
    name: string;
    email?: string;
    role: string;
    instructor_id?: number | null;
    password: string;
    active?: boolean;
  }) => request<Staff>("/admin/staff", { method: "POST", body: JSON.stringify(body) }),
  updateStaff: (id: number, body: Partial<Staff> & { password?: string }) =>
    request<Staff>(`/admin/staff/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStaff: (id: number) =>
    request<void>(`/admin/staff/${id}`, { method: "DELETE" }),

  auditLog: (entity?: string, action?: string) => {
    const qs = new URLSearchParams();
    if (entity) qs.set("entity", entity);
    if (action) qs.set("action", action);
    return request<AuditEntry[]>(`/admin/audit${qs.toString() ? "?" + qs : ""}`);
  },

  settings: () => request<AppSetting[]>("/admin/settings"),
  updateSetting: (key: string, value: string) =>
    request<AppSetting>(`/admin/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  // memberships
  memberships: () => request<MembershipPlan[]>("/memberships"),
  activeMemberships: () => request<ActiveMembership[]>("/memberships/active"),
  createMembership: (body: Partial<MembershipPlan>) =>
    request<MembershipPlan>("/memberships", { method: "POST", body: JSON.stringify(body) }),
  updateMembership: (id: number, body: Partial<MembershipPlan>) =>
    request<MembershipPlan>(`/memberships/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteMembershipPlan: (id: number) =>
    request<void>(`/memberships/${id}`, { method: "DELETE" }),

  // specializations
  specializations: () => request<Specialization[]>("/specializations"),
  createSpecialization: (body: Partial<Specialization>) =>
    request<Specialization>("/specializations", { method: "POST", body: JSON.stringify(body) }),
  updateSpecialization: (id: number, body: Partial<Specialization>) =>
    request<Specialization>(`/specializations/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  // catalog-admin
  toggleService: (id: number) =>
    request<{ active: boolean }>(`/catalog-admin/services/${id}/toggle`, { method: "POST" }),
  servicePricePreview: (id: number, newPriceKopecks: number) =>
    request<{
      current_price_kopecks: number;
      new_price_kopecks: number;
      future_bookings_count: number;
      total_impact_kopecks: number;
    }>(`/catalog-admin/services/${id}/cascade-preview?new_price_kopecks=${newPriceKopecks}`),
  createService: (body: Partial<Service>) =>
    request<{ id: number }>("/catalog-admin/services", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateService: (id: number, body: Partial<Service>, applyToBookings = false) =>
    request<{ ok: boolean }>(
      `/catalog-admin/services/${id}?apply_to_bookings=${applyToBookings}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  getInstructor: (id: number) =>
    request<Instructor & { specialization_ids: number[]; resource_ids: number[]; service_prices: Record<number, number> }>(
      `/catalog-admin/instructors/${id}`
    ),
  createInstructor: (body: Partial<Instructor>) =>
    request<{ id: number }>("/catalog-admin/instructors", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateInstructor: (id: number, body: Partial<Instructor>) =>
    request<{ ok: boolean }>(`/catalog-admin/instructors/${id}`, {
      method: "PUT", body: JSON.stringify(body),
    }),
  deleteInstructor: (id: number) =>
    request<void>(`/catalog-admin/instructors/${id}`, { method: "DELETE" }),
  setInstructorServicePrice: (id: number, serviceId: number, priceKopecks: number) =>
    request<{ ok: boolean }>(`/catalog-admin/instructors/${id}/service-price`, {
      method: "POST",
      body: JSON.stringify({ service_id: serviceId, price_kopecks: priceKopecks }),
    }),
  instructorCustomers: (id: number) =>
    request<Customer[]>(`/catalog-admin/instructors/${id}/customers`),
  linkInstructorCustomer: (instructorId: number, customerId: number) =>
    request<{ ok: boolean }>(`/catalog-admin/instructors/${instructorId}/customers/${customerId}`, { method: "POST" }),
  unlinkInstructorCustomer: (instructorId: number, customerId: number) =>
    request<{ ok: boolean }>(`/catalog-admin/instructors/${instructorId}/customers/${customerId}`, { method: "DELETE" }),

  // coupons
  coupons: () => request<Coupon[]>("/coupons"),
  createCoupon: (body: Partial<Coupon>) =>
    request<Coupon>("/coupons", { method: "POST", body: JSON.stringify(body) }),
  updateCoupon: (id: number, body: Partial<Coupon>) =>
    request<Coupon>(`/coupons/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCoupon: (id: number) =>
    request<void>(`/coupons/${id}`, { method: "DELETE" }),
  priceQuote: (body: {
    service_id?: number | null;
    instructor_id?: number | null;
    guests?: number;
    duration_min?: number;
    coupon_code?: string;
  }) => request<PriceQuote>("/coupons/quote", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  // tags
  tags: () => request<{ services: string[]; instructors: string[]; all: string[] }>("/tags"),

  // customer memberships
  customerMemberships: (cid: number) =>
    request<CustomerMembership[]>(`/memberships/customer/${cid}`),
  assignMembership: (
    cid: number,
    body: { plan_id: number; starts_on?: string; duration_days_override?: number | null },
  ) =>
    request<CustomerMembership>(`/memberships/customer/${cid}`, {
      method: "POST", body: JSON.stringify(body),
    }),
  revokeMembership: (mid: number) =>
    request<void>(`/memberships/customer-membership/${mid}`, { method: "DELETE" }),
  membershipSales: (params?: { from_?: string; to_?: string; customer_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.from_) qs.set("from_", params.from_);
    if (params?.to_) qs.set("to_", params.to_);
    if (params?.customer_id !== undefined) qs.set("customer_id", String(params.customer_id));
    return request<MembershipSale[]>(`/memberships/sales${qs.toString() ? "?" + qs : ""}`);
  },

  // demo
  seedDemo: (count = 80) =>
    request<{ created: number; attempts: number }>(`/demo/seed?bookings_count=${count}`, {
      method: "POST",
    }),
  wipeDemo: () => request<{ deleted: number }>("/demo/wipe-demo", { method: "POST" }),

  resetServicesFromPrice: () =>
    request<{ total: number; created: number; updated: number; archived: number }>(
      "/catalog-admin/reset-services-from-price",
      { method: "POST" },
    ),

  resourceServicesMap: () => request<Record<string, number[]>>("/resources/services-map"),
};
