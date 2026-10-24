// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Faq, FaqGroup, FaqGroupList, ListResult } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { FaqView } from "./faq-view";

let api: TestApi;
let groups: FaqGroup[];
let faqs: Faq[];

const writes = () => api.calls.filter((call) => call.method !== "GET");

const group = (name: string) => {
  const found = groups.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No group "${name}" in the demo data`);
  return found;
};
const inGroup = (id: string | null) =>
  faqs
    .filter((faq) => faq.groupId === id)
    .sort((a, b) => a.sortOrder - b.sortOrder);

const questionsOf = async (name: string) =>
  within(
    await screen.findByRole("list", { name: `Questions of ${name}` }),
  ).getAllByRole("listitem");

function field(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  groups = (await api.request<FaqGroupList>("GET", "/v1/admin/faq-groups"))
    .items;
  faqs = (await api.request<ListResult<Faq>>("GET", "/v1/admin/faqs")).items;
  api.calls.length = 0;
});

describe("the FAQ page", () => {
  it("lists the groups in order with their questions, the hidden group marked, then the questions without a group", async () => {
    renderPanel(<FaqView />, { path: "/content/faq" });
    const sections = within(
      await screen.findByRole("list", { name: "FAQ groups in display order" }),
    ).getAllByRole("heading", { level: 2 });
    expect(sections.map((heading) => heading.textContent)).toEqual(
      groups.map((entry) => entry.name.en),
    );
    const orders = await questionsOf("Orders");
    expect(orders.map((row) => row.textContent)).toEqual(
      inGroup(group("Orders").id).map((faq) =>
        expect.stringContaining(faq.question.en),
      ),
    );
    // The draft question is marked, the published ones too.
    const draft = inGroup(group("Orders").id).find((faq) => !faq.isPublished)!;
    expect(
      orders.find((row) => row.textContent?.includes(draft.question.en)),
    ).toHaveTextContent("Draft");
    expect(orders[0]).toHaveTextContent("Published");
    // The hidden group says so.
    const payment = group("Payment");
    expect(payment.isVisible).toBe(false);
    expect(
      screen.getByRole("heading", { name: payment.name.en }).parentElement,
    ).toHaveTextContent("Hidden in the shop");
    // The questions without a group come last.
    const loose = await questionsOf("the questions without a group");
    expect(loose).toHaveLength(inGroup(null).length);
    expect(loose[0]).toHaveTextContent("Do you have a shop in Frankfurt?");
  });

  it("creates a question in a group, in both languages, published; it goes last in the group", async () => {
    const delivery = group("Delivery");
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Delivery");
    const section = screen
      .getByRole("heading", { name: "Delivery" })
      .closest("li")!;
    await user.click(
      within(section).getByRole("button", { name: "Add question" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Group" })).toHaveValue(
      delivery.id,
    );
    await user.type(field("question.en"), "Do you deliver to Austria?");
    await user.type(field("answer.en"), "Not yet. **Germany only** for now.");
    await user.click(within(dialog).getByRole("tab", { name: "German" }));
    await user.type(field("question.de"), "Liefert ihr nach Österreich?");
    await user.type(field("answer.de"), "Noch nicht.");
    await user.click(
      within(dialog).getByRole("switch", { name: "Not published" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create question" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/admin/faqs",
          body: {
            question: {
              en: "Do you deliver to Austria?",
              de: "Liefert ihr nach Österreich?",
            },
            answer: {
              en: "Not yet. **Germany only** for now.",
              de: "Noch nicht.",
            },
            groupId: delivery.id,
            isPublished: true,
          },
        },
      ]),
    );
    expect(await screen.findByText("Question created")).toBeInTheDocument();
    await waitFor(async () => {
      const rows = await questionsOf("Delivery");
      expect(rows[rows.length - 1]).toHaveTextContent(
        "Do you deliver to Austria?",
      );
    });
    const stored = api.mock
      .db()
      .faqs.find((faq) => faq.question.en === "Do you deliver to Austria?")!;
    expect(stored.sortOrder).toBe(inGroup(delivery.id).length);
    expect(stored.publishedAt).not.toBeNull();
  });

  it("refuses a question without its English text before anything is sent", async () => {
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    await user.click(screen.getByRole("button", { name: "New question" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "German" }));
    await user.type(field("question.de"), "Nur Deutsch");
    await user.click(
      within(dialog).getByRole("button", { name: "Create question" }),
    );
    expect(
      await screen.findByText("The English question is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The English answer is required."),
    ).toBeInTheDocument();
    // The English tab is opened to show where the problem is.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("tab", { name: /English/ }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(writes()).toEqual([]);
  });

  it("publishes a question with its switch", async () => {
    const draft = inGroup(group("Orders").id).find((faq) => !faq.isPublished)!;
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    await user.click(
      screen.getByRole("switch", { name: `${draft.question.en} is published` }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/faqs/${draft.id}`,
          body: { isPublished: true },
        },
      ]),
    );
    expect(await screen.findByText("Question published")).toBeInTheDocument();
    expect(
      api.mock.db().faqs.find((faq) => faq.id === draft.id)?.publishedAt,
    ).not.toBeNull();
  });

  it("moves a question within its group and sends the group's complete list", async () => {
    const orders = group("Orders");
    const before = inGroup(orders.id);
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    await user.click(
      screen.getByRole("button", {
        name: `Actions for ${before[0]!.question.en}`,
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move down" }),
    );
    const expected = [
      before[1]!.id,
      before[0]!.id,
      ...before.slice(2).map((f) => f.id),
    ];
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/faqs/order",
          body: { groupId: orders.id, orderedIds: expected },
        },
      ]),
    );
    await waitFor(async () => {
      const rows = await questionsOf("Orders");
      expect(rows[0]).toHaveTextContent(before[1]!.question.en);
      expect(rows[1]).toHaveTextContent(before[0]!.question.en);
    });
    expect(
      api.mock
        .db()
        .faqs.filter((faq) => faq.groupId === orders.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((faq) => faq.id),
    ).toEqual(expected);
  });

  it("moves a group and sends every group once", async () => {
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    await user.click(
      screen.getByRole("button", { name: "Actions for the group Delivery" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move up" }));
    const ids = groups.map((entry) => entry.id);
    const expected = [ids[1], ids[0], ...ids.slice(2)];
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/faq-groups/order",
          body: { orderedIds: expected },
        },
      ]),
    );
    await waitFor(() => {
      const headings = within(
        screen.getByRole("list", { name: "FAQ groups in display order" }),
      ).getAllByRole("heading", { level: 2 });
      expect(headings[0]).toHaveTextContent("Delivery");
      expect(headings[1]).toHaveTextContent("Orders");
    });
  });

  it("cannot delete a group with questions, and deletes an empty one after asking", async () => {
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    await user.click(
      screen.getByRole("button", { name: "Actions for the group Orders" }),
    );
    const blocked = await screen.findByRole("menuitem", { name: /Delete/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent("Move or delete its questions first");
    await user.keyboard("{Escape}");

    // A new group has no questions and can go.
    await user.click(screen.getByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(field("name.en"), "Account");
    await user.click(
      within(dialog).getByRole("button", { name: "Create group" }),
    );
    expect(await screen.findByText("Account created")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Account" });
    await user.click(
      screen.getByRole("button", { name: "Actions for the group Account" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(
      await screen.findByRole("button", { name: "Delete the group" }),
    );
    expect(await screen.findByText("Account deleted")).toBeInTheDocument();
    const created = writes().find((call) => call.method === "POST")!;
    expect(created.body).toEqual({
      name: { en: "Account", de: null },
      isVisible: true,
    });
    expect(writes().some((call) => call.method === "DELETE")).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("is read-only for an admin with content.read", async () => {
    renderPanel(<FaqView />, {
      path: "/content/faq",
      permissions: ["content.read"],
    });
    await questionsOf("Orders");
    for (const toggle of screen.getAllByRole("switch", {
      name: /is published$/,
    })) {
      expect(toggle).toBeDisabled();
    }
    expect(
      screen.queryByRole("button", { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Move / }),
    ).not.toBeInTheDocument();
    // Both buttons of the header stay visible, disabled, and say what is missing.
    expect(
      screen.getAllByLabelText('Your role does not include "Content: manage".'),
    ).toHaveLength(2);
  });

  it("loads the list again when the group changed in the meantime", async () => {
    const orders = group("Orders");
    const before = inGroup(orders.id);
    const { user } = renderPanel(<FaqView />, { path: "/content/faq" });
    await questionsOf("Orders");
    // Another admin deletes a question while the page is open.
    await api.request("DELETE", `/v1/admin/faqs/${before[0]!.id}`);
    api.calls.length = 0;
    await user.click(
      screen.getByRole("button", {
        name: `Actions for ${before[0]!.question.en}`,
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move down" }),
    );
    expect(
      await screen.findByText(
        "The questions of this group changed in the meantime. The list was loaded again.",
      ),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(await questionsOf("Orders")).toHaveLength(before.length - 1),
    );
  });
});
