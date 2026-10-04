// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { NotificationDetail, NotificationStatus } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { NotificationView } from "./notification-view";
import { NotificationsView } from "./notifications-view";

let api: TestApi;

const messages = () => api.mock.db().notifications;
const stored = (id: string) => {
  const message = messages().find((entry) => entry.id === id);
  if (!message) throw new Error(`No message ${id} in the demo data`);
  return message;
};
function first(
  status: NotificationStatus,
  channel: NotificationDetail["channel"] = "email",
): NotificationDetail {
  const message = messages().find(
    (entry) => entry.status === status && entry.channel === channel,
  );
  if (!message)
    throw new Error(`No ${status} ${channel} message in the demo data`);
  return message;
}

function show(message: NotificationDetail, permissions?: string[]) {
  return renderPanel(<NotificationView />, {
    path: `/communication/notifications/${message.id}`,
    params: { id: message.id },
    permissions,
  });
}

const writes = () => api.calls.filter((call) => call.method !== "GET");

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("a failed message", () => {
  it("shows the failure first, and is sent again after a confirmation", async () => {
    const message = first("failed");
    const { user } = show(message);

    // The provider's answer, prominent.
    expect(
      await screen.findByText(
        `Given up after ${message.attempts} of ${message.maxAttempts} attempts`,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(message.lastError ?? "").length).toBeGreaterThan(
      0,
    );

    await user.click(screen.getByRole("button", { name: "Send again" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Send this message again?" }),
    ).toBeInTheDocument();
    // To whom, before anything goes out.
    expect(within(dialog).getByText(message.to)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Send again" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/notifications/${message.id}/retry`,
        body: undefined,
      },
    ]);
    expect(stored(message.id).status).toBe("sent");
    // The page follows: nothing is left to send again.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Send again" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("explains the API's refusal and keeps the dialog open", async () => {
    const message = first("failed");
    const { user, unhandled } = show(message);
    await user.click(await screen.findByRole("button", { name: "Send again" }));
    const dialog = await screen.findByRole("alertdialog");

    // Another admin was quicker: the message went out in the meantime.
    stored(message.id).status = "sent";
    await user.click(
      within(dialog).getByRole("button", { name: "Send again" }),
    );

    expect(
      await within(dialog).findByText(
        /This one was sent or queued in the meantime\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This is not possible for the message in its status.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // The dialog shows the error itself: no second report as a toast.
    expect(unhandled).toHaveLength(0);
  });
});

describe("a skipped WhatsApp message", () => {
  it("cannot be sent again while WhatsApp is not configured, and says why", async () => {
    const message = first("skipped", "whatsapp");
    show(message);

    expect(await screen.findByText("Not sent on purpose")).toBeInTheDocument();
    expect(
      screen.getAllByText("WhatsApp is not configured.").length,
    ).toBeGreaterThan(0);
    await screen.findByRole("button", { name: "Send again" });
    // As soon as the API has said that WhatsApp is off.
    expect(
      await screen.findByLabelText(
        "WhatsApp is not configured yet. The message can be sent once it is.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send again" })).toBeDisabled();
  });

  it("can be sent again once WhatsApp is on", async () => {
    api = installTestApi({ whatsapp: true });
    await api.signIn();
    // A record that was skipped while WhatsApp was still off.
    const message = first("sent", "whatsapp");
    message.status = "skipped";
    message.reason = "WhatsApp is not configured.";
    const { user } = show(message);

    await screen.findByRole("button", { name: "Send again" });
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/notifications/summary",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Send again" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Send again" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/notifications/${message.id}/retry`,
          body: undefined,
        },
      ]),
    );
    expect(stored(message.id).status).toBe("sent");
  });
});

describe("a queued message", () => {
  it("is cancelled with the reason given", async () => {
    const message = first("queued");
    const { user } = show(message);

    expect(await screen.findByText("Waiting in the queue")).toBeInTheDocument();
    // A queued message is not sent again; it is withdrawn.
    expect(
      screen.queryByRole("button", { name: "Send again" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Cancel the message" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(message.to)).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "The order was changed by phone.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel the message" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/notifications/${message.id}/cancel`,
        body: { reason: "The order was changed by phone." },
      },
    ]);
    expect(stored(message.id).status).toBe("cancelled");
    // Cancelled, with its reason, and it can be sent again.
    expect(
      await screen.findByText("Withdrawn before it went out"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("The order was changed by phone.").length,
    ).toBeGreaterThan(0);
    expect(
      await screen.findByRole("button", { name: "Send again" }),
    ).toBeEnabled();
  });

  it("is cancelled without a reason when none is given", async () => {
    const message = first("queued");
    const { user } = show(message);
    await user.click(
      await screen.findByRole("button", { name: "Cancel the message" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel the message" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/notifications/${message.id}/cancel`,
          body: {},
        },
      ]),
    );
  });

  it("stays queued when the admin steps back", async () => {
    const message = first("queued");
    const { user } = show(message);
    await user.click(
      await screen.findByRole("button", { name: "Cancel the message" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Keep it queued" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(0);
    expect(stored(message.id).status).toBe("queued");
  });
});

describe("the page of a message", () => {
  it("shows what it was rendered from, its attachment and its records", async () => {
    const message = messages().find((entry) =>
      entry.attachments.some((attachment) => attachment.kind === "invoice_pdf"),
    );
    if (!message)
      throw new Error("No message with an invoice in the demo data");
    const invoice = message.attachments.find(
      (attachment) => attachment.kind === "invoice_pdf",
    );
    show(message);

    expect(await screen.findByText("Rendered from")).toBeInTheDocument();
    expect(screen.getByText("Order number")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the invoice" }),
    ).toHaveAttribute("href", `/payments/invoices/${invoice?.id}`);
    expect(
      screen.getByRole("link", { name: message.orderNumber ?? "" }),
    ).toHaveAttribute("href", `/orders/${message.orderId}`);
    // The customer is named once the name is known.
    const customer = api.mock
      .db()
      .customers.find((entry) => entry.id === message.customerId);
    expect(
      await screen.findByRole("link", {
        name: `${customer?.firstName} ${customer?.lastName}`,
      }),
    ).toHaveAttribute("href", `/customers/${message.customerId}`);
  });

  it("says that an unknown message does not exist", async () => {
    renderPanel(<NotificationView />, {
      path: "/communication/notifications/000000000000000000000000",
      params: { id: "000000000000000000000000" },
    });
    expect(
      await screen.findByText("This message does not exist"),
    ).toBeInTheDocument();
  });
});

describe("the log", () => {
  it("shows the counts of the API and the state of WhatsApp", async () => {
    renderPanel(<NotificationsView />, {
      path: "/communication/notifications",
    });
    const counts = await screen.findByRole("list", {
      name: "Messages by status",
    });
    for (const status of ["queued", "sent", "failed", "skipped"] as const) {
      const expected = messages().filter(
        (entry) => entry.status === status,
      ).length;
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      const count = `${expected.toLocaleString("en")} message${expected === 1 ? "" : "s"}`;
      await waitFor(() =>
        expect(
          within(counts).getByRole("button", { name: `${label}: ${count}` }),
        ).toBeInTheDocument(),
      );
    }
    expect(screen.getByText("WhatsApp is not set up")).toBeInTheDocument();
    expect(
      screen.getByText(/stored as skipped until WhatsApp is configured/),
    ).toBeInTheDocument();
  });

  it("runs the queue and shows what the run did", async () => {
    const queued = messages().filter(
      (entry) => entry.status === "queued",
    ).length;
    expect(queued).toBeGreaterThan(0);
    const { user } = renderPanel(<NotificationsView />, {
      path: "/communication/notifications",
    });

    await user.click(screen.getByRole("button", { name: "Run the queue now" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/admin/notifications/run",
          body: undefined,
        },
      ]),
    );
    const result = `${queued} sent, 0 retried, 0 failed, 0 skipped, 0 recovered`;
    expect((await screen.findAllByText(result)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Queue worked at/)).toBeInTheDocument();
    expect(messages().some((entry) => entry.status === "queued")).toBe(false);
  });

  it("filters by what the address carries and shows it as chips that can be removed", async () => {
    const message = first("failed");
    const customer = api.mock
      .db()
      .customers.find((entry) => entry.id === message.customerId);
    const { user } = renderPanel(<NotificationsView />, {
      path: `/communication/notifications?status=failed&customerId=${message.customerId}&orderNumber=${message.orderNumber}`,
    });

    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/notifications?status=failed&customerId=${message.customerId}&orderNumber=${message.orderNumber}&limit=50`,
      ),
    );
    // The customer by name, the order by number.
    expect(
      await screen.findByText(`${customer?.firstName} ${customer?.lastName}`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove the filter Order" }),
    ).toBeInTheDocument();
    // Why it failed is in the row itself (and in its card on a phone).
    expect(
      (await screen.findAllByText(message.lastError ?? "")).length,
    ).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: "Remove the filter Customer" }),
    );
    await waitFor(() =>
      expect(testNavigation.location).toBe(
        `/communication/notifications?status=failed&orderNumber=${message.orderNumber}`,
      ),
    );
  });

  it("narrows to a status from its count", async () => {
    const { user } = renderPanel(<NotificationsView />, {
      path: "/communication/notifications",
    });
    const counts = await screen.findByRole("list", {
      name: "Messages by status",
    });
    await user.click(
      await within(counts).findByRole("button", { name: /^Failed/ }),
    );
    await waitFor(() =>
      expect(testNavigation.location).toBe(
        "/communication/notifications?status=failed",
      ),
    );
    await waitFor(() =>
      expect(
        within(counts).getByRole("button", { name: /^Failed/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });
});

describe("permissions", () => {
  it("keeps the actions visible but disabled without notifications.manage", async () => {
    const message = first("failed");
    const { user } = show(message, ["notifications.read"]);
    const button = await screen.findByRole("button", { name: "Send again" });
    expect(button).toBeDisabled();
    expect(
      screen.getByLabelText(
        'Your role does not include "Communication: manage".',
      ),
    ).toBeInTheDocument();
    await user.click(button).catch(() => undefined);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not run the queue without notifications.manage", () => {
    renderPanel(<NotificationsView />, {
      path: "/communication/notifications",
      permissions: ["notifications.read"],
    });
    expect(
      screen.getByRole("button", { name: "Run the queue now" }),
    ).toBeDisabled();
  });

  it("does not open the log without notifications.read", () => {
    renderPanel(<NotificationsView />, {
      path: "/communication/notifications",
      permissions: ["orders.read"],
    });
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
  });
});
