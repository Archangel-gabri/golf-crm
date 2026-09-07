import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { authenticate, csrfHeaders } from "./fixtures";

type ObservedSource = {
  id: number;
  withCredentials: boolean;
  opens: number;
  hellos: number;
  customerEvents: number;
  closeCalls: number;
  closed: boolean;
};

type RealtimeProbe = {
  documentId: string;
  sources: ObservedSource[];
};

declare global {
  interface Window {
    __golfRealtimeProbe: RealtimeProbe;
  }
}

test("another authenticated context updates customers through SSE and logout closes the stream", async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(45_000);
  expect(baseURL, "the isolated runner must supply the frontend URL").toBeTruthy();
  const writerContext = await browser.newContext({ baseURL });

  try {
    // Separate browser cookie jars, both populated only by the synthetic runner.
    // Finish writer navigation before observing the reader, so a focus-triggered
    // React Query refetch cannot substitute for a realtime update after mutation.
    const writer = await writerContext.newPage();
    await authenticate(writer);

    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      const observations = new WeakMap<EventSource, ObservedSource>();
      const probe: RealtimeProbe = {
        documentId: crypto.randomUUID(),
        sources: [],
      };
      window.__golfRealtimeProbe = probe;

      // Observe the real browser transport; do not fake messages, replace fetch,
      // or call the application's cache invalidation functions from the test.
      window.EventSource = class extends NativeEventSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          if (new URL(String(url), location.href).pathname !== "/api/sse/events") return;
          const entry: ObservedSource = {
            id: probe.sources.length,
            withCredentials: this.withCredentials,
            opens: 0,
            hellos: 0,
            customerEvents: 0,
            closeCalls: 0,
            closed: false,
          };
          probe.sources.push(entry);
          observations.set(this, entry);
          this.addEventListener("open", () => { entry.opens += 1; });
          this.addEventListener("hello", () => { entry.hellos += 1; });
          this.addEventListener("message", (event) => {
            try {
              if (JSON.parse(event.data).type === "customers") entry.customerEvents += 1;
            } catch {
              // Malformed messages do not count as evidence of a customer event.
            }
          });
        }

        override close() {
          const entry = observations.get(this);
          if (entry) entry.closeCalls += 1;
          super.close();
          if (entry) entry.closed = this.readyState === NativeEventSource.CLOSED;
        }
      };
    });

    await authenticate(page);
    await page.getByRole("link", { name: "Клиенты", exact: true }).click();
    await expect(page.getByTestId("customers-page")).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      window.__golfRealtimeProbe.sources.filter((source) =>
        source.opens > 0 && source.hellos > 0 && source.closeCalls === 0,
      ).length,
    )).toBe(1);

    const unique = `E2E Realtime ${randomUUID()}`;
    const emptySearch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/customers"
        && url.searchParams.get("q") === unique;
    });
    await page.getByTestId("customer-search").fill(unique);
    const initialResponse = await emptySearch;
    expect(initialResponse.status()).toBe(200);
    expect(await initialResponse.json()).toEqual([]);
    await expect(page.getByTestId("customer-list")).toContainText("Клиентов не найдено");

    const before = await page.evaluate(() => window.__golfRealtimeProbe);
    const source = before.sources.find((entry) =>
      entry.opens > 0 && entry.hellos > 0 && entry.closeCalls === 0,
    );
    expect(source, "reader must have a greeted live EventSource").toBeDefined();
    expect(source!.withCredentials).toBe(true);

    const created = await writer.request.post("/api/customers", {
      headers: await csrfHeaders(writer.request),
      data: { name: unique },
    });
    expect(created.status()).toBe(201);
    const customer = await created.json();
    expect(customer.name).toBe(unique);
    expect(customer.id).toBeGreaterThan(0);

    await expect.poll(() => page.evaluate((id) =>
      window.__golfRealtimeProbe.sources[id]?.customerEvents ?? 0,
    source!.id)).toBeGreaterThan(source!.customerEvents);
    // No reader clicks, search changes, navigation, or reload after the mutation.
    await expect(page.getByTestId(`customer-${customer.id}`)).toContainText(unique);
    expect(await page.evaluate(() => window.__golfRealtimeProbe.documentId)).toBe(before.documentId);

    await page.getByTestId("logout-btn").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect.poll(() => page.evaluate((id) =>
      window.__golfRealtimeProbe.sources[id]?.closeCalls ?? 0,
    source!.id)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() =>
      window.__golfRealtimeProbe.sources.filter((entry) => !entry.closed).length,
    )).toBe(0);
    expect(await page.evaluate(() => window.__golfRealtimeProbe.documentId)).toBe(before.documentId);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  } finally {
    await writerContext.close();
  }
});
