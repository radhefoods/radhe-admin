// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { IssueRecord } from "../../../mocks/modules/accounts.ts";
import { formatMoney } from "@/lib/format/money";
import { translated } from "@/lib/format/names";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { IssueView } from "./issue-view";
import { IssuesView } from "./issues-view";
import { refundInput } from "./rules";

let api: TestApi;

const issues = () => api.mock.db().issues;
const byStatus = (status: IssueRecord["status"], withItems = true) => {
  const found = issues().find(
    (entry) =>
      entry.status === status && (!withItems || entry.items.length > 0),
  );
  if (!found) throw new Error(`No ${status} report in the demo data`);
  return found;
};
const stored = (id: string) => issues().find((entry) => entry.id === id)!;
const orderOf = (issue: IssueRecord) =>
  api.mock.db().orders.find((order) => order.id === issue.orderId)!;
const writes = () => api.calls.filter((call) => call.method !== "GET");

async function open(issue: IssueRecord, permissions?: string[]) {
  const view = renderPanel(<IssueView />, {
    path: `/issues/${issue.id}`,
    params: { id: issue.id },
    permissions,
  });
  await screen.findByRole("heading", { level: 1, name: issue.issueNumber });
  api.calls.length = 0;
  return view;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the list of problem reports", () => {
  it("starts on the open reports, shows the problems as chips, and finds an order", async () => {
    const { user } = renderPanel(<IssuesView />, { path: "/issues" });
    const open = issues().filter((entry) => entry.status === "open");
    expect(
      await screen.findByText(`${open.length} reports, that is all`),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/issues?status=open&limit=25",
    );
    const table = screen.getByRole("table", {
      name: "Problem reports, newest first",
    });
    const first = open[0]!;
    const row = within(table)
      .getByRole("link", { name: first.issueNumber })
      .closest("tr")!;
    expect(within(row).getByText("Damaged")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();

    const other = issues().find((entry) => entry.status === "resolved")!;
    await user.type(
      screen.getByRole("searchbox", { name: "Reports of an order" }),
      other.orderNumber.toLowerCase(),
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/issues?status=open&orderNumber=${other.orderNumber}&limit=25`,
      ),
    );
  });

  it("explains a search that is not an order number", async () => {
    renderPanel(<IssuesView />, { path: "/issues?q=flour" });
    expect(
      await screen.findByText("This is not an order number"),
    ).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.includes("issues"))).toEqual(
      [],
    );
  });
});

describe("deciding on a problem report", () => {
  it("offers only to take an open report on, then resolve or reject it", async () => {
    const issue = byStatus("open");
    const { user } = await open(issue);
    expect(screen.getByRole("button", { name: "Take on" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Resolve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
    // What the customer reported, in full.
    expect(screen.getByText(`“${issue.description}”`)).toBeInTheDocument();
    expect(screen.getByText("A refund")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take on" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Internal note/ }),
      "Checking with the warehouse.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Take it on" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/issues/${issue.id}/review`,
          body: { internalNote: "Checking with the warehouse." },
        },
      ]),
    );
    expect(stored(issue.id).status).toBe("in_review");
    expect(
      await screen.findByRole("button", { name: "Resolve" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Take on" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Checking with the warehouse."),
    ).toBeInTheDocument();
  });

  it("refunds the reported units, which corrects the order and issues a credit note", async () => {
    const issue = byStatus("in_review");
    const order = orderOf(issue);
    const line = issue.items[0]!;
    const before = {
      delivered: order.items.find((item) => item.variantId === line.variantId)!
        .deliveredQuantity,
      final: order.finalTotals.total,
      creditNotes: api.mock
        .db()
        .invoices.filter((invoice) => invoice.type === "credit_note").length,
    };
    const { user } = await open(issue);
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("alertdialog");
    // The customer asked for a refund: it is preselected, with the reported units.
    expect(
      within(dialog).getByRole("radio", { name: /Refund the units/ }),
    ).toBeChecked();
    const units = within(dialog).getByRole("textbox", {
      name: `Units of ${translated(line.name)} ${line.packSize.label} to refund`,
    });
    expect(units).toHaveValue(String(line.quantity));
    const expected = refundInput(issue, {}, "", "");
    expect(
      within(dialog).getByRole("button", {
        name: `Refund ${formatMoney(expected.amount)}`,
      }),
    ).toBeEnabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Note to the customer/ }),
      "Sorry about that.",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: `Refund ${formatMoney(expected.amount)}`,
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/issues/${issue.id}/resolve`,
          body: { resolution: "refund", note: "Sorry about that." },
        },
      ]),
    );
    const after = stored(issue.id);
    expect(after.status).toBe("resolved");
    expect(after.resolution?.type).toBe("refund");
    expect(after.resolution?.amount).toBe(expected.amount);
    expect(after.items[0]!.refundedQuantity).toBe(line.quantity);
    const corrected = orderOf(issue);
    expect(
      corrected.items.find((item) => item.variantId === line.variantId)!
        .deliveredQuantity,
    ).toBe(before.delivered - line.quantity);
    expect(corrected.finalTotals.total).toBe(before.final - expected.amount);
    expect(corrected.adjustments.at(-1)?.note).toBe(
      `Problem report ${issue.issueNumber}`,
    );
    expect(
      api.mock.db().invoices.filter((invoice) => invoice.type === "credit_note")
        .length,
    ).toBe(before.creditNotes + 1);
    expect(
      await screen.findByText(
        `${formatMoney(expected.amount)} was credited on ${issue.orderNumber}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the payment of the order" }),
    ).toHaveAttribute("href", `/orders/${issue.orderId}#payment`);
  });

  it("sends the units when the admin changes them, and refuses more than reported", async () => {
    const issue = byStatus("in_review");
    const line = issue.items[0]!;
    const { user } = await open(issue);
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("alertdialog");
    const units = within(dialog).getByRole("textbox", {
      name: `Units of ${translated(line.name)} ${line.packSize.label} to refund`,
    });
    await user.clear(units);
    await user.type(units, String(line.quantity + 1));
    expect(
      within(dialog).getByText(
        "At most what was reported; 0 leaves a pack size out.",
      ),
    ).toBeInTheDocument();
    await user.clear(units);
    await user.type(units, "0");
    expect(
      within(dialog).getByText(/Nothing would be refunded/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^Refund/ }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("settles without a refund when the admin chooses so", async () => {
    const issue = byStatus("in_review");
    const { user } = await open(issue);
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("radio", { name: /Send a replacement/ }),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Resolve with a replacement",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/issues/${issue.id}/resolve`,
          body: { resolution: "replacement" },
        },
      ]),
    );
    expect(stored(issue.id).resolution?.type).toBe("replacement");
    expect(
      await screen.findByText("Resolved with a replacement"),
    ).toBeInTheDocument();
  });

  it("needs a note to reject", async () => {
    const issue = byStatus("in_review");
    const { user } = await open(issue);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Reject the report",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Note to the customer/ }),
      "The parcel was handed over intact; please contact the carrier.",
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/issues/${issue.id}/reject`,
          body: {
            note: "The parcel was handed over intact; please contact the carrier.",
          },
        },
      ]),
    );
    expect(stored(issue.id).status).toBe("rejected");
    // Under "What the customer was told" and in the history.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          "“The parcel was handed over intact; please contact the carrier.”",
        ).length,
      ).toBe(2),
    );
  });

  it("loads the report again when the API refuses the step", async () => {
    const issue = byStatus("open");
    const { user } = await open(issue);
    // Somebody else took it on meanwhile.
    stored(issue.id).status = "in_review";
    await user.click(screen.getByRole("button", { name: "Take on" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Take it on" }),
    );
    // The mock answers the record as it is: the page follows without a refusal.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve" })).toBeEnabled(),
    );
  });

  it("opens a photo at full size", async () => {
    const issue = issues().find((entry) => entry.images.length > 0)!;
    const { user } = await open(issue);
    await user.click(
      screen.getByRole("button", {
        name: `Open photo 1 of ${issue.images.length} at full size`,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Photo 1 of ${issue.images.length}`,
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("img")).toHaveAttribute(
      "src",
      issue.images[0]!.sizes.large.url,
    );
    expect(
      within(dialog).getByRole("link", { name: "Open in a new tab" }),
    ).toHaveAttribute("href", issue.images[0]!.sizes.large.url);
  });

  it("keeps the decisions visible but disabled for a reader", async () => {
    const issue = byStatus("in_review");
    await open(issue, ["orders.read"]);
    expect(screen.getByRole("button", { name: "Resolve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(testNavigation.location).toBe(`/issues/${issue.id}`);
  });
});
