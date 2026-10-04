import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ThemeProvider } from "@/components/shell/theme";
import { TooltipProvider } from "@/components/ui/menu";
import { Toaster } from "@/components/ui/toast";
import type { AdminWithRole } from "@/lib/api/types";
import { StaticAuthProvider } from "@/lib/auth/auth-provider";
import { createQueryClient } from "@/lib/query/client";
import { testNavigation } from "./navigation";

export function testAdmin(permissions: string[] = ["*"]): AdminWithRole {
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    email: "tester@radhefoods.de",
    name: "Test Admin",
    status: "active",
    roleId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    role: { key: "test", name: "Test role", permissions },
    mfaEnabled: true,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

export interface RenderOptions {
  /** The permissions of the signed-in admin. Default: everything. */
  permissions?: string[];
  /** The address the component is rendered at. */
  path?: string;
  /** The parameters of the route (`{ id }`). */
  params?: Record<string, string>;
}

/**
 * Renders a component of the panel as a signed-in admin, with the query
 * cache, toasts and tooltips it expects. Errors nobody handles are
 * collected instead of shown, so a test can assert on them.
 */
export function renderPanel(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { user: UserEvent; unhandled: unknown[] } {
  const unhandled: unknown[] = [];
  const client = createQueryClient({
    onUnhandledMutationError: (error) => unhandled.push(error),
  });
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity, staleTime: 0 },
    mutations: { retry: false },
  });
  testNavigation.go(options.path ?? "/", options.params);
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <StaticAuthProvider admin={testAdmin(options.permissions)}>
          <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
          <Toaster />
        </StaticAuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...result, user: userEvent.setup(), unhandled };
}

export { testNavigation };
