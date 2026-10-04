// @vitest-environment jsdom
import { screen, waitFor, within, configure } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testAdmin } from "@/test/render";
import { TeamView } from "./team-view";

// The machine may be busy with other work: a slow answer is not a wrong one.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

let api: TestApi;

const writes = () => api.calls.filter((call) => call.method !== "GET");
const adminByEmail = (email: string) => {
  const admin = api.mock.db().admins.find((entry) => entry.email === email);
  if (!admin) throw new Error(`No admin ${email} in the demo data`);
  return admin;
};
const roleByKey = (key: string) => {
  const role = api.mock.db().roles.find((entry) => entry.key === key);
  if (!role) throw new Error(`No role ${key} in the demo data`);
  return role;
};

/** Opens the menu of an admin's row and chooses an entry. */
async function choose(user: UserEvent, name: string, entry: string | RegExp) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: entry }));
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the team list", () => {
  it("shows role, status, two-factor, password and last sign-in of every admin", async () => {
    renderPanel(<TeamView />);
    const riya = (await screen.findByText("Riya Sharma")).closest(
      "tr",
    ) as HTMLElement;
    expect(riya).toHaveTextContent("new@radhefoods.de");
    expect(riya).toHaveTextContent("Catalogue editor");
    expect(riya).toHaveTextContent("Active");
    expect(riya).toHaveTextContent("Not set up");
    expect(riya).toHaveTextContent("Must change");
    expect(riya).toHaveTextContent("Never");

    const jan = screen.getByText("Jan Former").closest("tr") as HTMLElement;
    expect(jan).toHaveTextContent("Disabled");
    expect(jan).toHaveTextContent("Set up");
    expect(jan).toHaveTextContent("Own password");
    expect(
      screen.getByText(
        /5 admins: 4 active, 1 disabled\. 1 active admin has no authenticator yet/,
      ),
    ).toBeInTheDocument();
  });

  it("offers nothing that changes an admin without admin_users.manage", async () => {
    renderPanel(<TeamView />, { permissions: ["admin_users.read"] });
    await screen.findByText("Nisha Patel");
    expect(
      screen.getByRole("button", { name: "Invite an admin" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Your role does not include "Team: manage".'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
  });

  it("does not ask the API without the right to read the team", () => {
    renderPanel(<TeamView />, { permissions: ["orders.read"] });
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });
});

describe("inviting an admin", () => {
  it("creates the account and shows the password to hand over", async () => {
    const viewer = roleByKey("viewer");
    const { user } = renderPanel(<TeamView />);
    await user.click(
      await screen.findByRole("button", { name: "Invite an admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No email is sent")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/sets up the authenticator app/);
    expect(dialog).toHaveTextContent(/must then choose an own password/);

    await user.type(
      within(dialog).getByRole("textbox", { name: /Name/ }),
      "Arjun Mehta",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Email/ }),
      "arjun@radhefoods.de",
    );
    await user.selectOptions(
      await within(dialog).findByRole("combobox", { name: /Role/ }),
      await within(dialog).findByRole("option", { name: "Viewer" }),
    );
    const password = within(dialog).getByRole("textbox", {
      name: /Temporary password/,
    });
    const proposed = (password as HTMLInputElement).value;
    expect(proposed).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));
    const generated = (password as HTMLInputElement).value;
    expect(generated).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(generated).not.toBe(proposed);

    await user.click(
      within(dialog).getByRole("button", { name: "Invite the admin" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/admin-users",
      body: {
        email: "arjun@radhefoods.de",
        name: "Arjun Mehta",
        roleId: viewer.id,
        temporaryPassword: generated,
      },
    });
    const created = adminByEmail("arjun@radhefoods.de");
    expect(created.mustChangePassword).toBe(true);
    expect(created.totpSecret).toBeNull();

    // The answer of the API has no role: the handover does not need it.
    const handover = await screen.findByRole("dialog", {
      name: "Arjun Mehta is invited",
    });
    expect(within(handover).getByText(generated)).toBeInTheDocument();
    expect(
      within(handover).getByText("arjun@radhefoods.de"),
    ).toBeInTheDocument();
    expect(handover).toHaveTextContent("No email is sent");
    // The list shows the new admin with the role the API now reports.
    await user.click(within(handover).getByRole("button", { name: "Done" }));
    const row = (await screen.findByText("Arjun Mehta")).closest(
      "tr",
    ) as HTMLElement;
    expect(row).toHaveTextContent("Viewer");
    expect(row).toHaveTextContent("Must change");
  });

  it("refuses a temporary password that is too short before asking the API", async () => {
    const { user } = renderPanel(<TeamView />);
    await user.click(
      await screen.findByRole("button", { name: "Invite an admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Name/ }),
      "Arjun Mehta",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Email/ }),
      "arjun@radhefoods.de",
    );
    const password = within(dialog).getByRole("textbox", {
      name: /Temporary password/,
    });
    await user.clear(password);
    await user.type(password, "too-short");
    await user.click(
      within(dialog).getByRole("button", { name: "Invite the admin" }),
    );
    expect(
      await within(dialog).findByText("At least 12 characters."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a role.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("puts an email that is taken at the email field", async () => {
    const { user, unhandled } = renderPanel(<TeamView />);
    await user.click(
      await screen.findByRole("button", { name: "Invite an admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Name/ }),
      "Second Nisha",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Email/ }),
      "orders@radhefoods.de",
    );
    await user.selectOptions(
      await within(dialog).findByRole("combobox", { name: /Role/ }),
      await within(dialog).findByRole("option", { name: "Viewer" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Invite the admin" }),
    );

    const email = within(dialog).getByRole("textbox", { name: /Email/ });
    await waitFor(() =>
      expect(email).toHaveAccessibleDescription(
        /An admin with this email exists already\./,
      ),
    );
    expect(email).toBeInvalid();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(unhandled).toHaveLength(0);
  });

  it("lists only the roles in use when roles cannot be read", async () => {
    const { user } = renderPanel(<TeamView />, {
      permissions: ["admin_users.read", "admin_users.manage"],
    });
    await user.click(
      await screen.findByRole("button", { name: "Invite an admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        /Only roles that an admin already has are listed/,
      ),
    ).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole("combobox", { name: /Role/ }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Choose a role",
      "Catalogue editor",
      "Order manager",
      "Super Admin",
      "Viewer",
    ]);
    expect(
      api.calls.some((call) => call.path.startsWith("/v1/admin/roles")),
    ).toBe(false);
  });
});

describe("editing an admin", () => {
  it("confirms a new role with the note that the admin is signed out everywhere", async () => {
    const nisha = adminByEmail("orders@radhefoods.de");
    const viewer = roleByKey("viewer");
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Nisha Patel", "Edit");
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: /Role/ }),
      await within(dialog).findByRole("option", { name: "Viewer" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Change the role of Nisha Patel?",
      }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent("Nisha is signed out everywhere at once");
    expect(within(confirm).getByText("Role").nextSibling).toHaveTextContent(
      "Order manager → Viewer",
    );
    expect(writes()).toHaveLength(0);

    await user.click(
      within(confirm).getByRole("button", {
        name: "Change the role and sign out",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/admin-users/${nisha.id}`,
          body: { roleId: viewer.id },
        },
      ]),
    );
    expect(adminByEmail("orders@radhefoods.de").roleId).toBe(viewer.id);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("confirms disabling an account", async () => {
    const nisha = adminByEmail("orders@radhefoods.de");
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Nisha Patel", "Edit");
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("switch", { name: "The account is active" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Disable the account of Nisha Patel?",
      }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(
      /signed out everywhere at once and cannot sign in/,
    );
    expect(within(confirm).getByText("Status").nextSibling).toHaveTextContent(
      "Active → Disabled",
    );
    await user.click(
      within(confirm).getByRole("button", { name: "Disable and sign out" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/admin-users/${nisha.id}`,
          body: { status: "disabled" },
        },
      ]),
    );
    expect(adminByEmail("orders@radhefoods.de").status).toBe("disabled");
  });

  it("changes a name without a confirmation", async () => {
    const nisha = adminByEmail("orders@radhefoods.de");
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Nisha Patel", "Edit");
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: /Name/ });
    await user.clear(name);
    await user.type(name, "Nisha P. Patel");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/admin-users/${nisha.id}`,
          body: { name: "Nisha P. Patel" },
        },
      ]),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("locks the signed-in admin's own role and status, with the reason", async () => {
    // The admin of the test appears in the team list.
    const me = testAdmin();
    api.mock.db().admins.push({
      ...adminByEmail("viewer@radhefoods.de"),
      id: me.id,
      email: me.email,
      name: me.name,
    });
    const { user } = renderPanel(<TeamView />);
    const row = (await screen.findByText("Test Admin")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("You")).toBeInTheDocument();

    await choose(user, "Test Admin", "Edit");
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("combobox", { name: /Role/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("switch", { name: "The account is active" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(/You cannot change your own role or status/),
    ).toBeInTheDocument();

    // The name is the admin's own to change.
    const name = within(dialog).getByRole("textbox", { name: /Name/ });
    await user.clear(name);
    await user.type(name, "Tester");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/admin-users/${me.id}`,
          body: { name: "Tester" },
        },
      ]),
    );
  });

  it("sends the signed-in admin to the profile instead of a password reset", async () => {
    const me = testAdmin();
    api.mock.db().admins.push({
      ...adminByEmail("viewer@radhefoods.de"),
      id: me.id,
      email: me.email,
      name: me.name,
    });
    const { user } = renderPanel(<TeamView />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for Test Admin" }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: "Change your password in your profile",
      }),
    ).toHaveAttribute("href", "/profile");
    expect(
      screen.queryByRole("menuitem", { name: "Reset the password" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the last active super admin as it is", async () => {
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Vrushabh Vasoya", "Edit");
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("combobox", { name: /Role/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("switch", { name: "The account is active" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(/This is the only active super admin/),
    ).toBeInTheDocument();
  });

  it("shows the API's refusal of a self-modification and keeps the dialogs open", async () => {
    // A second super admin, so that the panel does not lock the owner. The
    // session of the test is the owner's: the API refuses the change (403).
    const owner = adminByEmail("owner@radhefoods.de");
    adminByEmail("orders@radhefoods.de").roleId = owner.roleId;
    const { user, unhandled } = renderPanel(<TeamView />);
    await choose(user, "Vrushabh Vasoya", "Edit");
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("switch", { name: "The account is active" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Disable and sign out" }),
    );

    expect(
      await within(confirm).findByText(
        "You cannot change your own role or status, and one active super admin must remain.",
      ),
    ).toBeInTheDocument();
    expect(adminByEmail("owner@radhefoods.de").status).toBe("active");
    expect(unhandled).toHaveLength(0);
  });
});

describe("resets", () => {
  it("sets a temporary password and shows it once more to hand over", async () => {
    const jan = adminByEmail("former@radhefoods.de");
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Jan Former", "Reset the password");
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Reset the password of Jan Former?",
      }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(
      /must choose an own one at the next sign-in/,
    );
    expect(confirm).toHaveTextContent(/The account is unlocked/);
    expect(confirm).toHaveTextContent(/signed out everywhere/);
    expect(confirm).toHaveTextContent(/No email is sent/);

    const password = within(confirm).getByRole("textbox", {
      name: /Temporary password/,
    });
    const button = within(confirm).getByRole("button", {
      name: "Reset the password",
    });
    await user.clear(password);
    await user.type(password, "short");
    expect(button).toBeDisabled();
    expect(
      within(confirm).getByText("At least 12 characters."),
    ).toBeInTheDocument();
    await user.clear(password);
    await user.type(password, "hand-this-over-2026");
    await user.click(button);

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/admin-users/${jan.id}/reset-password`,
          body: { temporaryPassword: "hand-this-over-2026" },
        },
      ]),
    );
    const after = adminByEmail("former@radhefoods.de");
    expect(after.password).toBe("hand-this-over-2026");
    expect(after.mustChangePassword).toBe(true);
    const handover = await screen.findByRole("dialog", {
      name: "New password for Jan Former",
    });
    expect(
      within(handover).getByText("hand-this-over-2026"),
    ).toBeInTheDocument();
  });

  it("removes the authenticator after a confirmation", async () => {
    const nisha = adminByEmail("orders@radhefoods.de");
    const { user } = renderPanel(<TeamView />);
    await choose(user, "Nisha Patel", "Reset two-factor");
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Reset the two-factor of Nisha Patel?",
      }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(
      /sets up a new authenticator at the next sign-in/,
    );
    expect(confirm).toHaveTextContent(/signed out everywhere/);
    expect(writes()).toHaveLength(0);

    await user.click(
      within(confirm).getByRole("button", { name: "Reset two-factor" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/admin-users/${nisha.id}/reset-mfa`,
          body: undefined,
        },
      ]),
    );
    expect(adminByEmail("orders@radhefoods.de").totpSecret).toBeNull();
    const row = (await screen.findByText("Nisha Patel")).closest(
      "tr",
    ) as HTMLElement;
    await waitFor(() => expect(row).toHaveTextContent("Not set up"));
  });

  it("offers no two-factor reset where no authenticator is set up", async () => {
    const { user } = renderPanel(<TeamView />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for Riya Sharma" }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: "Reset two-factor (none set up)",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("says so when the admin was removed in the meantime", async () => {
    const { user, unhandled } = renderPanel(<TeamView />);
    await choose(user, "Nisha Patel", "Reset two-factor");
    const confirm = await screen.findByRole("alertdialog");
    const db = api.mock.db();
    db.admins = db.admins.filter(
      (entry) => entry.email !== "orders@radhefoods.de",
    );
    await user.click(
      within(confirm).getByRole("button", { name: "Reset two-factor" }),
    );
    expect(
      await within(confirm).findByText("This admin does not exist (any more)."),
    ).toBeInTheDocument();
    expect(unhandled).toHaveLength(0);
  });
});
