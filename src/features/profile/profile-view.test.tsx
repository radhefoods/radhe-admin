// @vitest-environment jsdom
import { screen, waitFor, within, configure } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth/auth-provider";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { ProfileView } from "./profile-view";

// The machine may be busy with other work: a slow answer is not a wrong one.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

let api: TestApi;

beforeEach(async () => {
  api = installTestApi();
});

/** The profile behind the real session, as the panel shows it. */
function SignedIn() {
  const { admin, state } = useAuth();
  if (state.status === "signedOut") return <p>Signed out</p>;
  return admin ? <ProfileView /> : null;
}
const renderProfile = () =>
  renderPanel(
    <AuthProvider>
      <SignedIn />
    </AuthProvider>,
  );

describe("the profile", () => {
  it("shows who is signed in and what the role allows", async () => {
    await api.signIn("orders");
    renderProfile();
    expect(
      await screen.findByRole("heading", { name: "Nisha Patel" }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders@radhefoods.de")).toBeInTheDocument();
    expect(screen.getByText("order_manager")).toBeInTheDocument();
    expect(screen.getByText("Last sign-in").nextSibling).not.toHaveTextContent(
      "Not recorded",
    );

    const access = screen.getByRole("table", {
      name: "Your permissions by area",
    });
    const row = (area: string) =>
      within(access).getByRole("rowheader", { name: new RegExp(`^${area}`) })
        .parentElement as HTMLElement;
    expect(row("Orders")).toHaveTextContent("Orders, read: yes");
    expect(row("Orders")).toHaveTextContent("Orders, manage: yes");
    expect(row("Payments")).toHaveTextContent("Payments, read: yes");
    expect(row("Payments")).toHaveTextContent("Payments, manage: no");
    expect(row("Roles")).toHaveTextContent("Roles, read: no");
    expect(
      screen.getByRole("heading", {
        name: 'What the role "Order manager" allows',
      }),
    ).toBeInTheDocument();
  });

  it("explains the second factor: no recovery codes, a reset by another admin", async () => {
    await api.signIn("orders");
    renderProfile();
    expect(
      await screen.findByText("There are no recovery codes"),
    ).toBeInTheDocument();
    expect(screen.getByText("Set up")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Another admin with the Team permission resets your two-factor/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/second device as well, or in a password manager/),
    ).toBeInTheDocument();
    // An order manager cannot open the Team page: no link, and no self-service.
    expect(
      screen.queryByRole("link", { name: "Team page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/you can reset your own there/),
    ).not.toBeInTheDocument();
  });

  it("tells an admin with the Team permission where the reset is", async () => {
    await api.signIn("owner");
    renderProfile();
    expect(
      await screen.findByRole("link", { name: "Team page" }),
    ).toHaveAttribute("href", "/settings/team");
    expect(
      screen.getByText(/you can reset your own there/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Everything, including what is added to the panel later.",
      ),
    ).toBeInTheDocument();
  });

  it("changes the password and says that other devices are signed out", async () => {
    await api.signIn("orders");
    const { user } = renderProfile();
    expect(
      await screen.findByText(
        /every other device is signed out\. You stay signed in here/,
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Current password"),
      "radhe-orders-2026",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "a-new-long-password-2026",
    );
    await user.type(
      screen.getByLabelText("New password, again"),
      "a-new-long-password-2026",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/v1/admin/auth/change-password",
        body: {
          currentPassword: "radhe-orders-2026",
          newPassword: "a-new-long-password-2026",
        },
      }),
    );
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    // Still signed in on this device.
    expect(
      screen.getByRole("heading", { name: "Nisha Patel" }),
    ).toBeInTheDocument();
  });

  it("signs out everywhere only after a confirmation", async () => {
    await api.signIn("orders");
    const { user } = renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Sign out everywhere" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", { name: "Sign out everywhere?" }),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(/this browser and every other device/);
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);

    await user.click(
      within(confirm).getByRole("button", { name: "Sign out everywhere" }),
    );
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/v1/admin/auth/logout-all",
        body: undefined,
      }),
    );
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(api.mock.db().sessions.every((session) => session.revoked)).toBe(
      true,
    );
  });

  it("signs out on this device without a confirmation", async () => {
    await api.signIn("orders");
    const { user } = renderProfile();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/v1/admin/auth/logout",
        body: undefined,
      }),
    );
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
  });
});
