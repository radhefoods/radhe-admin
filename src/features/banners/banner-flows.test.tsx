// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Banner, ListResult } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format/dates";
import { installTestApi, type TestApi } from "@/test/api";
import { png } from "@/test/png";
import { renderPanel } from "@/test/render";
import { installUpload } from "@/test/upload";
import type { SizeReader } from "@/features/catalogue/image-rules";
import { BannersView } from "./banners-view";

let api: TestApi;
let banners: Banner[];

const READ_ONLY = ["catalog.read"];

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

/** A banner of the demo data by name. */
function banner(name: string): Banner {
  const found = banners.find((entry) => entry.name === name);
  if (!found) throw new Error(`No banner "${name}" in the demo data`);
  return found;
}

const stored = (id: string) =>
  api.mock.db().banners.find((entry) => entry.id === id);

/** A banner picture the API takes: a PNG of 2400 × 1000. */
const picture = (name: string, width = 2400, height = 1000) =>
  new File([new Uint8Array(png(width, height))], name, { type: "image/png" });
const sizeOf =
  (width: number, height: number): SizeReader =>
  async () => ({ width, height });
const okSize = sizeOf(2400, 1000);
/** The test cannot look inside a file: the API decides. */
const unknownSize: SizeReader = async () => "unknown";

function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

const rows = async () =>
  within(
    await screen.findByRole("list", { name: "Banners in display order" }),
  ).getAllByRole("listitem");

async function actionsFor(
  user: ReturnType<typeof renderPanel>["user"],
  name: string,
  action: string,
) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  banners = (await api.request<ListResult<Banner>>("GET", "/v1/admin/banners"))
    .items;
  api.calls.length = 0;
});

describe("the list of banners", () => {
  it("shows every banner in display order with its status, link, period and switch", async () => {
    renderPanel(<BannersView />);
    const items = await rows();
    expect(items.map((item) => item.textContent)).toEqual(
      banners.map((entry) => expect.stringContaining(entry.name ?? "")),
    );

    const diwali = banner("Diwali offer");
    const first = items[0]!;
    expect(within(first).getAllByText("Live")[0]).toBeInTheDocument();
    expect(first).toHaveTextContent(diwali.linkUrl ?? "");
    expect(first).toHaveTextContent(`Until ${formatDateTime(diwali.endsAt)}`);
    expect(
      within(first).getByRole("switch", {
        name: "Diwali offer is switched on",
      }),
    ).toBeChecked();

    const winter = banner("Winter warmers");
    const third = items[2]!;
    expect(within(third).getAllByText("Scheduled")[0]).toBeInTheDocument();
    expect(third).toHaveTextContent(
      `From ${formatDateTime(winter.startsAt)} until ${formatDateTime(winter.endsAt)}`,
    );

    const draft = items[3]!;
    expect(within(draft).getAllByText("Inactive")[0]).toBeInTheDocument();
    expect(draft).toHaveTextContent("No link");
    expect(draft).toHaveTextContent("Always");
    expect(draft).toHaveTextContent("No description");
    expect(
      within(draft).getByRole("switch", {
        name: "Fresh produce (draft) is switched on",
      }),
    ).not.toBeChecked();

    expect(screen.getByText(/4 banners of 20, 2 live\./)).toBeInTheDocument();
  });

  it("switches a banner on and off and says what the shop does", async () => {
    const { user } = renderPanel(<BannersView />);
    await user.click(
      await screen.findByRole("switch", {
        name: "Fresh produce (draft) is switched on",
      }),
    );
    const draft = banner("Fresh produce (draft)");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/banners/${draft.id}`,
          body: { isActive: true },
        },
      ]),
    );
    expect(
      await screen.findByText("Fresh produce (draft) is in the shop"),
    ).toBeInTheDocument();
    expect(stored(draft.id)?.isActive).toBe(true);

    // A scheduled banner switched off: the shop does not show it.
    api.calls.length = 0;
    await user.click(
      screen.getByRole("switch", { name: "Winter warmers is switched on" }),
    );
    expect(
      await screen.findByText("Winter warmers is switched off"),
    ).toBeInTheDocument();
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: `/v1/admin/banners/${banner("Winter warmers").id}`,
        body: { isActive: false },
      },
    ]);
  });

  it("moves a banner with the menu and sends the whole order", async () => {
    const { user } = renderPanel(<BannersView />);
    await rows();
    const ids = banners.map((entry) => entry.id);
    await actionsFor(user, "Diwali offer", "Move down");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/banners/order",
          body: { orderedIds: [ids[1], ids[0], ids[2], ids[3]] },
        },
      ]),
    );
    // The list follows at once, and the API agrees.
    const items = await rows();
    expect(items[0]).toHaveTextContent("Free delivery from 50 euros");
    expect(items[1]).toHaveTextContent("Diwali offer");
    expect(stored(ids[0]!)?.sortOrder).toBe(1);
    expect(stored(ids[1]!)?.sortOrder).toBe(0);
  });

  it("tells the admin when the banners changed in the meantime and loads them again", async () => {
    const { user } = renderPanel(<BannersView />);
    await rows();
    // Another admin added a banner: the order the panel knows is incomplete.
    const copy = banner("Diwali offer");
    api.mock.db().banners.push({
      ...copy,
      id: "66f3aaaaaaaaaaaaaaaaaaaa",
      name: "Added elsewhere",
      sortOrder: 4,
    });
    await actionsFor(user, "Diwali offer", "Move down");
    expect(
      await screen.findByText(
        "The banners changed in the meantime. The list was loaded again.",
      ),
    ).toBeInTheDocument();
    await waitFor(async () => expect(await rows()).toHaveLength(5));
    expect((await rows())[4]).toHaveTextContent("Added elsewhere");
  });

  it("deletes a banner only after a confirmation", async () => {
    const { user } = renderPanel(<BannersView />);
    await rows();
    await actionsFor(user, "Fresh produce (draft)", "Delete");
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Delete Fresh produce (draft)?",
      }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent("Inactive");
    expect(writes()).toEqual([]);
    await user.click(
      within(confirm).getByRole("button", { name: "Delete the banner" }),
    );
    const draft = banner("Fresh produce (draft)");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/banners/${draft.id}`,
          body: undefined,
        },
      ]),
    );
    expect(stored(draft.id)).toBeUndefined();
    await waitFor(async () => expect(await rows()).toHaveLength(3));
    expect(await screen.findByText("Banner deleted")).toBeInTheDocument();
  });

  it("blocks a new banner when the shop holds 20 already", async () => {
    const db = api.mock.db();
    const copy = banner("Diwali offer");
    for (let index = db.banners.length; index < 20; index += 1) {
      db.banners.push({
        ...copy,
        id: `66f3${String(index).padStart(20, "0")}`,
        name: `Banner ${index + 1}`,
        sortOrder: index,
      });
    }
    renderPanel(<BannersView />);
    expect(await rows()).toHaveLength(20);
    expect(screen.getByText(/20 banners of 20/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "New banner" });
    expect(button).toBeDisabled();
    expect(
      screen.getByLabelText(
        "The shop holds 20 banners at most. Delete one first.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps changes away from an admin without catalog.manage", async () => {
    renderPanel(<BannersView />, { permissions: READ_ONLY });
    const items = await rows();
    expect(items).toHaveLength(4);
    expect(
      screen.getByRole("switch", { name: "Diwali offer is switched on" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New banner" })).toBeDisabled();
  });
});

describe("the form of a banner", () => {
  it("creates a banner from its picture, goes on with its form, and saves only what changed", async () => {
    installUpload("works");
    const { user } = renderPanel(<BannersView readSize={okSize} />);
    await rows();
    await user.click(screen.getByRole("button", { name: "New banner" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "New banner" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2400 × 1000 px recommended");

    await user.upload(
      within(dialog).getByLabelText("Choose the banner picture"),
      picture("summer.png"),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /v1/admin/banners",
      ]),
    );
    const created = api.mock
      .db()
      .banners.find((entry) => entry.sortOrder === 4);
    expect(created).toBeDefined();
    expect(created?.isActive).toBe(false);
    expect(created?.image.sizes.large).toMatchObject({
      width: 2400,
      height: 1000,
    });
    expect(await screen.findByText("Banner created")).toBeInTheDocument();

    // The same dialog goes on with the form of the created banner.
    expect(
      await within(dialog).findByRole("heading", { name: "Banner" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("region", { name: "Picture" }),
    ).toHaveTextContent("2400 × 1000 px");
    expect(
      within(dialog).getByRole("switch", { name: "Switched off" }),
    ).not.toBeChecked();

    api.calls.length = 0;
    await user.type(field("name"), "Summer sale");
    await user.type(field("linkUrl"), "/products/alphonso-mango-1kg");
    fireEvent.change(field("endsAt"), {
      target: { value: "2026-12-01T10:00" },
    });
    await user.type(field("alt.en"), "Summer sale: mangoes at half price");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/banners/${created?.id}`,
          body: {
            name: "Summer sale",
            linkUrl: "/products/alphonso-mango-1kg",
            endsAt: "2026-12-01T10:00:00+01:00",
            alt: { en: "Summer sale: mangoes at half price", de: null },
          },
        },
      ]),
    );
    expect(await screen.findByText("Summer sale saved")).toBeInTheDocument();
    expect(stored(created?.id ?? "")).toMatchObject({
      name: "Summer sale",
      linkUrl: "/products/alphonso-mango-1kg",
      endsAt: "2026-12-01T09:00:00.000Z",
    });
    const items = await rows();
    expect(items[4]).toHaveTextContent("Summer sale");
    expect(items[4]).toHaveTextContent("Until 1 Dec 2026, 10:00");
  });

  it("refuses a picture that is not wider than tall, or too small, before sending it", async () => {
    installUpload("works");
    const { user } = renderPanel(<BannersView readSize={sizeOf(800, 800)} />);
    await rows();
    await user.click(screen.getByRole("button", { name: "New banner" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Choose the banner picture");
    await user.upload(input, picture("square.png", 800, 800));
    expect(
      await within(dialog).findByText(
        "square.png: 800 × 800 px: a banner must be wider than tall. Nothing was uploaded.",
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("shows the API's refusal of a picture that is too small", async () => {
    installUpload("works");
    const { user } = renderPanel(<BannersView readSize={unknownSize} />);
    await rows();
    await user.click(screen.getByRole("button", { name: "New banner" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(
      within(dialog).getByLabelText("Choose the banner picture"),
      picture("narrow.png", 1000, 400),
    );
    expect(
      await within(dialog).findByText("The picture is too small for a banner"),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "It has 1000 × 400 px. It needs at least 1200 × 300 px",
    );
    expect(api.mock.db().banners).toHaveLength(4);
  });

  it("replaces the picture of a banner at once and keeps its description", async () => {
    installUpload("works");
    const { user } = renderPanel(<BannersView readSize={okSize} />);
    await rows();
    await actionsFor(user, "Diwali offer", "Replace picture");
    const dialog = await screen.findByRole("dialog");
    const diwali = banner("Diwali offer");
    expect(
      within(dialog).getByRole("region", { name: "Picture" }),
    ).toHaveTextContent("2400 × 1000 px");
    await user.upload(
      within(dialog).getByLabelText("Choose the new banner picture"),
      picture("diwali-2.png", 1600, 600),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `PUT /v1/admin/banners/${diwali.id}/image`,
      ]),
    );
    expect(await screen.findByText("Picture replaced")).toBeInTheDocument();
    const after = stored(diwali.id);
    expect(after?.image.id).not.toBe(diwali.image.id);
    expect(after?.image.alt).toEqual(diwali.image.alt);
    // The form follows the list: the new size is there.
    await within(dialog).findByText("1600 × 600 px");
  });

  it("puts the API's refusal of the period at the end field", async () => {
    const { user } = renderPanel(<BannersView />);
    await rows();
    await actionsFor(user, "Diwali offer", "Edit");
    const dialog = await screen.findByRole("dialog");
    // Another admin gave the banner a start after its end, meanwhile.
    const diwali = stored(banner("Diwali offer").id);
    diwali!.startsAt = "2027-06-01T00:00:00.000Z";
    fireEvent.change(field("endsAt"), {
      target: { value: "2027-01-15T18:00" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/banners/${diwali?.id}`,
          body: { endsAt: "2027-01-15T18:00:00+01:00" },
        },
      ]),
    );
    expect(
      await within(dialog).findByText("The end must come after the start."),
    ).toBeInTheDocument();
    expect(field("endsAt")).toHaveAccessibleDescription(
      /The end must come after the start\./,
    );
  });

  it("refuses an end before the start, and a link that is not a path or https address, before sending", async () => {
    const { user } = renderPanel(<BannersView />);
    await rows();
    await actionsFor(user, "Winter warmers", "Edit");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(field("endsAt"), {
      target: { value: "2026-01-01T00:00" },
    });
    await user.type(field("linkUrl"), "http://example.com/offer");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(dialog).findByText("The end must come after the start."),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "A path of the shop starting with one slash",
    );
    expect(writes()).toEqual([]);
  });
});
