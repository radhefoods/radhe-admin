// @vitest-environment jsdom
import {
  render,
  screen,
  waitFor,
  within,
  configure,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalDocument } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { LegalDocumentView } from "./legal-document-view";
import { LegalView } from "./legal-view";
import { MarkdownText } from "./markdown";

// The machine may be busy with other work: a slow answer is not a wrong one.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

let api: TestApi;

const record = (
  type: LegalDocument["type"],
  version: number,
): LegalDocument => {
  const found = api.mock
    .db()
    .legal.find((entry) => entry.type === type && entry.version === version);
  if (!found) throw new Error(`No ${type} version ${version} in the demo data`);
  return found;
};
// The language tag of a bilingual field, with its spoken name.
const EN = "EN English";
const DE = "DE German";
const writes = () => api.calls.filter((call) => call.method !== "GET");
const openDocument = (document: LegalDocument, permissions?: string[]) =>
  renderPanel(<LegalDocumentView />, {
    path: `/settings/legal/${document.id}`,
    params: { id: document.id },
    permissions,
  });

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the list of legal texts", () => {
  it("groups the versions by type and marks what customers accept now", async () => {
    renderPanel(<LegalView />);
    const terms = await screen.findByRole("region", {
      name: "Terms and conditions",
    });
    const rows = within(terms).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Version 3");
    expect(rows[0]).toHaveTextContent("Draft");
    expect(rows[1]).toHaveTextContent("Version 2");
    expect(rows[1]).toHaveTextContent("Published");
    expect(rows[1]).toHaveTextContent("Current");
    expect(rows[1]).toHaveTextContent("Checkout and payment wording");
    expect(rows[2]).not.toHaveTextContent("Current");
    expect(
      within(terms).getByText(/Customers accept version 2\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Privacy policy" }),
    ).toBeInTheDocument();
    // Terms and privacy are published: nothing blocks the checkout.
    expect(screen.queryByText(/Checkout is refused/)).not.toBeInTheDocument();
  });

  it("warns while a required text has no published version", async () => {
    const privacy = record("privacy", 1);
    privacy.status = "draft";
    privacy.publishedAt = null;
    renderPanel(<LegalView />);
    expect(
      await screen.findByText(
        "Checkout is refused: the privacy policy is not published",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /The shop accepts no order until the terms and the privacy policy have a published version\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Open the draft of the privacy policy",
      }),
    ).toHaveAttribute("href", `/settings/legal/${privacy.id}`);
  });

  it("starts the next version as a draft from the text of the latest one", async () => {
    const source = record("privacy", 1);
    const { user } = renderPanel(<LegalView />);
    const privacy = await screen.findByRole("region", {
      name: "Privacy policy",
    });
    await user.click(
      within(privacy).getByRole("button", { name: "New version" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Version 2, as a draft"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/^Version 1 \(published/),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", {
        name: /What changes in this version/,
      }),
      "Cookie section",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Create the draft of version 2",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/legal-documents",
      body: {
        type: "privacy",
        title: source.title,
        content: source.content,
        note: "Cookie section",
      },
    });
    const created = record("privacy", 2);
    expect(created.status).toBe("draft");
    await waitFor(() =>
      expect(testNavigation.history).toContain(`/settings/legal/${created.id}`),
    );
  });

  it("points to a draft that is still open before starting another", async () => {
    const draft = record("terms", 3);
    const { user } = renderPanel(<LegalView />);
    const terms = await screen.findByRole("region", {
      name: "Terms and conditions",
    });
    await user.click(
      within(terms).getByRole("button", { name: "New version" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Version 3 is still a draft"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "continue with version 3" }),
    ).toHaveAttribute("href", `/settings/legal/${draft.id}`);
  });

  it("keeps New version visible but disabled without legal.manage", async () => {
    renderPanel(<LegalView />, { permissions: ["legal.read"] });
    const terms = await screen.findByRole("region", {
      name: "Terms and conditions",
    });
    expect(
      within(terms).getByRole("button", { name: "New version" }),
    ).toBeDisabled();
    expect(
      within(terms).getByRole("button", { name: "Page settings" }),
    ).toBeDisabled();
    // Two writes per page, six pages.
    expect(
      screen.getAllByLabelText(
        'Your role does not include "Legal texts: manage".',
      ),
    ).toHaveLength(12);
  });
});

describe("the six legal pages", () => {
  const LABELS = [
    "Imprint",
    "Shipping information",
    "Refund policy",
    "Terms and conditions",
    "Privacy policy",
    "Right of withdrawal",
  ];
  const region = (name: string) => screen.findByRole("region", { name });

  it("lists them in the order of the API, each with what is published, drafted and its links", async () => {
    renderPanel(<LegalView />);
    const imprint = await region("Imprint");
    expect(
      screen
        .getAllByRole("region")
        .map((entry) => entry.getAttribute("aria-label"))
        .filter((label) => label !== null && LABELS.includes(label)),
    ).toEqual(LABELS);

    // Published, by whom, and where the shop shows it.
    expect(
      within(imprint).getByText(/^Version 1, .+, by Vrushabh Vasoya$/),
    ).toBeInTheDocument();
    expect(within(imprint).getByText("No draft")).toBeInTheDocument();
    expect(
      within(imprint).getByRole("link", { name: /\/en\/legal\/imprint/ }),
    ).toHaveAttribute("href", "http://localhost:3001/en/legal/imprint");
    expect(
      within(imprint).getByRole("link", {
        name: /\/de\/rechtliches\/impressum/,
      }),
    ).toHaveAttribute("href", "http://localhost:3001/de/rechtliches/impressum");
    // The history names who published and who created a version.
    const row = within(imprint).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("by Vrushabh Vasoya");

    // A draft only: the address is shown, but there is nothing to open yet.
    const shipping = await region("Shipping information");
    const draft = record("shipping", 1);
    expect(within(shipping).getByText("Not published")).toBeInTheDocument();
    expect(
      within(shipping).getByText("Not shown in the shop yet"),
    ).toBeInTheDocument();
    expect(
      within(shipping).getByRole("link", { name: "Version 1 is a draft" }),
    ).toHaveAttribute("href", `/settings/legal/${draft.id}`);
    expect(
      within(shipping).getByText("http://localhost:3001/en/legal/shipping"),
    ).toBeInTheDocument();
    expect(
      within(shipping).queryByRole("link", { name: /localhost:3001/ }),
    ).not.toBeInTheDocument();

    // Nobody has written it yet: the page is there all the same.
    const withdrawal = await region("Right of withdrawal");
    expect(
      within(withdrawal).getByText("No right of withdrawal yet"),
    ).toBeInTheDocument();
    expect(
      within(withdrawal).getByText(
        "http://localhost:3001/de/rechtliches/widerruf",
      ),
    ).toBeInTheDocument();
  });

  it("marks the terms and the privacy policy as accepted at checkout, and nothing else", async () => {
    renderPanel(<LegalView />);
    const terms = await region("Terms and conditions");
    const privacy = await region("Privacy policy");
    expect(within(terms).getByText("Accepted at checkout")).toBeInTheDocument();
    expect(
      within(privacy).getByText("Accepted at checkout"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Accepted at checkout")).toHaveLength(2);
    expect(
      within(await region("Imprint")).getByText(/The shop shows version 1\./),
    ).toBeInTheDocument();
  });

  it("warns about the checkout for the terms and the privacy policy only", async () => {
    // None of the four pages that inform is published.
    const db = api.mock.db();
    db.legal = db.legal.filter(
      (entry) => entry.type === "terms" || entry.type === "privacy",
    );
    const { unmount } = renderPanel(<LegalView />);
    await region("Right of withdrawal");
    expect(screen.getAllByText("Not shown in the shop yet")).toHaveLength(4);
    expect(screen.queryByText(/Checkout is refused/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    // Without the terms, the warning names the terms and only them.
    db.legal = db.legal.filter((entry) => entry.type !== "terms");
    renderPanel(<LegalView />);
    expect(
      await screen.findByText(
        "Checkout is refused: the terms is not published",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start the terms" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Start the (imprint|shipping|refund|right)/,
      }),
    ).not.toBeInTheDocument();
  });

  it("starts the first version of a page nobody has written yet", async () => {
    const { user } = renderPanel(<LegalView />);
    const withdrawal = await region("Right of withdrawal");
    await user.click(
      within(withdrawal).getByRole("button", { name: "New version" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "New version of the right of withdrawal",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "The published version stays what the shop shows",
    );
    expect(
      within(dialog).getByText("Nothing: the first version"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Create the draft of version 1",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/legal-documents",
      body: {
        type: "withdrawal",
        title: { en: "Right of Withdrawal" },
        content: {},
      },
    });
    const created = record("withdrawal", 1);
    expect(created.status).toBe("draft");
    expect(created.createdByAdmin?.name).toBe("Vrushabh Vasoya");
    await waitFor(() =>
      expect(testNavigation.history).toContain(`/settings/legal/${created.id}`),
    );
  });

  it("takes a new page from its first draft to published, with its text in one language", async () => {
    const draft: LegalDocument = {
      id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      type: "withdrawal",
      version: 1,
      status: "draft",
      title: { en: "Right of Withdrawal", de: "Widerrufsbelehrung" },
      content: {},
      note: null,
      publishedAt: null,
      publishedByAdmin: null,
      createdByAdmin: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    api.mock.db().legal.push(draft);
    const { user } = openDocument(draft);

    // Without any text there is nothing to publish.
    expect(
      await screen.findByRole("button", { name: "Publish" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        "The text is needed, in English or German, to publish.",
      ),
    ).toBeInTheDocument();

    // German only: that is enough, and the panel says who will read it.
    const german = (await screen.findAllByRole("textbox", { name: DE }))[1]!;
    await user.type(german, "# Widerrufsbelehrung");
    expect(
      await screen.findByText(
        /Only the German text is written\. Readers of the other language will see this text\./,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the draft" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      content: { de: "# Widerrufsbelehrung" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Publish version 1 of the right of withdrawal?",
      }),
    ).toBeInTheDocument();
    // Nobody accepts this page at checkout.
    expect(dialog).toHaveTextContent("The shop shows this version from now on");
    expect(dialog).not.toHaveTextContent("Customers accept");
    expect(within(dialog).getByText("Replaces").nextSibling).toHaveTextContent(
      "Nothing: the first version",
    );
    expect(within(dialog).getByText("Languages").nextSibling).toHaveTextContent(
      "German only: readers of the other language will see this text",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Publish version 1" }),
    );

    await waitFor(() =>
      expect(record("withdrawal", 1).status).toBe("published"),
    );
    expect(writes()[1]).toEqual({
      method: "POST",
      path: `/v1/admin/legal-documents/${draft.id}/publish`,
      body: undefined,
    });
    // The published page: who published it, and what readers of English see.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save the draft" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/The shop shows this version\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Published by").nextSibling).toHaveTextContent(
      "Vrushabh Vasoya",
    );
    const english = screen.getByRole("region", { name: "English text" });
    expect(
      within(english).getByText(
        "There is no English text. Readers of English will see the German text.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the page settings", () => {
  const openSettings = async (name: string, permissions?: string[]) => {
    const view = renderPanel(<LegalView />, { permissions });
    const section = await screen.findByRole("region", { name });
    await view.user.click(
      within(section).getByRole("button", { name: "Page settings" }),
    );
    const dialog = await screen.findByRole("dialog");
    return { ...view, section, dialog };
  };
  const fields = (dialog: HTMLElement) => {
    const [addressEn, titleEn, descriptionEn] = within(dialog).getAllByRole(
      "textbox",
      { name: EN },
    );
    const [addressDe, titleDe, descriptionDe] = within(dialog).getAllByRole(
      "textbox",
      { name: DE },
    );
    return {
      addressEn: addressEn!,
      addressDe: addressDe!,
      titleEn: titleEn!,
      titleDe: titleDe!,
      descriptionEn: descriptionEn!,
      descriptionDe: descriptionDe!,
    };
  };

  it("saves the address and the search-engine texts as the whole page, without a new version", async () => {
    const versions = api.mock.db().legal.length;
    const { user, dialog } = await openSettings("Shipping information");
    expect(
      within(dialog).getByRole("heading", {
        name: "Page settings: Shipping information",
      }),
    ).toBeInTheDocument();
    const field = fields(dialog);
    // An empty field means the default, which is what it shows.
    expect(field.addressEn).toHaveValue("");
    expect(field.addressEn).toHaveAttribute("placeholder", "shipping");
    expect(field.addressDe).toHaveAttribute("placeholder", "versand");
    expect(field.titleEn).toHaveAttribute(
      "placeholder",
      "Shipping Information",
    );
    expect(field.titleDe).toHaveAttribute(
      "placeholder",
      "Versandinformationen",
    );
    expect(dialog).toHaveTextContent(
      "Changing the address changes the link of the page at once. Links to the old address stop working.",
    );

    await user.type(field.addressDe, "versandinformationen");
    expect(
      within(dialog).getByText(
        "http://localhost:3001/de/rechtliches/versandinformationen",
      ),
    ).toBeInTheDocument();
    await user.type(field.titleEn, "Shipping | Radhe Foods");
    await user.type(field.descriptionDe, "So liefern wir.");
    await user.click(
      within(dialog).getByRole("button", { name: "Save the page" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/legal-documents/pages/shipping",
      body: {
        slug: { de: "versandinformationen" },
        seo: {
          title: { en: "Shipping | Radhe Foods" },
          description: { de: "So liefern wir." },
        },
      },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const section = screen.getByRole("region", {
      name: "Shipping information",
    });
    expect(
      await within(section).findByText(
        "http://localhost:3001/de/rechtliches/versandinformationen",
      ),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("Own title or description"),
    ).toBeInTheDocument();
    // The page is no version of the text.
    expect(api.mock.db().legal).toHaveLength(versions);
  });

  it("goes back to the defaults", async () => {
    api.mock.db().legalPages.imprint = {
      slug: { en: "about-us" },
      seo: { title: { en: "About us | Radhe Foods" } },
      updatedAt: new Date().toISOString(),
    };
    const { user, dialog, section } = await openSettings("Imprint");
    // The page behind the dialog shows the address that applies now.
    expect(
      within(section).getByText("http://localhost:3001/en/legal/about-us"),
    ).toBeInTheDocument();
    const field = fields(dialog);
    expect(field.addressEn).toHaveValue("about-us");
    expect(field.titleEn).toHaveValue("About us | Radhe Foods");

    await user.click(
      within(dialog).getByRole("button", { name: "Back to the defaults" }),
    );
    expect(field.addressEn).toHaveValue("");
    expect(field.titleEn).toHaveValue("");
    expect(
      within(dialog).getByText("http://localhost:3001/en/legal/imprint"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Save the page" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/legal-documents/pages/imprint",
      body: {},
    });
    expect(api.mock.db().legalPages.imprint?.slug).toBeUndefined();
    expect(api.mock.db().legalPages.imprint?.seo).toBeUndefined();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await within(section).findByRole("link", {
        name: /\/en\/legal\/imprint/,
      }),
    ).toBeInTheDocument();
  });

  it("shows an address that belongs to another page at its field", async () => {
    const { user, dialog, unhandled } = await openSettings("Imprint");
    const field = fields(dialog);
    await user.type(field.addressDe, "agb");
    await user.click(
      within(dialog).getByRole("button", { name: "Save the page" }),
    );

    expect(
      await within(dialog).findByText(
        "This address belongs to the page Terms and conditions.",
      ),
    ).toBeInTheDocument();
    expect(field.addressDe).toHaveAttribute("aria-invalid", "true");
    expect(field.addressEn).not.toHaveAttribute("aria-invalid");
    // The dialog stays open, and the page keeps its address.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.mock.db().legalPages.imprint).toBeUndefined();
    expect(unhandled).toHaveLength(0);
  });

  it("checks the address before anything is sent", async () => {
    const { user, dialog } = await openSettings("Refund policy");
    const field = fields(dialog);
    await user.type(field.addressEn, "Refund Policy");
    await user.click(
      within(dialog).getByRole("button", { name: "Save the page" }),
    );
    expect(
      await within(dialog).findByText(
        /Lower-case letters, digits and single hyphens only/,
      ),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("sends nothing when nothing changed", async () => {
    const { user, dialog } = await openSettings("Privacy policy");
    await user.click(
      within(dialog).getByRole("button", { name: "Save the page" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(0);
  });
});

describe("a draft", () => {
  it("saves only what changed", async () => {
    const draft = record("terms", 3);
    const { user } = openDocument(draft);
    const [title] = await screen.findAllByRole("textbox", { name: EN });
    expect(
      screen.getByRole("button", { name: "Save the draft" }),
    ).toBeDisabled();
    await user.type(title!, " of Sale");
    await user.click(screen.getByRole("button", { name: "Save the draft" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/legal-documents/${draft.id}`,
      body: {
        title: {
          en: "Terms and Conditions of Sale",
          de: "Allgemeine Geschäftsbedingungen",
        },
      },
    });
    expect(record("terms", 3).status).toBe("draft");
  });

  it("clears a language by leaving it out", async () => {
    const draft = record("terms", 3);
    const english = draft.content.en;
    const { user } = openDocument(draft);
    const german = (await screen.findAllByRole("textbox", { name: DE }))[1]!;
    await user.clear(german);
    // The missing language is marked at once.
    expect(screen.getByText("German is missing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the draft" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({ content: { en: english } });
    expect(record("terms", 3).content.de).toBeUndefined();
  });

  it("publishes after a confirmation that says what it means", async () => {
    const draft = record("terms", 3);
    const { user } = openDocument(draft);
    await user.click(await screen.findByRole("button", { name: "Publish" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Publish version 3 of the terms?",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Customers accept this version from now on",
    );
    expect(dialog).toHaveTextContent("A published version can never change");
    expect(within(dialog).getByText("Replaces").nextSibling).toHaveTextContent(
      /^Version 2/,
    );
    expect(within(dialog).getByText("Languages").nextSibling).toHaveTextContent(
      "English and German",
    );
    expect(writes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Publish version 3" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/legal-documents/${draft.id}/publish`,
        body: undefined,
      },
    ]);
    expect(record("terms", 3).status).toBe("published");
    // The page now shows the published version: nothing left to edit.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save the draft" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("textbox", { name: EN })).not.toBeInTheDocument();
    expect(
      screen.getByText("Published", { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("does not publish over changes that are not saved", async () => {
    const draft = record("terms", 3);
    const { user } = openDocument(draft);
    const [title] = await screen.findAllByRole("textbox", { name: EN });
    await user.type(title!, "!");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(
      screen.getByLabelText("Save your changes first."),
    ).toBeInTheDocument();
  });

  it("offers to publish a draft that has its text in one language", async () => {
    const draft = record("terms", 3);
    draft.content = { de: draft.content.de };
    const { user } = openDocument(draft);
    const publish = await screen.findByRole("button", { name: "Publish" });
    expect(publish).toBeEnabled();
    expect(
      screen.getByText(
        /Only the German text is written\. Readers of the other language will see this text\./,
      ),
    ).toBeInTheDocument();
    await user.click(publish);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Languages").nextSibling).toHaveTextContent(
      "German only: readers of the other language will see this text",
    );
  });

  it("does not offer to publish a draft without any text", async () => {
    const draft = record("terms", 3);
    draft.content = {};
    openDocument(draft);
    expect(
      await screen.findByRole("button", { name: "Publish" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        "The text is needed, in English or German, to publish.",
      ),
    ).toBeInTheDocument();
  });

  it("explains the API's refusal when the text is missing after all", async () => {
    const draft = record("terms", 3);
    const { user, unhandled } = openDocument(draft);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    // Another admin emptied the text in the meantime.
    draft.content = {};
    await user.click(
      within(dialog).getByRole("button", { name: "Publish version 3" }),
    );

    expect(
      await screen.findByText("This version cannot be published yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A legal text needs its text, in English or German, before it is published/,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(record("terms", 3).status).toBe("draft");
    expect(unhandled).toHaveLength(0);
  });

  it("deletes the draft after a confirmation and goes back to the list", async () => {
    const draft = record("terms", 3);
    const { user } = openDocument(draft);
    await user.click(
      await screen.findByRole("button", { name: "Delete the draft" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Delete the draft of version 3?",
      }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the draft" }),
    );

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/legal-documents/${draft.id}`,
          body: undefined,
        },
      ]),
    );
    expect(api.mock.db().legal.some((entry) => entry.id === draft.id)).toBe(
      false,
    );
    await waitFor(() =>
      expect(testNavigation.history).toContain("/settings/legal"),
    );
  });

  it("says so when the version was published by someone else meanwhile", async () => {
    const draft = record("terms", 3);
    const { user, unhandled } = openDocument(draft);
    const [title] = await screen.findAllByRole("textbox", { name: EN });
    await user.type(title!, " (new)");
    // Another admin publishes the version while this one is typing.
    draft.status = "published";
    draft.publishedAt = new Date().toISOString();
    await user.click(screen.getByRole("button", { name: "Save the draft" }));

    expect(
      await screen.findByText(
        "A published version can never change. Create a new version instead.",
      ),
    ).toBeInTheDocument();
    // What was typed is still there to be copied.
    expect(title).toHaveValue("Terms and Conditions (new)");
    expect(unhandled).toHaveLength(0);
  });

  it("previews the text as customers read it", async () => {
    const draft = record("terms", 3);
    const { user } = openDocument(draft);
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    const english = await screen.findByRole("region", { name: "English text" });
    expect(
      within(english).getByRole("heading", {
        level: 1,
        name: "Terms and Conditions",
      }),
    ).toBeInTheDocument();
    expect(
      within(english).getByText(
        "The order is confirmed once your payment is captured.",
      ).tagName,
    ).toBe("STRONG");
  });

  it("is read-only for an admin who may not manage legal texts", async () => {
    const draft = record("terms", 3);
    openDocument(draft, ["legal.read"]);
    expect(
      await screen.findByRole("heading", {
        name: "Terms and conditions, version 3",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save the draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New version" })).toBeDisabled();
  });
});

describe("a published version", () => {
  it("is shown as text, with nothing to edit", async () => {
    const published = record("terms", 2);
    openDocument(published);
    expect(
      await screen.findByRole("heading", {
        name: "Terms and conditions, version 2",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(
      screen.getByText(/A published version can never change/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Publish|Delete|Save/ }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("compares with the version before, per language, as one text or side by side", async () => {
    const published = record("terms", 2);
    const { user } = openDocument(published);
    await user.click(
      await screen.findByRole("tab", { name: "Changes since version 1" }),
    );

    // Version 2 added the clause about the PDF, and counts as "2".
    expect(await screen.findByText(/words? added/)).toBeInTheDocument();
    const added = document.querySelectorAll("ins");
    const removed = document.querySelectorAll("del");
    expect([...added].map((node) => node.textContent).join("")).toContain(
      ", as a PDF",
    );
    expect([...removed].map((node) => node.textContent).join("")).toContain(
      "1",
    );
    expect(
      screen.getByRole("combobox", { name: "Compare with" }),
    ).toHaveDisplayValue(/^Version 1/);

    await user.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByText(/^Version 1, published/)).toBeInTheDocument();
    expect(screen.getByText(/^Version 2, published/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "German" }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("ins")]
          .map((node) => node.textContent)
          .join(""),
      ).toContain(", als PDF"),
    );
  });

  it("marks a language that is missing in the comparison", async () => {
    const published = record("terms", 2);
    published.content = { en: published.content.en };
    const { user } = openDocument(published);
    // In the text itself …
    const german = await screen.findByRole("region", { name: "German text" });
    expect(within(german).getByText("Missing")).toBeInTheDocument();
    // … and in the comparison.
    await user.click(
      screen.getByRole("tab", { name: "Changes since version 1" }),
    );
    await user.click(await screen.findByRole("button", { name: /German/ }));
    expect(
      await screen.findByText("German is missing in version 2"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Version 1 had a German text: all of it shows as removed.",
      ),
    ).toBeInTheDocument();
  });

  it("says that the first version has nothing to compare with", async () => {
    const first = record("privacy", 1);
    const { user } = openDocument(first);
    await user.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(
      await screen.findByText("Nothing to compare with yet"),
    ).toBeInTheDocument();
  });

  it("explains a version that does not exist", async () => {
    renderPanel(<LegalDocumentView />, {
      params: { id: "0123456789abcdef01234567" },
    });
    expect(
      await screen.findByText("This legal text does not exist"),
    ).toBeInTheDocument();
  });
});

describe("the Markdown preview", () => {
  it("renders Markdown and drops raw HTML, so that nothing pasted can run", () => {
    const { container } = render(
      <MarkdownText>
        {[
          "# Privacy",
          "",
          "<script>window.hacked = true</script>",
          "",
          '<img src="x" onerror="window.hacked = true">',
          "",
          '<a href="https://example.com" onclick="window.hacked = true">raw link</a>',
          "",
          "A **bold** word and a [link](https://www.radhefoods.de).",
          "",
          "[bad link](javascript:alert(1))",
          "",
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n")}
      </MarkdownText>,
    );
    expect(container.querySelector("h1")).toHaveTextContent("Privacy");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://www.radhefoods.de",
      "",
    ]);
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });
});
