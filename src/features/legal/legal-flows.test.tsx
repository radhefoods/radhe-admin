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
    expect(rows[1]).toHaveTextContent("Payment deadline clarified");
    expect(rows[2]).not.toHaveTextContent("Current");
    expect(
      within(terms).getByText(/Customers accept version 2\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Pre-order terms" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Privacy policy" }),
    ).toBeInTheDocument();
    // Terms and privacy are published: nothing blocks orders.
    expect(screen.queryByText(/Orders are refused/)).not.toBeInTheDocument();
  });

  it("warns while a required text has no published version", async () => {
    const privacy = record("privacy", 1);
    privacy.status = "draft";
    privacy.publishedAt = null;
    renderPanel(<LegalView />);
    expect(
      await screen.findByText(
        "Orders are refused: the privacy policy is not published",
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
      screen.getAllByLabelText(
        'Your role does not include "Legal texts: manage".',
      ),
    ).toHaveLength(3);
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

  it("does not offer to publish a draft without its English text", async () => {
    const draft = record("terms", 3);
    draft.content = { en: "", de: draft.content.de };
    openDocument(draft);
    expect(
      await screen.findByRole("button", { name: "Publish" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("The English text is needed to publish."),
    ).toBeInTheDocument();
  });

  it("explains the API's refusal when the English text is missing after all", async () => {
    const draft = record("terms", 3);
    const { user, unhandled } = openDocument(draft);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    // Another admin emptied the English text in the meantime.
    draft.content = { en: "", de: draft.content.de };
    await user.click(
      within(dialog).getByRole("button", { name: "Publish version 3" }),
    );

    expect(
      await screen.findByText("This version cannot be published yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A legal text needs its English text before it is published/,
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
      within(english).getByText("No payment is collected when you order.")
        .tagName,
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

    // Version 2 added the clause about the five days, and counts as "2".
    expect(await screen.findByText(/words? added/)).toBeInTheDocument();
    const added = document.querySelectorAll("ins");
    const removed = document.querySelectorAll("del");
    expect([...added].map((node) => node.textContent).join("")).toContain(
      "at the earliest five days after the invoice",
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
      ).toContain("frühestens fünf Tage nach der Rechnung"),
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
