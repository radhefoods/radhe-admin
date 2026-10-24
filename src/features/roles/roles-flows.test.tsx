// @vitest-environment jsdom
import { screen, waitFor, within, configure } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSIONS } from "../../../mocks/seed.ts";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { RolesView } from "./roles-view";

// The machine may be busy with other work: a slow answer is not a wrong one.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

let api: TestApi;

const writes = () => api.calls.filter((call) => call.method !== "GET");
const roleByKey = (key: string) => {
  const role = api.mock.db().roles.find((entry) => entry.key === key);
  if (!role) throw new Error(`No role ${key} in the demo data`);
  return role;
};
const rowOf = async (name: string) =>
  (await screen.findByRole("button", { name })).closest("tr") as HTMLElement;

async function choose(user: UserEvent, name: string, entry: string) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: entry }));
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the list of roles", () => {
  it("shows how much each role allows and who has it", async () => {
    renderPanel(<RolesView />);
    const manager = await rowOf("Order manager");
    expect(manager).toHaveTextContent("order_manager");
    expect(manager).toHaveTextContent("6 of 21");
    expect(manager).toHaveTextContent("Manages Orders.");
    expect(manager).toHaveTextContent(
      "Reads Payments, Customers, Catalogue, Communication.",
    );
    await waitFor(() =>
      expect(manager).toHaveTextContent("Jan Former, Nisha Patel"),
    );
    expect(manager).toHaveTextContent("1 of them disabled");

    const superAdmin = await rowOf("Super Admin");
    expect(superAdmin).toHaveTextContent("System");
    expect(superAdmin).toHaveTextContent("Everything");
    expect(superAdmin).toHaveTextContent("Vrushabh Vasoya");
    expect(await rowOf("Viewer")).toHaveTextContent("11 of 21");
  });

  it("says that it cannot tell who has a role without the right to read the team", async () => {
    renderPanel(<RolesView />, { permissions: ["roles.read", "roles.manage"] });
    const manager = await rowOf("Order manager");
    expect(within(manager).getByText("Not shown")).toBeInTheDocument();
    expect(
      api.calls.some((call) => call.path.startsWith("/v1/admin/admin-users")),
    ).toBe(false);
  });

  it("offers nothing that changes a role without roles.manage", async () => {
    const { user } = renderPanel(<RolesView />, {
      permissions: ["roles.read"],
    });
    await rowOf("Order manager");
    expect(screen.getByRole("button", { name: "New role" })).toBeDisabled();
    expect(
      screen.getByLabelText('Your role does not include "Roles: manage".'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Actions for Order manager" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Show the permissions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: "Show the permissions" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: "Orders: manage" }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Save the role" }),
    ).not.toBeInTheDocument();
  });
});

describe("creating a role", () => {
  it("sends key, name, description and the ticked permissions", async () => {
    const { user } = renderPanel(<RolesView />);
    await user.click(await screen.findByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Name/ }),
      "Payment clerk",
    );
    // The key follows the name until it is typed.
    const key = within(dialog).getByRole("textbox", { name: /Key/ });
    expect(key).toHaveValue("payment_clerk");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Description/ }),
      "Decides and sends refunds",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Payments: read" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Payments: manage" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Orders: read" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create the role" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/roles",
      body: {
        key: "payment_clerk",
        name: "Payment clerk",
        description: "Decides and sends refunds",
        permissions: ["orders.read", "payments.read", "payments.manage"],
      },
    });
    expect(roleByKey("payment_clerk").isSystem).toBe(false);
    expect(await rowOf("Payment clerk")).toHaveTextContent("3 of 21");
  });

  it("warns about manage without read, because the pages need read", async () => {
    const { user } = renderPanel(<RolesView />);
    await user.click(await screen.findByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Orders: manage" }),
    );
    // Read and manage are independent: ticking one does not tick the other.
    expect(
      within(dialog).getByRole("checkbox", { name: "Orders: read" }),
    ).not.toBeChecked();
    expect(within(dialog).getAllByText("Manage without read")).toHaveLength(2);
    expect(dialog).toHaveTextContent(/the pages need read to open/);

    await user.click(
      within(dialog).getByRole("checkbox", { name: "Orders: read" }),
    );
    expect(
      within(dialog).queryByText("Manage without read"),
    ).not.toBeInTheDocument();
  });

  it("refuses a key the API would refuse, and shows a key that is taken at the field", async () => {
    const { user, unhandled } = renderPanel(<RolesView />);
    await user.click(await screen.findByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Name/ }),
      "Second viewer",
    );
    const key = within(dialog).getByRole("textbox", { name: /Key/ });
    await user.clear(key);
    await user.type(key, "No");
    await user.click(
      within(dialog).getByRole("button", { name: "Create the role" }),
    );
    expect(
      await within(dialog).findByText(
        /3 to 41 characters: lower-case letters, digits and _/,
      ),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.clear(key);
    await user.type(key, "viewer");
    await user.click(
      within(dialog).getByRole("button", { name: "Create the role" }),
    );
    await waitFor(() =>
      expect(key).toHaveAccessibleDescription(
        /A role with this key exists already\./,
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(unhandled).toHaveLength(0);
  });
});

describe("editing a role", () => {
  it("confirms a change of permissions with the admins it affects", async () => {
    const role = roleByKey("order_manager");
    const { user } = renderPanel(<RolesView />);
    await waitFor(async () =>
      expect(await rowOf("Order manager")).toHaveTextContent("Nisha Patel"),
    );
    await choose(user, "Order manager", "Edit");
    const dialog = await screen.findByRole("dialog");
    // The key cannot change.
    expect(
      within(dialog).queryByRole("textbox", { name: /Key/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("The key of a role cannot change."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", { name: "Orders: manage" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: "Payments: manage" }),
    ).not.toBeChecked();

    await user.click(
      within(dialog).getByRole("checkbox", { name: "Payments: manage" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Customers: read" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save the role" }),
    );

    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Change what 2 admins may do?",
      }),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText("Admins with this role").nextSibling,
    ).toHaveTextContent("Jan Former, Nisha Patel");
    expect(within(confirm).getByText("Added").nextSibling).toHaveTextContent(
      "Payments: manage",
    );
    expect(within(confirm).getByText("Removed").nextSibling).toHaveTextContent(
      "Customers: read",
    );
    expect(writes()).toHaveLength(0);

    await user.click(
      within(confirm).getByRole("button", { name: "Save the role" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/roles/${role.id}`,
      body: {
        permissions: [
          "catalog.read",
          "orders.read",
          "orders.manage",
          "payments.read",
          "payments.manage",
          "notifications.read",
        ],
      },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("changes a name without touching the permissions", async () => {
    const role = roleByKey("catalogue_editor");
    const { user } = renderPanel(<RolesView />);
    await choose(user, "Catalogue editor", "Edit");
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: /Name/ });
    await user.clear(name);
    await user.type(name, "Catalogue team");
    await user.click(
      within(dialog).getByRole("button", { name: "Save the role" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/roles/${role.id}`,
          body: { name: "Catalogue team" },
        },
      ]),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows wildcards as such and keeps them when the role is saved", async () => {
    const role = roleByKey("catalogue_editor");
    role.permissions = ["catalog.*", "legal.read"];
    const { user } = renderPanel(<RolesView />);
    await choose(user, "Catalogue editor", "Edit");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("catalog.*")).toBeInTheDocument();
    const read = within(dialog).getByRole("checkbox", {
      name: "Catalogue: read",
    });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
    expect(
      within(dialog).getByRole("checkbox", { name: "Catalogue: manage" }),
    ).toBeChecked();

    await user.click(
      within(dialog).getByRole("checkbox", { name: "Orders: read" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save the role" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Save the role" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/roles/${role.id}`,
          body: { permissions: ["catalog.*", "orders.read", "legal.read"] },
        },
      ]),
    );
  });

  it("shows the system role locked", async () => {
    const { user } = renderPanel(<RolesView />);
    await user.click(
      await screen.findByRole("button", { name: "Super Admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("The system role cannot be changed"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("This role contains the wildcard *"),
    ).toBeInTheDocument();
    for (const box of within(dialog).getAllByRole("checkbox")) {
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(
      within(dialog).getByRole("textbox", { name: /Name/ }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Save the role" }),
    ).not.toBeInTheDocument();
    // Nothing that changes it is offered in the list either.
    await user.click(
      within(dialog).getAllByRole("button", { name: "Close" })[0]!,
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for Super Admin" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Show the permissions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("names the permissions the API does not know", async () => {
    const role = roleByKey("viewer");
    const { user, unhandled } = renderPanel(<RolesView />);
    await choose(user, "Viewer", "Edit");
    const dialog = await screen.findByRole("dialog");
    // The API stopped offering a permission the role editor still shows.
    const index = ALL_PERMISSIONS.indexOf("legal.manage");
    const removed = ALL_PERMISSIONS.splice(index, 1);
    try {
      await user.click(
        within(dialog).getByRole("checkbox", { name: "Legal texts: manage" }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save the role" }),
      );
      const confirm = await screen.findByRole("alertdialog");
      await user.click(
        within(confirm).getByRole("button", { name: "Save the role" }),
      );
      expect(
        await within(confirm).findByText(
          "The API does not know these permissions: legal.manage.",
        ),
      ).toBeInTheDocument();
      expect(roleByKey("viewer").permissions).toEqual(role.permissions);
      expect(unhandled).toHaveLength(0);
    } finally {
      ALL_PERMISSIONS.splice(index, 0, ...removed);
    }
  });
});

describe("deleting a role", () => {
  it("says which admins still have it, and does not ask the API", async () => {
    const { user } = renderPanel(<RolesView />);
    await waitFor(async () =>
      expect(await rowOf("Order manager")).toHaveTextContent("Nisha Patel"),
    );
    await choose(user, "Order manager", "Delete");
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText("Still assigned to 2 admins"),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent("Jan Former, Nisha Patel");
    expect(
      within(confirm).getByRole("link", { name: "Team page" }),
    ).toHaveAttribute("href", "/settings/team");
    expect(
      within(confirm).getByRole("button", { name: "Delete the role" }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("shows the API's refusal when the panel could not know, then the names", async () => {
    // The role had no admin when the page loaded; one got it meanwhile.
    const role = roleByKey("catalogue_editor");
    const riya = api.mock
      .db()
      .admins.find((entry) => entry.email === "new@radhefoods.de");
    if (!riya) throw new Error("No newcomer in the demo data");
    const before = riya.roleId;
    riya.roleId = roleByKey("viewer").id;
    const { user, unhandled } = renderPanel(<RolesView />);
    await waitFor(async () =>
      expect(await rowOf("Catalogue editor")).toHaveTextContent("Nobody"),
    );
    await choose(user, "Catalogue editor", "Delete");
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("No admin has this role.");
    riya.roleId = before;
    await user.click(
      within(confirm).getByRole("button", { name: "Delete the role" }),
    );

    expect(
      await within(confirm).findByText(
        "The role is still assigned to an admin. Give them another role first.",
      ),
    ).toBeInTheDocument();
    expect(
      await within(confirm).findByText("Still assigned to 1 admin"),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent("Riya Sharma");
    expect(api.mock.db().roles.some((entry) => entry.id === role.id)).toBe(
      true,
    );
    expect(unhandled).toHaveLength(0);
  });

  it("deletes a role nobody has", async () => {
    const role = roleByKey("catalogue_editor");
    const db = api.mock.db();
    db.admins = db.admins.filter((entry) => entry.roleId !== role.id);
    const { user } = renderPanel(<RolesView />);
    await choose(user, "Catalogue editor", "Delete");
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      await within(confirm).findByRole("button", { name: "Delete the role" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/roles/${role.id}`,
          body: undefined,
        },
      ]),
    );
    expect(api.mock.db().roles.some((entry) => entry.id === role.id)).toBe(
      false,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Catalogue editor" }),
      ).not.toBeInTheDocument(),
    );
  });
});
