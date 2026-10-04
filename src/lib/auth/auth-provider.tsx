"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, session } from "@/lib/api/client";
import { hasErrorCode, isApiError } from "@/lib/api/errors";
import type { SessionEndReason } from "@/lib/api/session";
import type { AdminWithRole } from "@/lib/api/types";
import { hasPermission } from "./permissions";

export type AuthState =
  /** Asking the API who is signed in. */
  | { status: "loading" }
  /** The API could not be reached: nobody knows. */
  | { status: "unreachable"; error: unknown }
  | { status: "signedOut" }
  | { status: "authenticated"; admin: AdminWithRole }
  /**
   * The session ended while the admin was working. The page stays as it
   * is, with its unsaved forms, and a sign-in opens over it.
   */
  | { status: "expired"; admin: AdminWithRole; reason: SessionEndReason };

interface AuthContextValue {
  state: AuthState;
  /** The signed-in admin, also while the session waits to be renewed. */
  admin: AdminWithRole | null;
  /** Whether the role grants a permission (`orders.manage`). */
  can: (permission: string) => boolean;
  /** Called by the sign-in once the API answered `authenticated`. */
  completeSignIn: (admin: AdminWithRole) => void;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  /** Asks the API again who is signed in (after a password change). */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isSignedOutAnswer(error: unknown): boolean {
  return (
    hasErrorCode(
      error,
      "AUTH_TOKEN_INVALID",
      "AUTH_REFRESH_INVALID",
      "AUTH_SESSION_REVOKED",
      "ADMIN_ACCOUNT_DISABLED",
    ) ||
    (isApiError(error) && error.status === 401)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback(async () => {
    try {
      const { admin } = await api.auth.me();
      setState({ status: "authenticated", admin });
    } catch (error) {
      if (isSignedOutAnswer(error)) setState({ status: "signedOut" });
      else if (hasErrorCode(error, "ADMIN_PASSWORD_CHANGE_REQUIRED")) {
        // `me` is allowed while a change is pending; this cannot happen.
        setState({ status: "signedOut" });
      } else setState({ status: "unreachable", error });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first question to the API
    void load();
  }, [load]);

  useEffect(() => {
    const offEnded = session.onSessionEnded((reason) => {
      setState((current) => {
        if (current.status === "authenticated") {
          return { status: "expired", admin: current.admin, reason };
        }
        if (current.status === "expired") return current;
        return { status: "signedOut" };
      });
    });
    const offPassword = session.onPasswordChangeRequired(() => {
      setState((current) =>
        current.status === "authenticated" && !current.admin.mustChangePassword
          ? {
              status: "authenticated",
              admin: { ...current.admin, mustChangePassword: true },
            }
          : current,
      );
    });
    // A refusal for a missing permission: the role may have been edited.
    let asking = false;
    const offDenied = session.onPermissionDenied(() => {
      if (asking || stateRef.current.status !== "authenticated") return;
      asking = true;
      api.auth
        .me()
        .then(({ admin }) => setState({ status: "authenticated", admin }))
        .catch(() => undefined)
        .finally(() => {
          asking = false;
        });
    });
    return () => {
      offEnded();
      offPassword();
      offDenied();
    };
  }, []);

  const completeSignIn = useCallback(
    (admin: AdminWithRole) => {
      const previous = stateRef.current;
      const sameAdmin =
        previous.status === "expired" && previous.admin.id === admin.id;
      setState({ status: "authenticated", admin });
      // Another admin must never see what the one before had loaded.
      if (sameAdmin) void queryClient.invalidateQueries();
      else queryClient.clear();
    },
    [queryClient],
  );

  const leave = useCallback(
    async (request: () => Promise<void>) => {
      try {
        await request();
      } catch {
        // Signed out here in any case; the session ends by itself.
      }
      setState({ status: "signedOut" });
      queryClient.clear();
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(() => {
    const admin =
      state.status === "authenticated" || state.status === "expired"
        ? state.admin
        : null;
    const permissions = admin?.role.permissions ?? null;
    return {
      state,
      admin,
      can: (permission) => hasPermission(permissions, permission),
      completeSignIn,
      signOut: () => leave(api.auth.logout),
      signOutEverywhere: () => leave(api.auth.logoutAll),
      reload: load,
    };
  }, [state, completeSignIn, leave, load]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * A fixed signed-in admin, without asking the API. For component tests
 * and the style guide.
 */
export function StaticAuthProvider({
  admin,
  children,
}: {
  admin: AdminWithRole;
  children: ReactNode;
}) {
  const value = useMemo<AuthContextValue>(
    () => ({
      state: { status: "authenticated", admin },
      admin,
      can: (permission) => hasPermission(admin.role.permissions, permission),
      completeSignIn: () => undefined,
      signOut: async () => undefined,
      signOutEverywhere: async () => undefined,
      reload: async () => undefined,
    }),
    [admin],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs the AuthProvider.");
  return value;
}

/** The signed-in admin. Only for components inside the panel. */
export function useAdmin(): AdminWithRole {
  const { admin } = useAuth();
  if (!admin) throw new Error("useAdmin is used outside of the panel.");
  return admin;
}

/** `can("orders.manage")` */
export function useCan(): (permission: string) => boolean {
  return useAuth().can;
}
