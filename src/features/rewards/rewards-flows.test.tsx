// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CustomerView } from "@/features/customers/customer-view";
import { OrderView } from "@/features/orders/order-view";
import type { RewardsSettings } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { RewardAccountView } from "./reward-account-view";
import { RewardsView } from "./rewards-view";

let api: TestApi;
const db = () => api.mock.db();
const writes = () => api.calls.filter((call) => call.method !== "GET");
const paths = () => api.calls.map((call) => call.path);

function customerName(customerId: string): string {
  const customer = db().customers.find((entry) => entry.id === customerId);
  if (!customer) throw new Error("The account has no customer");
  return `${customer.firstName} ${customer.lastName}`;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the overview", () => {
  it("shows the accounts and the coins outstanding", async () => {
    renderPanel(<RewardsView />, { path: "/rewards" });
    const accounts = db().rewardAccounts;
    const outstanding = accounts.reduce(
      (sum, account) => sum + account.available,
      0,
    );
    const tile = await screen.findByText("Coins outstanding");
    expect(tile.parentElement).toHaveTextContent(
      outstanding.toLocaleString("en"),
    );
    expect(
      screen.getByText("Accounts", { selector: "p" }).parentElement,
    ).toHaveTextContent(String(accounts.length));
    expect(paths()).toContain("/v1/admin/rewards/summary");
  });
});

describe("the rules", () => {
  it("saves the whole document after one change", async () => {
    const { user } = renderPanel(<RewardsView />, {
      path: "/rewards?tab=settings",
    });
    const field = await screen.findByLabelText("Coins for signing up");
    expect(field).toHaveValue("100");
    await user.clear(field);
    await user.type(field, "150");
    await user.click(screen.getByRole("button", { name: "Save the rules" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [call] = writes();
    expect(call!.method).toBe("PUT");
    expect(call!.path).toBe("/v1/admin/rewards/settings");
    const body = call!.body as RewardsSettings;
    expect(body.enabled).toBe(true);
    expect(body.earning.welcome).toEqual({ enabled: true, coins: 150 });
    expect(body.earning.order.coinsPerEuro).toBe(1);
    expect(body.redemption.percentPerCoin).toBe(0.01);
    expect(body.redemption.maxDiscount).toBe(500);
    expect(body.redemption.minCoins).toBeNull();
    expect(body.earning.campaign.startsAt).toBeNull();
    expect(body.expiry).toEqual({ enabled: false, inactivityMonths: 12 });
    expect(db().rewardsSettings.earning.welcome.coins).toBe(150);
    expect(
      await screen.findByText("Rules of the program saved"),
    ).toBeInTheDocument();
  });

  it("refuses a campaign that ends before it starts, on the end field", async () => {
    const { user } = renderPanel(<RewardsView />, {
      path: "/rewards?tab=settings",
    });
    await user.click(await screen.findByRole("switch", { name: "Campaign" }));
    fireEvent.change(screen.getByLabelText(/^Starts/), {
      target: { value: "2026-12-24T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/^Ends/), {
      target: { value: "2026-12-20T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Save the rules" }));
    expect(
      await screen.findByText("The campaign must end after it starts."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("locks the rules for a reader", async () => {
    renderPanel(<RewardsView />, {
      path: "/rewards?tab=settings",
      permissions: ["rewards.read"],
    });
    expect(await screen.findByLabelText("Coins for signing up")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save the rules" }),
    ).toBeDisabled();
  });
});

describe("the accounts", () => {
  it("lists who has coins and filters by balance", async () => {
    const { user } = renderPanel(<RewardsView />, {
      path: "/rewards?tab=accounts",
    });
    const table = await screen.findByRole("table", {
      name: "Coin accounts, newest first",
    });
    // The first page of the list: newest first, as the API sorts it.
    const account = [...db().rewardAccounts]
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id < b.id
            ? 1
            : -1
          : a.createdAt < b.createdAt
            ? 1
            : -1,
      )
      .slice(0, 50)
      .find((entry) => entry.available > 0);
    if (!account) throw new Error("No account with coins in the demo data");
    const row = (
      await within(table).findByRole("link", {
        name: customerName(account.customerId),
      })
    ).closest("tr")!;
    expect(row).toHaveTextContent(account.available.toLocaleString("en"));

    await user.click(screen.getByRole("button", { name: /^Balance/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "With coins" }),
    );
    await waitFor(() =>
      expect(paths()).toContain(
        "/v1/admin/rewards/accounts?withBalance=true&limit=50",
      ),
    );
    expect(testNavigation.location).toBe(
      "/rewards?tab=accounts&withBalance=true",
    );
  });

  it("adjusts the coins by hand with a reason and a note", async () => {
    const account = db().rewardAccounts.find((entry) => entry.available >= 50);
    if (!account) throw new Error("No account with 50 coins in the demo data");
    const before = account.balance;
    const name = customerName(account.customerId);
    const { user } = renderPanel(<RewardAccountView />, {
      path: `/rewards/accounts/${account.customerId}`,
      params: { customerId: account.customerId },
    });
    await screen.findByRole("heading", { level: 1, name: `Coins of ${name}` });
    await user.click(screen.getByRole("button", { name: "Adjust coins" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("radio", { name: /Take coins away/ }),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /^Coins/ }),
      "20",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: /^Reason/ }),
      "misuse",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /^Note/ }),
      "Two accounts for one person.",
    );
    expect(dialog).toHaveTextContent(
      `${(before - 20).toLocaleString("en")} coins`,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Take 20 coins away" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/rewards/accounts/${account.customerId}/adjust`,
          body: {
            coins: -20,
            reason: "misuse",
            note: "Two accounts for one person.",
          },
        },
      ]),
    );
    const stored = db().rewardAccounts.find(
      (entry) => entry.customerId === account.customerId,
    );
    expect(stored?.balance).toBe(before - 20);
    await waitFor(() =>
      expect(screen.getAllByText("Adjusted by hand").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("−20").length).toBeGreaterThan(0);
  });

  it("keeps the adjustment away from a reader", async () => {
    const account = db().rewardAccounts[0];
    if (!account) throw new Error("No account in the demo data");
    renderPanel(<RewardAccountView />, {
      path: `/rewards/accounts/${account.customerId}`,
      params: { customerId: account.customerId },
      permissions: ["rewards.read", "customers.read"],
    });
    await screen.findByRole("heading", { level: 1, name: /^Coins of / });
    expect(screen.getByRole("button", { name: "Adjust coins" })).toBeDisabled();
  });
});

describe("the ledger", () => {
  it("filters by type with the API's parameter and counts the rows", async () => {
    const { user } = renderPanel(<RewardsView />, {
      path: "/rewards?tab=ledger",
    });
    await screen.findByRole("table", { name: "Coin ledger, newest first" });
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Redeemed" }));
    await waitFor(() =>
      expect(paths()).toContain(
        "/v1/admin/rewards/transactions?type=redeem&limit=50",
      ),
    );
    const redeemed = db().rewardTransactions.filter(
      (row) => row.type === "redeem",
    );
    expect(redeemed.length).toBeGreaterThan(0);
    expect(
      await screen.findByText(
        `${redeemed.length} ${redeemed.length === 1 ? "movement" : "movements"}, that is all`,
      ),
    ).toBeInTheDocument();
    expect(testNavigation.location).toBe("/rewards?tab=ledger&type=redeem");
  });

  it("finds the movements of an order by its number", async () => {
    const row = db().rewardTransactions.find((entry) => entry.orderNumber);
    if (!row?.orderNumber) throw new Error("No movement of an order");
    renderPanel(<RewardsView />, {
      path: `/rewards?tab=ledger&orderNumber=${row.orderNumber.slice(3)}`,
    });
    await waitFor(() =>
      expect(paths()).toContain(
        `/v1/admin/rewards/transactions?orderNumber=${row.orderNumber}&limit=50`,
      ),
    );
    const table = await screen.findByRole("table", {
      name: "Coin ledger, newest first",
    });
    expect(
      (await within(table).findAllByRole("link", { name: row.orderNumber }))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("the customer page", () => {
  it("has a Coins tab with the account and its history", async () => {
    const account = db().rewardAccounts.find((entry) => entry.available > 0);
    if (!account) throw new Error("No account with coins in the demo data");
    const name = customerName(account.customerId);
    const { user } = renderPanel(<CustomerView />, {
      path: `/customers/${account.customerId}`,
      params: { id: account.customerId },
    });
    await screen.findByRole("heading", { level: 1, name });
    await user.click(screen.getByRole("tab", { name: "Coins" }));
    await waitFor(() =>
      expect(paths()).toContain(
        `/v1/admin/rewards/accounts/${account.customerId}`,
      ),
    );
    expect(
      (await screen.findByText("Available")).parentElement,
    ).toHaveTextContent(account.available.toLocaleString("en"));
    expect(
      screen.getByRole("table", { name: `Coin movements of ${name}` }),
    ).toBeInTheDocument();
    expect(testNavigation.location).toBe(
      `/customers/${account.customerId}?tab=coins`,
    );
  });

  it("hides the Coins tab from an admin who may not read coins", async () => {
    const account = db().rewardAccounts[0];
    if (!account) throw new Error("No account in the demo data");
    renderPanel(<CustomerView />, {
      path: `/customers/${account.customerId}`,
      params: { id: account.customerId },
      permissions: ["customers.read", "orders.read"],
    });
    await screen.findByRole("heading", {
      level: 1,
      name: customerName(account.customerId),
    });
    expect(screen.getByRole("tab", { name: "Referrals" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Coins" }),
    ).not.toBeInTheDocument();
  });
});

describe("the order page", () => {
  it("shows the coins redeemed with their state, per line and in the totals", async () => {
    const order = db().orders.find(
      (entry) =>
        entry.rewards?.state === "used" &&
        entry.finalTotals.total === entry.totals.total,
    );
    if (!order?.rewards) throw new Error("No paid order with coins");
    renderPanel(<OrderView />, { params: { id: order.id } });
    await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(order.orderNumber),
    });
    const block = screen.getByRole("region", { name: "Coins redeemed" });
    expect(block).toHaveTextContent(String(order.rewards.coins));
    expect(block).toHaveTextContent(formatMoney(-order.rewards.amount));
    expect(within(block).getByText("Spent")).toBeInTheDocument();

    const bill = screen.getByLabelText("Total");
    expect(bill).toHaveTextContent("Coins redeemed");
    expect(bill).toHaveTextContent(formatMoney(-order.totals.rewards));

    const line = order.items.find((item) => (item.rewardAmount ?? 0) > 0);
    if (!line?.rewardAmount) throw new Error("No line with a coin share");
    const items = within(
      screen.getByRole("table", { name: `Items of ${order.orderNumber}` }),
    );
    expect(items.getByText(line.sku).closest("tr")).toHaveTextContent(
      `${formatMoney(-line.rewardAmount)} coins`,
    );
  });

  it("says nothing about coins on an order without any", async () => {
    const order = db().orders.find(
      (entry) =>
        !entry.rewards &&
        entry.status === "delivered" &&
        entry.finalTotals.total === entry.totals.total,
    );
    if (!order) throw new Error("No delivered order without coins");
    renderPanel(<OrderView />, { params: { id: order.id } });
    await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(order.orderNumber),
    });
    expect(
      screen.queryByRole("region", { name: "Coins redeemed" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total")).not.toHaveTextContent(
      "Coins redeemed",
    );
  });
});
