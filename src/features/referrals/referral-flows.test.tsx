// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { ReferralsView } from "./referrals-view";

let api: TestApi;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the list of referrals", () => {
  it("names the inviter and the invited person, links the qualifying order and counts", async () => {
    const referrals = api.mock.db().referrals;
    renderPanel(<ReferralsView />, { path: "/referrals" });
    const table = await screen.findByRole("table", {
      name: "Referrals, newest first",
    });
    await waitFor(() =>
      expect(within(table).getAllByRole("row").length).toBe(
        referrals.length + 1,
      ),
    );
    expect(
      await screen.findByText(`${referrals.length} referrals, that is all`),
    ).toBeInTheDocument();

    const qualified = referrals.find((entry) => entry.status === "qualified");
    if (!qualified?.orderId || !qualified.orderNumber)
      throw new Error("No qualified referral in the demo data");
    const row = within(table)
      .getByRole("link", { name: qualified.orderNumber })
      .closest("tr")!;
    expect(
      within(row).getByRole("link", { name: qualified.orderNumber }),
    ).toHaveAttribute("href", `/orders/${qualified.orderId}`);
    const customers = api.mock.db().customers;
    const referrer = customers.find(
      (entry) => entry.id === qualified.referrerId,
    )!;
    expect(
      within(row).getByRole("link", {
        name: `${referrer.firstName} ${referrer.lastName}`,
      }),
    ).toHaveAttribute("href", `/customers/${referrer.id}`);
    expect(within(row).getByText("Qualified")).toBeInTheDocument();
  });

  it("filters by status from the address with the API's parameter", async () => {
    renderPanel(<ReferralsView />, { path: "/referrals?status=void" });
    const voided = api.mock
      .db()
      .referrals.filter((entry) => entry.status === "void");
    expect(
      await screen.findByText(
        `${voided.length} referral${voided.length === 1 ? "" : "s"}, that is all`,
      ),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/referrals?status=void&limit=50",
    );
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/referrals/count?status=void",
    );
    // The reason a referral is void stands under its badge.
    expect(screen.getAllByText("Refunded").length).toBe(voided.length);
    expect(testNavigation.location).toBe("/referrals?status=void");
  });

  it("does not open without customers.read", () => {
    renderPanel(<ReferralsView />, {
      path: "/referrals",
      permissions: ["orders.read"],
    });
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
