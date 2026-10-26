// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PageResult,
  QuotationStatus,
  QuotationSummary,
  QuotationWithEmails,
} from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { TodayView } from "@/features/today/today-view";
import { QuotationView } from "./quotation-view";
import { QuotationsView } from "./quotations-view";

let api: TestApi;
let quotations: QuotationSummary[];

const writes = () => api.calls.filter((call) => call.method !== "GET");
const byStatus = (status: QuotationStatus) => {
  const found = quotations.find((entry) => entry.status === status);
  if (!found) throw new Error(`No ${status} quotation in the demo data`);
  return found;
};
const detailOf = (id: string) =>
  api.request<QuotationWithEmails>("GET", `/v1/admin/quotations/${id}`);

function renderQuotation(id: string, permissions?: string[]) {
  return renderPanel(<QuotationView />, {
    path: `/quotations/${id}`,
    params: { id },
    permissions,
  });
}

/** The row of a line, by the product and its pack size. */
const lineName = (item: { name: string; packSize: { label: string } }) =>
  `${item.name} ${item.packSize.label}`;
const lineRow = (item: { name: string; packSize: { label: string } }) =>
  screen.getByRole("row", { name: lineName(item) }) as HTMLTableRowElement;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  quotations = (
    await api.request<PageResult<QuotationSummary>>(
      "GET",
      "/v1/admin/quotations?limit=100",
    )
  ).items;
  api.calls.length = 0;
});

describe("the list of quotations", () => {
  it("shows every request with its status and total, and filters through the API", async () => {
    const { user } = renderPanel(<QuotationsView />, { path: "/quotations" });
    const table = await screen.findByRole("table", {
      name: "Wholesale quotations",
    });
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(
        quotations.length + 1,
      ),
    );
    const row = (number: string) =>
      within(table).getByRole("link", { name: number }).closest("tr")!;
    const draft = byStatus("draft");
    expect(row(draft.number)).toHaveTextContent("Draft");
    expect(row(draft.number)).toHaveTextContent("Not priced");
    expect(row(draft.number)).toHaveTextContent("2 of 3 priced");
    const sent = byStatus("sent");
    expect(row(sent.number)).toHaveTextContent("Sent");
    expect(row(sent.number)).toHaveTextContent("incl. VAT");
    expect(row(sent.number)).toHaveTextContent("Revision 1");
    expect(row(byStatus("accepted").number)).toHaveTextContent("Accepted");

    await user.click(screen.getByRole("button", { name: /^Status/ }));
    await user.click(await screen.findByRole("menuitem", { name: "New" }));
    expect(testNavigation.location).toBe("/quotations?status=new");
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(
        quotations.filter((entry) => entry.status === "new").length + 1,
      ),
    );
    expect(
      api.calls.some((call) =>
        call.path.startsWith("/v1/admin/quotations?status=new"),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Sort/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Company A to Z" }),
    );
    expect(testNavigation.location).toBe("/quotations?status=new&sort=company");
  });

  it("finds a quotation by the company", async () => {
    const { user } = renderPanel(<QuotationsView />, { path: "/quotations" });
    const table = await screen.findByRole("table", {
      name: "Wholesale quotations",
    });
    await user.type(
      screen.getByRole("searchbox", { name: "Find quotations" }),
      "spice corner",
    );
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(2),
    );
    expect(table).toHaveTextContent("Spice Corner GmbH");
  });
});

describe("pricing a quotation", () => {
  it("shows the request and sends only the changed lines, in cents; the totals appear once every line is priced", async () => {
    const draft = byStatus("draft");
    const before = (await detailOf(draft.id)).quotation;
    const open = before.items.find((item) => item.unitPrice === null)!;
    const pricedLine = before.items.find((item) => item.unitPrice !== null)!;
    api.calls.length = 0;

    const { user } = renderQuotation(draft.id);
    await screen.findByRole("heading", { name: draft.number });
    expect(screen.getByText("Curry House Mainz")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ravi@curryhouse-mainz.de" }),
    ).toHaveAttribute("href", "mailto:ravi@curryhouse-mainz.de");
    expect(screen.getByText(/2 of 3 priced/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save prices" })).toBeDisabled();
    const send = screen.getByRole("button", { name: "Send quotation" });
    expect(send).toBeDisabled();
    expect(
      screen.getByLabelText("1 line without a price."),
    ).toBeInTheDocument();

    const price = within(lineRow(open)).getByRole("textbox", {
      name: `Price per carton of ${lineName(open)}`,
    });
    await user.type(price, "62,40");
    expect(screen.getByLabelText("Save the prices first.")).toBeInTheDocument();
    const cartons = within(lineRow(pricedLine)).getByRole("textbox", {
      name: `Cartons of ${lineName(pricedLine)}`,
    });
    await user.clear(cartons);
    await user.type(cartons, "6");
    expect(screen.getByText(/2 lines changed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/quotations/${draft.id}`,
          body: {
            items: [
              { id: pricedLine.id, cartons: 6 },
              { id: open.id, unitPrice: 6240 },
            ],
          },
        },
      ]),
    );
    expect(await screen.findByText("Prices saved")).toBeInTheDocument();
    expect(await screen.findByText("Total incl. VAT")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send quotation" }),
      ).toBeEnabled(),
    );
    const after = (await detailOf(draft.id)).quotation;
    expect(after.status).toBe("draft");
    expect(after.totals).not.toBeNull();
    expect(after.items.find((item) => item.id === open.id)?.unitPrice).toBe(
      6240,
    );
  });

  it("refuses cartons and prices outside the API's limits before anything is sent", async () => {
    const draft = byStatus("draft");
    const before = (await detailOf(draft.id)).quotation;
    const first = before.items[0]!;
    api.calls.length = 0;
    const { user } = renderQuotation(draft.id);
    await screen.findByRole("heading", { name: draft.number });
    const cartons = within(lineRow(first)).getByRole("textbox", {
      name: `Cartons of ${lineName(first)}`,
    });
    await user.clear(cartons);
    await user.type(cartons, "0");
    await user.click(screen.getByRole("button", { name: "Save prices" }));
    expect(
      await screen.findByText("A whole number from 1 to 10,000."),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });
});

describe("sending and closing", () => {
  it("sends a fully priced quotation after a confirmation, and lists the email", async () => {
    const draft = byStatus("draft");
    const before = (await detailOf(draft.id)).quotation;
    const open = before.items.filter((item) => item.unitPrice === null);
    await api.request("PATCH", `/v1/admin/quotations/${draft.id}`, {
      items: open.map((item) => ({ id: item.id, unitPrice: 5000 })),
    });
    api.calls.length = 0;

    const { user } = renderQuotation(draft.id);
    await screen.findByRole("heading", { name: draft.number });
    await user.click(screen.getByRole("button", { name: "Send quotation" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("ravi@curryhouse-mainz.de");
    expect(dialog).toHaveTextContent("Total incl. VAT");
    await user.click(
      within(dialog).getByRole("button", { name: "Send the quotation" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/quotations/${draft.id}/send`,
          body: undefined,
        },
      ]),
    );
    expect(
      await screen.findByText("The quotation is on its way"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("Revision 1").length).toBeGreaterThan(0),
    );
    const emails = screen.getByRole("list", { name: "Emails" });
    expect(within(emails).getAllByText("Quotation sent").length).toBe(1);
    expect(emails).toHaveTextContent(`Your quotation ${draft.number}`);
    expect(
      screen.queryByRole("button", { name: "Send quotation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark accepted" })).toBeEnabled();
  });

  it("marks the lines the API names when a send is refused as unpriced", async () => {
    const draft = byStatus("draft");
    const before = (await detailOf(draft.id)).quotation;
    const open = before.items.filter((item) => item.unitPrice === null);
    await api.request("PATCH", `/v1/admin/quotations/${draft.id}`, {
      items: open.map((item) => ({ id: item.id, unitPrice: 5000 })),
    });
    const { user } = renderQuotation(draft.id);
    await screen.findByRole("heading", { name: draft.number });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send quotation" }),
      ).toBeEnabled(),
    );
    // Someone removed a price in the meantime: the API knows, the page does not.
    const record = api.mock
      .db()
      .quotations.find((entry) => entry.id === draft.id)!;
    record.items[0]!.unitPrice = null;
    await user.click(screen.getByRole("button", { name: "Send quotation" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Send the quotation" }),
    );
    expect(
      await within(dialog).findByText(
        "Every line needs a price per carton before the quotation is sent.",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(await screen.findByText("No price yet")).toBeInTheDocument();
    expect(lineRow(record.items[0]!)).toHaveTextContent("No price yet");
  });

  it("resends, accepts or declines a sent quotation, and cancels an open one", async () => {
    const sent = byStatus("sent");
    const { user, unmount } = renderQuotation(sent.id);
    await screen.findByRole("heading", { name: sent.number });
    expect(
      screen.queryByRole("button", { name: "Save prices" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send again" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("The same revision 1");
    await user.click(
      within(dialog).getByRole("button", { name: "Send again" }),
    );
    await waitFor(() =>
      expect(writes().map((call) => call.path)).toEqual([
        `/v1/admin/quotations/${sent.id}/resend`,
      ]),
    );
    expect(
      await screen.findByText("The quotation is on its way again"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/2 times in all/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Mark accepted" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Mark accepted" }),
    );
    expect(await screen.findByText("Marked as accepted")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText("Closed: nothing here changes any more.", {
          exact: false,
        }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Save prices" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect((await detailOf(sent.id)).quotation.status).toBe("accepted");
    unmount();

    const fresh = byStatus("new");
    api.calls.length = 0;
    const second = renderQuotation(fresh.id);
    await screen.findByRole("heading", { name: fresh.number });
    await second.user.click(
      screen.getByRole("button", { name: "More actions for this quotation" }),
    );
    await second.user.click(
      await screen.findByRole("menuitem", { name: "Cancel request" }),
    );
    dialog = await screen.findByRole("alertdialog");
    await second.user.click(
      within(dialog).getByRole("button", { name: "Cancel the request" }),
    );
    expect(await screen.findByText("Request cancelled")).toBeInTheDocument();
    expect((await detailOf(fresh.id)).quotation.status).toBe("cancelled");
  });

  it("explains when the quotation changed in the meantime and loads it again", async () => {
    const sent = byStatus("sent");
    const { user } = renderQuotation(sent.id);
    await screen.findByRole("heading", { name: sent.number });
    await api.request("POST", `/v1/admin/quotations/${sent.id}/decline`);
    await user.click(screen.getByRole("button", { name: "Mark accepted" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Mark accepted" }),
    );
    expect(
      await within(dialog).findByText(/not in a status that allows this/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Mark accepted" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText("Declined").length).toBeGreaterThan(0);
  });
});

describe("the emails and the PDF", () => {
  const objectUrls: Blob[] = [];
  beforeEach(() => {
    // jsdom has no object URLs: the file is caught on the way.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        objectUrls.push(blob);
        return `blob:quotation-${objectUrls.length}`;
      },
      revokeObjectURL: () => undefined,
    });
  });
  afterEach(() => {
    objectUrls.length = 0;
  });

  it("retries a failed heads-up email from the quotation", async () => {
    const failed = api.mock
      .db()
      .notifications.find(
        (entry) =>
          entry.type === "quotation_request_admin" && entry.status === "failed",
      )!;
    const { user } = renderQuotation(failed.quotationId!);
    const emails = await screen.findByRole("list", { name: "Emails" });
    expect(emails).toHaveTextContent("Failed");
    expect(emails).toHaveTextContent("554 Message rejected");
    await user.click(within(emails).getByRole("button", { name: "Retry" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Send again" }),
    );
    await waitFor(() =>
      expect(writes().map((call) => call.path)).toEqual([
        `/v1/admin/notifications/${failed.id}/retry`,
      ]),
    );
    await waitFor(() => expect(emails).not.toHaveTextContent("Failed"));
    expect(
      within(emails).queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("fetches the PDF with the session and shows it in the viewer", async () => {
    const fresh = byStatus("new");
    const { user } = renderQuotation(fresh.id);
    await screen.findByRole("heading", { name: fresh.number });
    await user.click(screen.getByRole("button", { name: "PDF" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Prices to be confirmed");
    expect(within(dialog).getByTitle(`PDF of ${fresh.number}`)).toHaveAttribute(
      "src",
      "blob:quotation-1",
    );
    expect(objectUrls[0]?.type).toBe("application/pdf");
    expect(
      api.calls.some(
        (call) => call.path === `/v1/admin/quotations/${fresh.id}/pdf`,
      ),
    ).toBe(true);
  });
});

describe("who may do what", () => {
  it("lets a reader see everything and change nothing", async () => {
    const draft = byStatus("draft");
    renderQuotation(draft.id, ["quotations.read", "notifications.read"]);
    await screen.findByRole("heading", { name: draft.number });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save prices" }),
    ).not.toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send quotation" });
    expect(send).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "More actions for this quotation" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the section from an admin without quotations.read", async () => {
    renderPanel(<QuotationsView />, {
      path: "/quotations",
      permissions: ["orders.read"],
    });
    expect(
      await screen.findByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });
});

describe("the Decisions tab", () => {
  it("counts the new requests and links to them", async () => {
    renderPanel(<TodayView />, { path: "/" });
    const fresh = quotations.filter((entry) => entry.status === "new");
    const tile = (
      await screen.findByText("Quotation requests", { selector: "span" })
    ).closest("a")!;
    expect(tile).toHaveTextContent(String(fresh.length));
    expect(tile).toHaveAttribute("href", "/quotations?status=new");
    const panel = screen
      .getByRole("heading", { name: "Quotation requests" })
      .closest("section")!;
    for (const quotation of fresh) {
      expect(
        within(panel).getByRole("link", { name: new RegExp(quotation.number) }),
      ).toHaveAttribute("href", `/quotations/${quotation.id}`);
    }
    expect(panel).toHaveTextContent("Namaste Catering");
  });

  it("leaves the card out for an admin who may not open quotations", async () => {
    renderPanel(<TodayView />, { path: "/", permissions: ["orders.read"] });
    await screen.findByRole("heading", { name: "Waiting for you" });
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getAllByText("Orders to process").length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.queryByText("Quotation requests")).not.toBeInTheDocument();
  });
});

describe("the wholesale stock", () => {
  it("warns on a sent quotation whose lines exceed the stock, never blocks accepting, and shows what accepting took", async () => {
    const sent = byStatus("sent");
    const detail = (await detailOf(sent.id)).quotation;
    const short = detail.items.find((item) => item.stock?.short)!;
    api.calls.length = 0;
    const { user } = renderQuotation(sent.id);
    await screen.findByRole("heading", { name: sent.number });
    expect(
      screen.getByText(
        "Stock is short for 1 line; accepting will take it below zero.",
      ),
    ).toBeInTheDocument();
    expect(lineRow(short)).toHaveTextContent("Short");
    expect(lineRow(short)).toHaveTextContent(String(short.stock!.quantity));
    const accept = screen.getByRole("button", { name: "Mark accepted" });
    expect(accept).toBeEnabled();
    await user.click(accept);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("taken from the wholesale stock");
    expect(dialog).toHaveTextContent(lineName(short));
    expect(dialog).toHaveTextContent("Short lines");
    await user.click(
      within(dialog).getByRole("button", { name: "Mark accepted" }),
    );
    expect(
      (await screen.findAllByText("Marked as accepted")).length,
    ).toBeGreaterThan(0);
    const taken = await screen.findByRole("list", {
      name: "Stock taken per line",
    });
    expect(taken).toHaveTextContent(short.sku);
    expect(taken).toHaveTextContent(
      `${short.stock!.quantity} → ${short.stock!.quantity - short.cartons}`,
    );
    expect(screen.getByText("The stock is short")).toBeInTheDocument();
    expect(screen.queryByText("No price yet")).not.toBeInTheDocument();
    const movements = api.mock
      .db()
      .wholesaleStockMovements.filter((entry) => entry.quotationId === sent.id);
    expect(movements).toHaveLength(detail.items.length);
    expect(
      movements.every((entry) => entry.reason === "quotation_accepted"),
    ).toBe(true);
  });

  it("marks an accepted quotation that went short in the list", async () => {
    renderPanel(<QuotationsView />, { path: "/quotations?status=accepted" });
    const table = await screen.findByRole("table", {
      name: "Wholesale quotations",
    });
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(2),
    );
    expect(table).toHaveTextContent("Stock short");
  });

  it("says when the SKU of a line is no longer in the catalogue", async () => {
    const fresh = byStatus("new");
    const detail = (await detailOf(fresh.id)).quotation;
    const first = detail.items[0]!;
    const db = api.mock.db();
    db.wholesaleProducts = db.wholesaleProducts.filter(
      (product) => product.id !== first.productId,
    );
    renderQuotation(fresh.id);
    await screen.findByRole("heading", { name: fresh.number });
    expect(lineRow(first)).toHaveTextContent("No longer in the catalogue");
  });
});
