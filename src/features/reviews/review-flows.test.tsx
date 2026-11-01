// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewRecord } from "../../../mocks/modules/accounts.ts";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { ReviewView } from "./review-view";
import { ReviewsView } from "./reviews-view";
import { reviewProductName, reviewTitle } from "./rules";

let api: TestApi;

const reviews = () => api.mock.db().reviews;
const byStatus = (status: ReviewRecord["status"]) => {
  const found = reviews().find((entry) => entry.status === status);
  if (!found) throw new Error(`No ${status} review in the demo data`);
  return found;
};
const stored = (id: string) => reviews().find((entry) => entry.id === id);
const writes = () => api.calls.filter((call) => call.method !== "GET");

async function open(review: ReviewRecord, permissions?: string[]) {
  const view = renderPanel(<ReviewView />, {
    path: `/reviews/${review.id}`,
    params: { id: review.id },
    permissions,
  });
  await screen.findByRole("heading", { level: 1, name: reviewTitle(review) });
  api.calls.length = 0;
  return view;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the list of reviews", () => {
  it("starts on what waits, shows the product with its stars, and can show all", async () => {
    const { user } = renderPanel(<ReviewsView />, { path: "/reviews" });
    const pending = reviews().filter((entry) => entry.status === "pending");
    expect(
      await screen.findByText(`${pending.length} reviews, that is all`),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/reviews?status=pending&limit=25",
    );
    const table = screen.getByRole("table", { name: "Reviews, newest first" });
    const first = pending[0]!;
    const row = within(table)
      .getByRole("link", {
        name: first.title ?? `${first.rating} of 5 stars`,
      })
      .closest("tr")!;
    expect(
      within(row).getByRole("link", {
        name: reviewProductName(first.product),
      }),
    ).toHaveAttribute("href", `/catalogue/products/${first.productId}`);
    expect(
      within(row).getByRole("img", {
        name: `Rating: ${first.rating} of 5 stars`,
      }),
    ).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Status/ }));
    await user.click(await screen.findByRole("menuitem", { name: "All" }));
    expect(
      await screen.findByText(`${reviews().length} reviews, that is all`),
    ).toBeInTheDocument();
    expect(testNavigation.location).toBe("/reviews?status=all");
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/reviews?limit=25",
    );
  });

  it("filters by rating with the API's parameter", async () => {
    renderPanel(<ReviewsView />, { path: "/reviews?status=all&rating=5" });
    const fives = reviews().filter((entry) => entry.rating === 5);
    expect(
      await screen.findByText(`${fives.length} reviews, that is all`),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/reviews?rating=5&limit=25",
    );
  });
});

describe("deciding on a review", () => {
  it("publishes a pending review and shows it as published", async () => {
    const review = byStatus("pending");
    const { user } = await open(review);
    expect(screen.getByText("Waiting for your decision")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Publish this review?" }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Publish the review" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/reviews/${review.id}/approve`,
        body: undefined,
      },
    ]);
    expect(stored(review.id)?.status).toBe("published");
    await waitFor(() =>
      expect(screen.getAllByText("Published").length).toBeGreaterThan(0),
    );
    // Published: it can be taken off, not published again.
    expect(
      screen.getByRole("button", { name: "Take off the shop" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish" }),
    ).not.toBeInTheDocument();
  });

  it("needs a note to reject, and sends it", async () => {
    const review = byStatus("pending");
    const { user } = await open(review);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Reject the review",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Note to the customer/ }),
      "Please leave out the name of the delivery person.",
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/reviews/${review.id}/reject`,
          body: { note: "Please leave out the name of the delivery person." },
        },
      ]),
    );
    expect(stored(review.id)?.status).toBe("rejected");
    expect(stored(review.id)?.moderation?.note).toBe(
      "Please leave out the name of the delivery person.",
    );
    expect(
      await screen.findByText(/The customer was told: /),
    ).toBeInTheDocument();
  });

  it("answers in public, replaces the answer and removes it", async () => {
    const review = byStatus("published");
    const { user } = await open(review);
    const field = screen.getByRole("textbox", { name: /^Answer/ });
    await user.clear(field);
    await user.type(field, "Thank you, we are glad you liked it.");
    await user.click(
      screen.getByRole("button", {
        name: review.reply ? "Replace the answer" : "Publish the answer",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/reviews/${review.id}/reply`,
          body: { text: "Thank you, we are glad you liked it." },
        },
      ]),
    );
    expect(stored(review.id)?.reply?.text).toBe(
      "Thank you, we are glad you liked it.",
    );
    expect(
      await screen.findByRole("button", { name: "Remove the answer" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove the answer" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove the answer" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({
      method: "DELETE",
      path: `/v1/admin/reviews/${review.id}/reply`,
      body: undefined,
    });
    expect(stored(review.id)?.reply).toBeNull();
  });

  it("deletes a review after the word is typed, and goes back to the list", async () => {
    const review = byStatus("rejected");
    const { user } = await open(review);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Delete the review",
    });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "DELETE");
    await user.click(confirm);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/reviews/${review.id}`,
          body: undefined,
        },
      ]),
    );
    expect(stored(review.id)).toBeUndefined();
    await waitFor(() => expect(testNavigation.location).toBe("/reviews"));
  });

  it("keeps every action visible but disabled for a reader", async () => {
    const review = byStatus("pending");
    await open(review, ["reviews.read"]);
    for (const name of ["Publish", "Reject", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(
      screen.queryByRole("textbox", { name: /^Answer/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No answer was given.")).toBeInTheDocument();
  });
});
