// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsSummary } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { TodayView } from "@/features/today/today-view";

let api: TestApi;

const analyticsCalls = () =>
  api.calls
    .filter((call) => call.path.startsWith("/v1/admin/analytics/"))
    .map((call) => call.path.replace("/v1/admin/analytics/", ""));

const tile = (label: string) => {
  const heading = screen.getByText(label, { selector: "p" });
  return heading.parentElement as HTMLElement;
};

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the Analytics tab of the start page", () => {
  it("is not there without analytics.read; the Decisions page stays as it was", async () => {
    renderPanel(<TodayView />, {
      path: "/?tab=analytics",
      permissions: ["orders.read"],
    });
    expect(
      await screen.findByRole("heading", { name: "Waiting for you" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Analytics" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    expect(analyticsCalls()).toEqual([]);
  });

  it("opens on this month, loads the six sections in parallel and prints the money from cents", async () => {
    const summary = await api.request<AnalyticsSummary>(
      "GET",
      "/v1/admin/analytics/summary",
    );
    expect(summary.range.preset).toBe("this_month");
    api.calls.length = 0;

    renderPanel(<TodayView />, { path: "/?tab=analytics" });
    expect(
      await screen.findByRole("tab", { name: "Analytics" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(tile("Gross revenue")).toHaveTextContent(
        formatMoney(summary.revenue.gross.value),
      ),
    );
    expect(tile("Paid orders")).toHaveTextContent(
      String(summary.orders.paid.value),
    );
    expect(tile("Net revenue")).toHaveTextContent(
      formatMoney(summary.revenue.net.value),
    );
    for (const name of [
      "Sales",
      "Best sellers and categories",
      "Customers",
      "Payments, refunds and returns",
      "Inventory",
    ]) {
      expect(await screen.findByRole("region", { name })).toBeInTheDocument();
    }
    await waitFor(() =>
      expect(analyticsCalls().sort()).toEqual([
        "customers",
        "inventory",
        "payments",
        "products?sortBy=units",
        "sales",
        "summary",
      ]),
    );
    // The chart carries its numbers for whoever cannot see it.
    const sales = screen.getByRole("region", { name: "Sales" });
    expect(
      within(sales).getByRole("table", { name: /Revenue per day/ }),
    ).toBeInTheDocument();
  });

  it("keeps the period in the address and sends it to every endpoint", async () => {
    const { user } = renderPanel(<TodayView />, { path: "/?tab=analytics" });
    await screen.findByRole("region", { name: "Sales" });
    api.calls.length = 0;

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period" }),
      "last_7_days",
    );
    expect(testNavigation.location).toBe("/?tab=analytics&range=last_7_days");
    await waitFor(() =>
      expect(analyticsCalls().sort()).toEqual([
        "customers?range=last_7_days",
        "inventory?range=last_7_days",
        "payments?range=last_7_days",
        "products?range=last_7_days&sortBy=units",
        "sales?range=last_7_days",
        "summary?range=last_7_days",
      ]),
    );
  });

  it("asks for nothing while a custom range is incomplete, then sends both days", async () => {
    const { user } = renderPanel(<TodayView />, { path: "/?tab=analytics" });
    await screen.findByRole("region", { name: "Sales" });
    api.calls.length = 0;

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period" }),
      "custom",
    );
    expect(
      await screen.findByText("Choose the first and the last day."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Sales" }),
    ).not.toBeInTheDocument();
    expect(analyticsCalls()).toEqual([]);

    fireEvent.change(screen.getByLabelText("First day"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: "2026-08-01" },
    });
    expect(
      await screen.findByText("The first day must not come after the last."),
    ).toBeInTheDocument();
    expect(analyticsCalls()).toEqual([]);

    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: "2026-10-31" },
    });
    expect(
      await screen.findByRole("region", { name: "Sales" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(analyticsCalls()).toContain(
        "summary?range=custom&from=2026-09-01&to=2026-10-31",
      ),
    );
    expect(testNavigation.location).toBe(
      "/?tab=analytics&range=custom&from=2026-09-01&to=2026-10-31",
    );
    // Longer than a month: the buckets can be chosen.
    expect(
      await screen.findByRole("group", { name: "Buckets of the charts" }),
    ).toBeInTheDocument();
  });

  it("sorts the best sellers by revenue on request", async () => {
    const { user } = renderPanel(<TodayView />, { path: "/?tab=analytics" });
    const products = await screen.findByRole("region", {
      name: "Best sellers and categories",
    });
    await within(products).findByRole("list", { name: "Best sellers" });
    api.calls.length = 0;
    await user.click(
      within(products).getByRole("button", { name: "By revenue" }),
    );
    await waitFor(() =>
      expect(analyticsCalls()).toEqual(["products?sortBy=revenue"]),
    );
  });

  it("switches back to Decisions and keeps the attention overview", async () => {
    const { user } = renderPanel(<TodayView />, { path: "/?tab=analytics" });
    await user.click(await screen.findByRole("tab", { name: "Decisions" }));
    expect(testNavigation.location).toBe("/");
    expect(
      await screen.findByRole("heading", { name: "Waiting for you" }),
    ).toBeInTheDocument();
  });
});

describe("the analytics endpoints of the mock", () => {
  it("resolves the presets with their previous period and the default buckets", async () => {
    const thisMonth = await api.request<AnalyticsSummary>(
      "GET",
      "/v1/admin/analytics/summary",
    );
    const { range } = thisMonth;
    expect(range.from.endsWith("-01")).toBe(true);
    expect(range.granularity).toBe("day");
    expect(range.previous.from.endsWith("-01")).toBe(true);
    expect(range.previous.to < range.from).toBe(true);
    expect(thisMonth.orders.averageOrderValue.value).toBe(
      thisMonth.orders.paid.value === 0
        ? 0
        : Math.round(
            thisMonth.revenue.gross.value / thisMonth.orders.paid.value,
          ),
    );
    expect(thisMonth.customers.returning.value).toBe(
      thisMonth.customers.buyers.value - thisMonth.customers.firstTime.value,
    );

    const year = await api.request<AnalyticsSummary>(
      "GET",
      "/v1/admin/analytics/summary?range=custom&from=2026-01-01&to=2026-12-31",
    );
    expect(year.range.days).toBe(365);
    expect(year.range.granularity).toBe("month");
    expect(year.range.previous).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("refuses a custom range without days, backwards or longer than two years", async () => {
    for (const query of [
      "range=custom",
      "range=custom&from=2026-10-10&to=2026-10-01",
      "range=custom&from=2024-01-01&to=2026-12-31",
      "range=custom&from=2026-02-30&to=2026-03-01",
    ]) {
      await expect(
        api.request("GET", `/v1/admin/analytics/summary?${query}`),
      ).rejects.toThrow(/ANALYTICS_RANGE_INVALID/);
    }
    await expect(
      api.request("GET", "/v1/admin/analytics/summary?range=last_year"),
    ).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it("needs analytics.read", async () => {
    await api.signIn("orders");
    await expect(
      api.request("GET", "/v1/admin/analytics/summary"),
    ).rejects.toThrow(/ADMIN_PERMISSION_DENIED/);
  });
});
