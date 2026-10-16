// @vitest-environment jsdom
import { screen, waitFor, within, configure } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { CompanySection } from "./company-section";
import { DeliveryFeeSection } from "./delivery-fee-section";
import { OrdersSection } from "./orders-section";
import { PaymentsSection } from "./payments-section";
import { SettingsFrame } from "./settings-frame";

// The machine may be busy with other work: a slow answer is not a wrong one.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

let api: TestApi;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

const writes = () => api.calls.filter((call) => call.method !== "GET");

function renderSection(
  section: ReactElement,
  path: string,
  permissions?: string[],
) {
  return renderPanel(<SettingsFrame>{section}</SettingsFrame>, {
    path,
    permissions,
  });
}

describe("the company details", () => {
  it("replaces the group with exactly the documented body", async () => {
    const { user } = renderSection(<CompanySection />, "/settings/company");
    const name = await screen.findByRole("textbox", { name: /Company name/ });
    const save = screen.getByRole("button", {
      name: "Save the company details",
    });
    expect(save).toBeDisabled();

    await user.clear(name);
    await user.type(name, "Radhe Foods GmbH");
    await user.type(
      screen.getByRole("textbox", { name: /Tax number/ }),
      "045 123 45678",
    );
    await user.click(save);

    await waitFor(() => expect(writes()).toHaveLength(1));
    // Optional keys that are not set are absent: no registration, no logo.
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/settings/company",
      body: {
        name: "Radhe Foods GmbH",
        addressLines: ["Hanauer Landstraße 120", "60314 Frankfurt am Main"],
        email: "billing@radhefoods.de",
        phone: "+49 69 1234567",
        website: "https://www.radhefoods.de",
        vatId: "DE123456789",
        taxNumber: "045 123 45678",
        invoiceFooter: "Thank you for shopping with Radhe Foods.",
      },
    });
    expect(api.mock.db().settings.company.name).toBe("Radhe Foods GmbH");
    // The form stands on what was saved.
    await waitFor(() => expect(save).toBeDisabled());
  });

  it("warns while invoices cannot be issued, and names what is missing", async () => {
    api.mock.db().settings.company = {
      name: "Radhe Foods",
      addressLines: [],
      email: "",
      missingForInvoices: [],
    };
    const { user } = renderSection(<CompanySection />, "/settings/company");
    const warning = await screen.findByText("Invoices cannot be issued yet");
    expect(warning.closest("[role='status']")).toHaveTextContent(
      "Still missing: the address, the email address and a VAT id or a tax number.",
    );

    await user.type(
      screen.getByRole("textbox", { name: "Address line 1" }),
      "Hauptstraße 1",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Address line 2" }),
      "60311 Frankfurt",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Email/ }),
      "billing@radhefoods.de",
    );
    await user.type(
      screen.getByRole("textbox", { name: /VAT id/ }),
      "de 123456789",
    );
    await user.click(
      screen.getByRole("button", { name: "Save the company details" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      name: "Radhe Foods",
      addressLines: ["Hauptstraße 1", "60311 Frankfurt"],
      email: "billing@radhefoods.de",
      vatId: "DE123456789",
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Invoices cannot be issued yet"),
      ).not.toBeInTheDocument(),
    );
  });

  it("refuses a VAT id the API would refuse, before asking", async () => {
    const { user } = renderSection(<CompanySection />, "/settings/company");
    const vatId = await screen.findByRole("textbox", { name: /VAT id/ });
    await user.clear(vatId);
    await user.type(vatId, "D1");
    await user.click(
      screen.getByRole("button", { name: "Save the company details" }),
    );
    expect(
      await screen.findByText(/A VAT id is two letters of the country/),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("the delivery fee", () => {
  it("sends the tiers as integer cents, lowest first", async () => {
    const { user } = renderSection(
      <DeliveryFeeSection />,
      "/settings/delivery-fee",
    );
    const from = await screen.findByRole("textbox", {
      name: "Tier 2: order value from",
    });
    expect(
      screen.getByText("From €50.00 delivery is free."),
    ).toBeInTheDocument();

    await user.clear(from);
    await user.type(from, "60");
    await user.click(screen.getByRole("button", { name: "Add a tier" }));
    await user.type(
      screen.getByRole("textbox", { name: "Tier 3: order value from" }),
      "30,50",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Tier 3: delivery fee" }),
      "2.5",
    );
    // The sentences follow what is typed.
    expect(
      screen.getByText("Below €30.50 delivery costs €4.99."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("From €30.50 delivery costs €2.50."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("From €60.00 delivery is free."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Save the delivery fee" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/settings/delivery-fee",
      body: {
        tiers: [
          { minOrderValue: 0, fee: 499 },
          { minOrderValue: 3050, fee: 250 },
          { minOrderValue: 6000, fee: 0 },
        ],
      },
    });
    expect(api.mock.db().settings.deliveryFee.tiers).toHaveLength(3);
  });

  it("says that the highest tier applies and that placed orders keep their fee", async () => {
    renderSection(<DeliveryFeeSection />, "/settings/delivery-fee");
    expect(
      await screen.findByText("The highest tier an order reaches applies."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Orders that are already placed keep their fee."),
    ).toBeInTheDocument();
  });

  it("does not send tiers that break the rules", async () => {
    const { user } = renderSection(
      <DeliveryFeeSection />,
      "/settings/delivery-fee",
    );
    const first = await screen.findByRole("textbox", {
      name: "Tier 1: order value from",
    });
    await user.clear(first);
    await user.type(first, "50");
    await user.click(
      screen.getByRole("button", { name: "Save the delivery fee" }),
    );

    expect(
      await screen.findByText(/One tier must start at €0\.00/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Another tier already starts at €50.00."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("orders and returns", () => {
  it("saves each rule through its own endpoint", async () => {
    const { user } = renderSection(<OrdersSection />, "/settings/orders");

    await user.click(await screen.findByRole("radio", { name: "Never" }));
    await user.click(
      screen.getByRole("button", { name: "Save the cancellation rule" }),
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        method: "PUT",
        path: "/v1/admin/settings/order-policy",
        body: { customerCancellation: "never" },
      }),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Method of every new order" }),
      "dhl",
    );
    const german = screen.getByRole("textbox", {
      name: /Delivery estimate \(German\)/,
    });
    await user.clear(german);
    await user.type(german, "3 bis 5 Werktage");
    await user.click(
      screen.getByRole("button", { name: "Save the delivery settings" }),
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        method: "PUT",
        path: "/v1/admin/settings/delivery",
        body: {
          defaultMethod: "dhl",
          estimate: { en: "2 to 4 working days", de: "3 bis 5 Werktage" },
        },
      }),
    );

    const days = screen.getByRole("textbox", { name: /Return window/ });
    await user.clear(days);
    await user.type(days, "0");
    // 0 switches return requests off, and the page says so before saving.
    expect(
      screen.getByText("Return requests are switched off"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Save the return window" }),
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        method: "PUT",
        path: "/v1/admin/settings/return-policy",
        body: { windowDays: 0 },
      }),
    );

    expect(writes()).toHaveLength(3);
    const settings = api.mock.db().settings;
    expect(settings.orderPolicy.customerCancellation).toBe("never");
    expect(settings.delivery.defaultMethod).toBe("dhl");
    expect(settings.delivery.estimate.de).toBe("3 bis 5 Werktage");
    expect(settings.returnPolicy.windowDays).toBe(0);
  });

  it("explains every cancellation rule", async () => {
    renderSection(<OrdersSection />, "/settings/orders");
    for (const name of [
      "While the order is confirmed",
      "Until the order is dispatched",
      "Never",
    ]) {
      const radio = await screen.findByRole("radio", { name });
      expect(radio).toHaveAccessibleDescription(/Customers/);
    }
    // The demo shop lets customers cancel until dispatch.
    expect(
      screen.getByRole("radio", { name: "Until the order is dispatched" }),
    ).toBeChecked();
  });

  it("needs the delivery estimate in both languages", async () => {
    const { user } = renderSection(<OrdersSection />, "/settings/orders");
    const english = await screen.findByRole("textbox", {
      name: /Delivery estimate \(English\)/,
    });
    await user.clear(english);
    await user.click(
      screen.getByRole("button", { name: "Save the delivery settings" }),
    );
    expect(
      await screen.findByText("The English estimate is required."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("refuses a return window outside 0 to 365 days", async () => {
    const { user } = renderSection(<OrdersSection />, "/settings/orders");
    const days = await screen.findByRole("textbox", { name: /Return window/ });
    await user.clear(days);
    await user.type(days, "366");
    await user.click(
      screen.getByRole("button", { name: "Save the return window" }),
    );
    expect(await screen.findByText("Between 0 and 365.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("the payment settings", () => {
  it("sends the minutes of the payment page as a number", async () => {
    const { user } = renderSection(<PaymentsSection />, "/settings/payments");
    const minutes = await screen.findByRole("textbox", {
      name: /payment page stays open/,
    });
    await user.clear(minutes);
    await user.type(minutes, "120");
    await user.click(
      screen.getByRole("button", { name: "Save the payment settings" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/settings/payments",
      body: { checkoutMinutes: 120 },
    });
  });

  it("keeps to the ranges of the API", async () => {
    const { user } = renderSection(<PaymentsSection />, "/settings/payments");
    const minutes = await screen.findByRole("textbox", {
      name: /payment page stays open/,
    });
    await user.clear(minutes);
    await user.type(minutes, "20");
    await user.click(
      screen.getByRole("button", { name: "Save the payment settings" }),
    );
    expect(
      await screen.findByText("Between 30 and 1,440."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("shows the settings to a reader, locked", async () => {
    await api.signIn("viewer");
    renderSection(<PaymentsSection />, "/settings/payments", ["settings.read"]);
    const minutes = await screen.findByRole("textbox", {
      name: /payment page stays open/,
    });
    expect(minutes).toHaveValue("60");
    expect(minutes).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save the payment settings" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        'Your role does not include "Shop settings: manage".',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your role can read the settings, not change them."),
    ).toBeInTheDocument();
  });

  it("does not ask the API without the right to read the settings", () => {
    renderSection(<CompanySection />, "/settings/company", ["orders.read"]);
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("links the sections as tabs and marks the one that is open", async () => {
    renderSection(<DeliveryFeeSection />, "/settings/delivery-fee");
    const nav = screen.getByRole("navigation", {
      name: "Sections of the shop settings",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/settings/company",
      "/settings/delivery-fee",
      "/settings/orders",
      "/settings/payments",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Delivery fee" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
