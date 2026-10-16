// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnnouncementWithProgress } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { AnnouncementComposeView } from "./announcement-compose-view";
import { AnnouncementView } from "./announcement-view";
import { AnnouncementsView } from "./announcements-view";

let api: TestApi;

const SUBJECT = "Fresh curry leaves this week";
const MESSAGE = "A small batch arrived.\n\nOrder while it is in stock.";

/** The customers an announcement goes to: active, and opted in to news. */
const optedIn = () =>
  api.mock
    .db()
    .customers.filter(
      (customer) =>
        customer.status === "active" && customer.communication.marketingOptIn,
    );
const writes = () => api.calls.filter((call) => call.method !== "GET");
const sends = () =>
  api.calls.filter(
    (call) => call.method === "POST" && call.path === "/v1/admin/announcements",
  );

function compose(permissions?: string[]) {
  return renderPanel(<AnnouncementComposeView />, {
    path: "/communication/announcements/new",
    permissions,
  });
}

async function write(user: UserEvent) {
  const english = screen.getAllByLabelText("EN English");
  await user.type(english[0] as HTMLElement, SUBJECT);
  await user.type(english[1] as HTMLElement, MESSAGE);
}

async function preview(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Preview" }));
  return screen.findByRole("heading", { name: `Preview: “${SUBJECT}”` });
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("writing an announcement", () => {
  it("says who receives it before anything is written", () => {
    compose();
    expect(screen.getByText("Who receives it")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Only customers who opted in to news, each in their own language\./,
      ),
    ).toBeInTheDocument();
  });

  it("asks the API for nothing while the English text is missing", async () => {
    const { user } = compose();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      await screen.findByText("The English subject is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The English message is required."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("shows the preview of the API, then sends after restating the recipients", async () => {
    const recipients = optedIn().length;
    expect(recipients).toBeGreaterThan(0);
    const { user } = compose();
    await write(user);
    await preview(user);

    const body = {
      subject: { en: SUBJECT },
      message: { en: MESSAGE },
      channels: ["email"],
    };
    expect(writes()).toEqual([
      { method: "POST", path: "/v1/admin/announcements/preview", body },
    ]);
    // Who would get it, from the API.
    expect(
      screen.getAllByText(`${recipients} customers`).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Nothing has been sent yet.", { exact: false }),
    ).toBeInTheDocument();
    // The rendered email, in a frame in which nothing can run.
    const frame = screen.getByTitle("The email in English");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain(SUBJECT);
    expect(frame.getAttribute("srcdoc")).not.toContain("href=");
    expect(screen.getByRole("tab", { name: "German" })).toBeInTheDocument();
    expect(sends()).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: `Send to ${recipients} customers` }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Send this announcement to ${recipients} customers?`,
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("By email").nextSibling).toHaveTextContent(
      `${recipients} customers`,
    );
    expect(within(dialog).getByText(SUBJECT)).toBeInTheDocument();
    // Still nothing sent: the confirmation comes first.
    expect(sends()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", {
        name: `Send to ${recipients} customers`,
      }),
    );
    await waitFor(() => expect(sends()).toHaveLength(1));
    // Exactly what was previewed.
    expect(sends()[0]?.body).toEqual(body);
    const created = api.mock
      .db()
      .announcements.find((entry) => entry.subject.en === SUBJECT);
    expect(created?.recipients).toBe(recipients);
    await waitFor(() =>
      expect(testNavigation.location).toBe(
        `/communication/announcements/${created?.id}`,
      ),
    );
  });

  it("goes back to the text without losing it, and previews again", async () => {
    const { user } = compose();
    await write(user);
    await preview(user);
    await user.click(screen.getByRole("button", { name: "Back to editing" }));
    const english = screen.getAllByLabelText("EN English");
    expect(english[0]).toHaveValue(SUBJECT);
    expect(english[1]).toHaveValue(MESSAGE);
    await user.type(
      screen.getAllByLabelText("DE German")[0] as HTMLElement,
      "Frische Curryblätter",
    );
    await preview(user);
    expect(writes().map((call) => call.body)).toEqual([
      {
        subject: { en: SUBJECT },
        message: { en: MESSAGE },
        channels: ["email"],
      },
      {
        subject: { en: SUBJECT, de: "Frische Curryblätter" },
        message: { en: MESSAGE },
        channels: ["email"],
      },
    ]);
    expect(sends()).toHaveLength(0);
  });

  it("offers nothing to send when no customer has asked for news", async () => {
    for (const customer of api.mock.db().customers) {
      customer.communication.marketingOptIn = false;
    }
    const { user } = compose();
    await write(user);
    await preview(user);
    expect(
      screen.getByText("No customer has asked for news yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send to 0 customers" }),
    ).toBeDisabled();
    expect(sends()).toHaveLength(0);
  });

  it("shows the API's refusal when the last recipient left before the send", async () => {
    const recipients = optedIn().length;
    const { user, unhandled } = compose();
    await write(user);
    await preview(user);
    // Between the preview and the send, everyone opted out.
    for (const customer of api.mock.db().customers) {
      customer.communication.marketingOptIn = false;
    }
    await user.click(
      screen.getByRole("button", { name: `Send to ${recipients} customers` }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: `Send to ${recipients} customers`,
      }),
    );
    expect(
      await within(dialog).findByText("No customer has asked for news yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      api.mock.db().announcements.some((entry) => entry.subject.en === SUBJECT),
    ).toBe(false);
    expect(unhandled).toHaveLength(0);
    expect(testNavigation.location).toBe("/communication/announcements/new");
  });

  it("refuses a link that is not a full address, at the field", async () => {
    const { user } = compose();
    await write(user);
    await user.type(
      screen.getByRole("textbox", { name: /^Link/ }),
      "radhefoods.de/mango",
    );
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      await screen.findByText(
        "Enter the full address, beginning with https://",
      ),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("sends the link, the button label and the product that were chosen", async () => {
    const db = api.mock.db();
    const product = db.products.find(
      (entry) => entry.name.en === "Kesar Mango Box",
    );
    if (!product) throw new Error("The demo data lacks the product");
    const { user } = compose();
    await write(user);
    await user.type(
      screen.getByRole("textbox", { name: /^Link/ }),
      "https://www.radhefoods.de/mango",
    );
    const english = screen.getAllByLabelText("EN English");
    await user.type(english[2] as HTMLElement, "See the mangoes");
    await user.click(screen.getByRole("button", { name: /^Product/ }));
    await user.type(
      await screen.findByPlaceholderText("Name or article number"),
      "Kesar",
    );
    await user.click(
      await screen.findByRole("option", { name: /Kesar Mango Box/ }),
    );

    await preview(user);
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/v1/admin/announcements/preview",
        body: {
          subject: { en: SUBJECT },
          message: { en: MESSAGE },
          link: "https://www.radhefoods.de/mango",
          linkLabel: { en: "See the mangoes" },
          productId: product.id,
          channels: ["email"],
        },
      },
    ]);
    // The link the API resolved, and what the announcement is filed under.
    expect(
      screen.getByRole("link", { name: "https://www.radhefoods.de/mango" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Kesar Mango Box (${product.variants[0]?.sku})`),
    ).toBeInTheDocument();
  });
});

describe("the WhatsApp channel", () => {
  it("is shown but switched off while WhatsApp is not configured", async () => {
    compose();
    const whatsapp = screen.getByRole("checkbox", { name: "WhatsApp" });
    expect(whatsapp).toBeDisabled();
    expect(
      await screen.findByText("WhatsApp is not set up"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /News cannot go out by WhatsApp yet, so the choice is switched off/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Email" })).toBeChecked();
  });

  it("can be chosen once WhatsApp is on, and its recipients are restated", async () => {
    api = installTestApi({ whatsapp: true });
    await api.signIn();
    const byEmail = optedIn().length;
    const byWhatsapp = optedIn().filter(
      (customer) => customer.communication.whatsappOptIn,
    ).length;
    expect(byWhatsapp).toBeGreaterThan(0);
    const { user } = compose();

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "WhatsApp" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("checkbox", { name: "WhatsApp" }));
    await write(user);
    await preview(user);
    expect(writes()[0]?.body).toEqual({
      subject: { en: SUBJECT },
      message: { en: MESSAGE },
      channels: ["email", "whatsapp"],
    });
    // The values that go into the WhatsApp template, as text.
    expect(screen.getByText("WhatsApp template")).toBeInTheDocument();
    expect(screen.getAllByText(/radhe_announcement/).length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: `Send to ${byEmail} customers` }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("By email").nextSibling).toHaveTextContent(
      `${byEmail} customers`,
    );
    expect(
      within(dialog).getByText("By WhatsApp").nextSibling,
    ).toHaveTextContent(`${byWhatsapp} customer`);
    expect(
      within(dialog).getByText("Messages in all").nextSibling,
    ).toHaveTextContent(String(byEmail + byWhatsapp));
  });

  it("needs at least one channel", async () => {
    const { user } = compose();
    await write(user);
    await user.click(screen.getByRole("checkbox", { name: "Email" }));
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      await screen.findByText("Choose at least one channel."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("an announcement that was sent", () => {
  async function send(): Promise<AnnouncementWithProgress> {
    const result = await api.request<AnnouncementWithProgress>(
      "POST",
      "/v1/admin/announcements",
      {
        subject: { en: SUBJECT },
        message: { en: MESSAGE },
        channels: ["email"],
      },
    );
    api.calls.length = 0;
    return result;
  }

  function show(id: string, permissions?: string[]) {
    return renderPanel(<AnnouncementView />, {
      path: `/communication/announcements/${id}`,
      params: { id },
      permissions,
    });
  }

  it("cancels what has not gone out, with the number restated", async () => {
    const { announcement, progress } = await send();
    const queued = progress.email.queued;
    expect(queued).toBeGreaterThan(1);
    const { user } = show(announcement.id);

    expect(
      await screen.findByText(`${queued} messages waiting`),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Cancel what has not gone out" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Cancel the ${queued} messages that have not gone out?`,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("To be cancelled").nextSibling,
    ).toHaveTextContent(`${queued} messages`);
    expect(writes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: `Cancel ${queued} messages` }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/announcements/${announcement.id}/cancel`,
        body: undefined,
      },
    ]);
    const records = api.mock
      .db()
      .notifications.filter(
        (entry) => entry.announcementId === announcement.id,
      );
    expect(records).toHaveLength(queued);
    expect(records.every((entry) => entry.status === "cancelled")).toBe(true);
    // The page follows: cancelled, and nothing left to cancel.
    expect(
      await screen.findByText(/^Cancelled \d{1,2} \w{3} \d{4}/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cancel what has not gone out" }),
      ).toBeDisabled(),
    );
  });

  it("shows the progress with every status, and leads to its messages", async () => {
    const announcement = api.mock.db().announcements[0];
    if (!announcement) throw new Error("No announcement in the demo data");
    const records = api.mock
      .db()
      .notifications.filter(
        (entry) => entry.announcementId === announcement.id,
      );
    const sent = records.filter(
      (entry) => entry.channel === "email" && entry.status === "sent",
    ).length;
    const skipped = records.filter(
      (entry) => entry.channel === "whatsapp" && entry.status === "skipped",
    ).length;
    show(announcement.id);

    const table = await screen.findByRole("table", {
      name: "Messages of this announcement by channel and status",
    });
    for (const status of [
      "Queued",
      "Sending",
      "Sent",
      "Failed",
      "Skipped",
      "Cancelled",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: status }),
      ).toBeInTheDocument();
    }
    expect(
      within(table).getByRole("link", {
        name: `${sent} sent by Email: open these messages`,
      }),
    ).toHaveAttribute(
      "href",
      `/communication/notifications?announcementId=${announcement.id}&channel=email&status=sent`,
    );
    expect(
      within(table).getByRole("link", {
        name: `${skipped} skipped by WhatsApp: open these messages`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open its messages" }),
    ).toHaveAttribute(
      "href",
      `/communication/notifications?announcementId=${announcement.id}`,
    );
    // Both languages of the content.
    expect(screen.getByText(announcement.message.en)).toBeInTheDocument();
    expect(screen.getByText(announcement.message.de ?? "")).toBeInTheDocument();
    // Everything went out: nothing to cancel, and the button says why.
    expect(
      screen.getByRole("button", { name: "Cancel what has not gone out" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        "Nothing waits to go out: every message was sent or has ended.",
      ),
    ).toBeInTheDocument();
    // Why the WhatsApp messages were skipped.
    expect(
      await screen.findByText(
        /stored as skipped because WhatsApp is not configured/,
      ),
    ).toBeInTheDocument();
  });

  it("keeps the cancellation visible but disabled without notifications.manage", async () => {
    const { announcement } = await send();
    show(announcement.id, ["notifications.read"]);
    expect(
      await screen.findByRole("button", {
        name: "Cancel what has not gone out",
      }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        'Your role does not include "Communication: manage".',
      ),
    ).toBeInTheDocument();
  });
});

describe("permissions and the history", () => {
  it("does not open the compose page without notifications.manage", () => {
    compose(["notifications.read"]);
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
  });

  it("lists the announcements and offers a new one only to who may send", async () => {
    const announcements = api.mock.db().announcements;
    renderPanel(<AnnouncementsView />, {
      path: "/communication/announcements",
      permissions: ["notifications.read"],
    });
    for (const announcement of announcements) {
      expect(
        await screen.findByRole("link", { name: announcement.subject.en }),
      ).toHaveAttribute(
        "href",
        `/communication/announcements/${announcement.id}`,
      );
    }
    expect(
      screen.getByRole("button", { name: "New announcement" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "New announcement" }),
    ).not.toBeInTheDocument();
  });

  it("narrows the history to a product from the address, as a chip that can be removed", async () => {
    const withProduct = api.mock
      .db()
      .announcements.find((entry) => entry.productId);
    if (!withProduct?.productId)
      throw new Error("No announcement about a product in the demo data");
    const { user } = renderPanel(<AnnouncementsView />, {
      path: `/communication/announcements?productId=${withProduct.productId}`,
    });
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/announcements?productId=${withProduct.productId}&limit=25`,
      ),
    );
    expect(
      await screen.findByRole("link", { name: withProduct.subject.en }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "New announcement" }),
    ).toHaveAttribute("href", "/communication/announcements/new");
    await user.click(
      screen.getByRole("button", { name: "Remove the filter Product" }),
    );
    await waitFor(() =>
      expect(testNavigation.location).toBe("/communication/announcements"),
    );
  });
});
