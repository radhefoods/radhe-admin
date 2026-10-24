// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  BlogCategoryList,
  BlogPostSummary,
  PageResult,
} from "@/lib/api/types";
import { berlinToIso } from "@/lib/format/dates";
import { installTestApi, type TestApi } from "@/test/api";
import { png } from "@/test/png";
import { renderPanel, testNavigation } from "@/test/render";
import { installUpload } from "@/test/upload";
import type { SizeReader } from "@/features/catalogue/image-rules";
import { BlogCategoriesView } from "./categories-view";
import { PostNewView } from "./post-new-view";
import { PostView } from "./post-view";
import { PostsView } from "./posts-view";

let api: TestApi;
let posts: BlogPostSummary[];
let categories: BlogCategoryList;

const writes = () => api.calls.filter((call) => call.method !== "GET");
const picture = (name: string, width: number, height: number) =>
  new File([new Uint8Array(png(width, height))], name, { type: "image/png" });
/** Tests have no decoder: the API checks the size. */
const unknownSize: SizeReader = async () => "unknown";

const postNamed = (title: string) => {
  const found = posts.find((entry) => entry.title.en === title);
  if (!found) throw new Error(`No post "${title}" in the demo data`);
  return found;
};
const categoryNamed = (name: string) => {
  const found = categories.items.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No category "${name}" in the demo data`);
  return found;
};

function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

function renderPost(id: string, permissions?: string[]) {
  return renderPanel(<PostView readSize={unknownSize} />, {
    path: `/content/blog/${id}`,
    params: { id },
    permissions,
  });
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  posts = (
    await api.request<PageResult<BlogPostSummary>>(
      "GET",
      "/v1/admin/blog-posts?limit=100",
    )
  ).items;
  categories = await api.request<BlogCategoryList>(
    "GET",
    "/v1/admin/blog-categories",
  );
  api.calls.length = 0;
});

describe("the list of posts", () => {
  it("shows every post with how the shop sees it, and filters and sorts through the API", async () => {
    const { user } = renderPanel(<PostsView />, { path: "/content/blog" });
    const table = await screen.findByRole("table", {
      name: "Posts of the blog",
    });
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(posts.length + 1),
    );
    const row = (title: string) =>
      within(table).getByRole("link", { name: title }).closest("tr")!;
    expect(row("Diwali sweets: a short guide")).toHaveTextContent("Scheduled");
    expect(row("How we choose our spices")).toHaveTextContent("Draft");
    expect(row("The perfect dal")).toHaveTextContent("Published");
    expect(row("The perfect dal")).toHaveTextContent("Recipes");

    await user.click(screen.getByRole("button", { name: /^Status/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Draft" }));
    expect(testNavigation.location).toBe("/content/blog?status=draft");
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(
        posts.filter((post) => post.status === "draft").length + 1,
      ),
    );
    expect(
      api.calls.some((call) =>
        call.path.startsWith("/v1/admin/blog-posts?status=draft"),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Sort/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Title A to Z" }),
    );
    expect(testNavigation.location).toBe(
      "/content/blog?status=draft&sort=title",
    );
    await waitFor(() =>
      expect(api.calls.some((call) => call.path.includes("sort=title"))).toBe(
        true,
      ),
    );
  });
});

describe("a new post", () => {
  it("is created from its English title and text, in a category, with tags, and opens on its page", async () => {
    const recipes = categoryNamed("Recipes");
    const { user } = renderPanel(<PostNewView />, {
      path: "/content/blog/new",
    });
    await screen.findByRole("heading", { name: "New post" });
    await user.type(field("title.en"), "Roti, the second try");
    await user.type(
      field("content.en"),
      "# Roti{enter}{enter}Flour, water, salt.",
    );
    await user.selectOptions(field("categoryId"), recipes.id);
    const tags = screen.getByRole("textbox", { name: /Tags/ });
    await user.type(tags, "Recipes,bread{enter}");
    await user.click(screen.getByRole("button", { name: "Create post" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/admin/blog-posts",
          body: {
            title: { en: "Roti, the second try", de: null },
            content: { en: "# Roti\n\nFlour, water, salt.", de: null },
            authorName: "Test Admin",
            categoryId: recipes.id,
            tags: ["recipes", "bread"],
          },
        },
      ]),
    );
    const created = api.mock
      .db()
      .blogPosts.find((post) => post.title.en === "Roti, the second try")!;
    expect(created.status).toBe("draft");
    expect(created.slug.en).toBe("roti-the-second-try");
    await waitFor(() =>
      expect(testNavigation.history).toEqual([`/content/blog/${created.id}`]),
    );
  });

  it("refuses to leave without the English title, and points at the English tab", async () => {
    const { user } = renderPanel(<PostNewView />, {
      path: "/content/blog/new",
    });
    await screen.findByRole("heading", { name: "New post" });
    await user.click(screen.getByRole("tab", { name: "German" }));
    await user.type(field("title.de"), "Nur Deutsch");
    await user.click(screen.getByRole("button", { name: "Create post" }));
    expect(
      await screen.findByText("The English title is required."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /English/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(writes()).toEqual([]);
  });
});

describe("an existing post", () => {
  it("saves only what changed", async () => {
    const dal = postNamed("The perfect dal");
    const { user } = renderPost(dal.id);
    await screen.findByRole("heading", { name: "The perfect dal" });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "German" }));
    const title = field("title.de");
    await user.clear(title);
    await user.type(title, "Das beste Dal");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/blog-posts/${dal.id}`,
          body: { title: { en: "The perfect dal", de: "Das beste Dal" } },
        },
      ]),
    );
    expect(await screen.findByText("Post saved")).toBeInTheDocument();
  });

  it("marks the slug when the API says another post has it", async () => {
    const dal = postNamed("The perfect dal");
    const basmati = postNamed("Basmati, and why the age matters");
    const { user } = renderPost(dal.id);
    await screen.findByRole("heading", { name: "The perfect dal" });
    const slug = field("slug.en");
    await user.clear(slug);
    await user.type(slug, basmati.slug.en);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Another post already uses this address (slug)."),
    ).toBeInTheDocument();
    expect(slug).toHaveAttribute("aria-invalid", "true");
  });

  it("publishes a draft now, and schedules it again for a future date", async () => {
    const spices = postNamed("How we choose our spices");
    const { user } = renderPost(spices.id);
    const publishing = await screen.findByRole("region", {
      name: "Publishing",
    });
    expect(within(publishing).getByText("Draft")).toBeInTheDocument();
    await user.click(
      within(publishing).getByRole("button", { name: "Publish" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Publish now" }),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `POST /v1/admin/blog-posts/${spices.id}/publish`,
      ]),
    );
    const sent = writes()[0]!.body as { publishedAt: string };
    expect(Math.abs(Date.parse(sent.publishedAt) - Date.now())).toBeLessThan(
      60_000,
    );
    expect(await screen.findByText("Post published")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(publishing).getByText("Published")).toBeInTheDocument(),
    );

    // A date in the future schedules the post.
    api.calls.length = 0;
    await user.click(
      within(publishing).getByRole("button", { name: "Change the date" }),
    );
    const again = await screen.findByRole("alertdialog");
    await user.click(within(again).getByRole("radio", { name: /On a date/ }));
    const when = "2027-01-15T09:30";
    fireEvent.change(
      within(again).getByLabelText("Date and time of the article"),
      {
        target: { value: when },
      },
    );
    await user.click(within(again).getByRole("button", { name: "Schedule" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/blog-posts/${spices.id}/publish`,
          body: { publishedAt: berlinToIso(when) },
        },
      ]),
    );
    await waitFor(() =>
      expect(within(publishing).getByText("Scheduled")).toBeInTheDocument(),
    );
  });

  it("cannot publish without the English text, and the API refuses it too", async () => {
    const roti = postNamed("Roti for beginners");
    renderPost(roti.id);
    const publishing = await screen.findByRole("region", {
      name: "Publishing",
    });
    expect(
      within(publishing).getByLabelText(
        "The English text is needed to publish.",
      ),
    ).toBeInTheDocument();
    await expect(
      api.request("POST", `/v1/admin/blog-posts/${roti.id}/publish`, {}),
    ).rejects.toThrow(/BLOG_POST_INCOMPLETE/);
  });

  it("takes a published post offline and keeps its date", async () => {
    const dal = postNamed("The perfect dal");
    const { user } = renderPost(dal.id);
    const publishing = await screen.findByRole("region", {
      name: "Publishing",
    });
    await user.click(
      within(publishing).getByRole("button", { name: "Unpublish" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Unpublish", hidden: false }),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `POST /v1/admin/blog-posts/${dal.id}/unpublish`,
      ]),
    );
    await waitFor(() =>
      expect(within(publishing).getByText("Draft")).toBeInTheDocument(),
    );
    expect(
      within(publishing).getByText(/Its date, .* is kept/),
    ).toBeInTheDocument();
    const stored = api.mock.db().blogPosts.find((post) => post.id === dal.id)!;
    expect(stored.status).toBe("draft");
    expect(stored.publishedAt).toBe(dal.publishedAt);
  });

  it("uploads the featured picture, refuses one that is too small, and saves its description", async () => {
    installUpload("works");
    const spices = postNamed("How we choose our spices");
    const { user } = renderPost(spices.id);
    const card = await screen.findByRole("region", {
      name: "Featured picture",
    });
    const input = within(card).getByLabelText("Choose the featured picture");

    await user.upload(input, picture("small.png", 600, 300));
    expect(
      await screen.findByText(
        "The picture is too small for a featured picture",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("img")).not.toBeInTheDocument();

    await user.upload(input, picture("cover.png", 1200, 600));
    expect(
      await screen.findByText("Featured picture added"),
    ).toBeInTheDocument();
    // The picture is there, with the facts of its stored form.
    expect(await within(card).findByText("Largest width")).toBeInTheDocument();
    expect(card.querySelector("img")).not.toBeNull();
    const stored = () =>
      api.mock.db().blogPosts.find((post) => post.id === spices.id)!
        .featuredImage!;
    expect(stored().sizes.large.width).toBe(1200);
    expect(stored().sizes.small.width).toBe(480);

    await user.type(field("alt.en"), "Whole spices on a tray");
    await user.click(
      within(card).getByRole("button", { name: "Save description" }),
    );
    await waitFor(() =>
      expect(writes().at(-1)).toEqual({
        method: "PATCH",
        path: `/v1/admin/blog-posts/${spices.id}/featured-image`,
        body: { alt: { en: "Whole spices on a tray", de: null } },
      }),
    );
    expect(stored().alt.en).toBe("Whole spices on a tray");
  });

  it("uploads pictures for the text, puts one into the Markdown at the cursor and removes one", async () => {
    installUpload("works");
    const spices = postNamed("How we choose our spices");
    const { user } = renderPost(spices.id);
    const card = await screen.findByRole("region", {
      name: "Pictures for the text",
    });
    await user.upload(
      within(card).getByLabelText("Choose pictures for the text"),
      [picture("one.png", 800, 600), picture("two.png", 640, 640)],
    );
    expect(await screen.findByText("2 pictures uploaded")).toBeInTheDocument();
    const list = await within(card).findByRole("list", {
      name: "Pictures of the post",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const post = api.mock
      .db()
      .blogPosts.find((entry) => entry.id === spices.id)!;
    expect(post.images).toHaveLength(2);
    // The record is live: the ids are kept before one picture goes.
    const imageIds = post.images.map((image) => image.id);

    const content = field("content.en") as unknown as HTMLTextAreaElement;
    content.focus();
    content.setSelectionRange(content.value.length, content.value.length);
    await user.click(
      within(list).getAllByRole("button", { name: "Insert into text" })[0]!,
    );
    const url = post.images[0]!.sizes.medium.url;
    await waitFor(() => expect(content.value).toContain(`![](${url})`));
    expect(screen.getByText("Changes are not saved yet.")).toBeInTheDocument();

    await user.click(
      within(list).getAllByRole("button", { name: "Remove this picture" })[1]!,
    );
    await user.click(
      await screen.findByRole("button", { name: "Remove the picture" }),
    );
    expect(await screen.findByText("Picture removed")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(1),
    );
    expect(
      writes().some(
        (call) =>
          call.method === "DELETE" &&
          call.path ===
            `/v1/admin/blog-posts/${spices.id}/images/${imageIds[1]}`,
      ),
    ).toBe(true);
  });

  it("is read-only for an admin with content.read", async () => {
    const dal = postNamed("The perfect dal");
    renderPost(dal.id, ["content.read"]);
    await screen.findByRole("heading", { name: "The perfect dal" });
    expect(field("title.en")).toBeDisabled();
    // Every write button stays visible, disabled, and says what is missing.
    expect(
      screen.getAllByLabelText('Your role does not include "Content: manage".')
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Delete the post" }),
    ).not.toBeInTheDocument();
  });
});

describe("the categories of the blog", () => {
  it("lists them in order with their counts, moves one and sends every id", async () => {
    const { user } = renderPanel(<BlogCategoriesView />, {
      path: "/content/blog/categories",
    });
    const list = await screen.findByRole("list", {
      name: "Blog categories in display order",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(
      categories.items.map((category) =>
        expect.stringContaining(category.name.en),
      ),
    );
    const recipes = categoryNamed("Recipes");
    expect(rows[0]).toHaveTextContent(`${recipes.postCount} posts`);

    await user.click(
      screen.getByRole("button", { name: "Actions for Recipes" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move down" }),
    );
    const ids = categories.items.map((category) => category.id);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/blog-categories/order",
          body: { orderedIds: [ids[1], ids[0], ...ids.slice(2)] },
        },
      ]),
    );
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(
        "Recipes",
      ),
    );
  });

  it("cannot delete a category with posts; creates one and refuses a taken slug", async () => {
    const { user } = renderPanel(<BlogCategoriesView />, {
      path: "/content/blog/categories",
    });
    await screen.findByRole("list", {
      name: "Blog categories in display order",
    });
    await user.click(
      screen.getByRole("button", { name: "Actions for Recipes" }),
    );
    const blocked = await screen.findByRole("menuitem", { name: /Delete/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "New category" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(field("name.en"), "Festivals");
    await user.type(field("slug.en"), "recipes");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );
    expect(
      await screen.findByText(
        "Another blog category already uses this address (slug).",
      ),
    ).toBeInTheDocument();
    await user.clear(field("slug.en"));
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );
    expect(await screen.findByText("Festivals created")).toBeInTheDocument();
    const created = api.mock
      .db()
      .blogCategories.find((category) => category.name.en === "Festivals")!;
    expect(created.slug.en).toBe("festivals");
    expect(created.sortOrder).toBe(categories.items.length);
  });
});
