"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/dialog";
import { LoadingBlock, Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/surface";
import { SignInFlow } from "@/features/auth/sign-in-flow";
import { errorMessage } from "@/lib/api/error-text";
import type { SessionEndReason } from "@/lib/api/session";
import { useAuth } from "@/lib/auth/auth-provider";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { routes, withQuery } from "@/lib/routes";
import { CommandPalette } from "./command-palette";
import { FeatherMark, Logo } from "./logo";
import { Sidebar, SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * The gate of the panel: nothing inside renders until the API has said who
 * is signed in. A visitor without a session goes to the sign-in and comes
 * back to the same address; an admin who must change the password goes to
 * that screen and nowhere else (documentation, 1.9).
 */
export function PanelGate({ children }: { children: ReactNode }) {
  const { state, reload } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const mustChangePassword =
    (state.status === "authenticated" || state.status === "expired") &&
    state.admin.mustChangePassword;

  useEffect(() => {
    if (state.status === "signedOut") {
      const here = `${pathname}${window.location.search}`;
      router.replace(
        withQuery(routes.signIn, { returnTo: here === "/" ? null : here }),
      );
    } else if (mustChangePassword) {
      router.replace(routes.changePassword);
    }
  }, [state.status, mustChangePassword, pathname, router]);

  if (state.status === "unreachable") {
    return (
      <Splash>
        <Alert
          tone="danger"
          title="The API could not be reached"
          className="max-w-md text-left"
          actions={<Button onClick={() => void reload()}>Try again</Button>}
        >
          {errorMessage(state.error)}
        </Alert>
      </Splash>
    );
  }

  if (
    state.status === "loading" ||
    state.status === "signedOut" ||
    mustChangePassword
  ) {
    return (
      <Splash>
        <div role="status" className="flex items-center gap-2 text-ink-muted">
          <Spinner />
          <span>Opening the panel…</span>
        </div>
      </Splash>
    );
  }

  return (
    <>
      <AppShell>{children}</AppShell>
      {state.status === "expired" ? (
        <ReauthDialog email={state.admin.email} reason={state.reason} />
      ) : null}
    </>
  );
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface px-6 text-center">
      <FeatherMark size={56} />
      {children}
    </div>
  );
}

const END_REASON: Record<SessionEndReason, string> = {
  expired:
    "Admin sessions end after 12 hours without use, and after 72 hours in any case.",
  revoked:
    "Your session was ended: you signed out everywhere, or your account or role changed.",
  disabled: "This account was disabled. Ask another admin.",
};

/**
 * The session ended while the admin was working. The sign-in opens over
 * the page, so a half-filled form is still there afterwards.
 */
function ReauthDialog({
  email,
  reason,
}: {
  email: string;
  reason: SessionEndReason;
}) {
  const { completeSignIn, signOut } = useAuth();
  return (
    <Dialog open>
      <DialogContent
        size="sm"
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader
          title="Sign in again"
          description={`${END_REASON[reason]} What you were working on is still here.`}
        />
        <DialogBody className="pb-6">
          {reason === "disabled" ? null : (
            <SignInFlow lockedEmail={email} onAuthenticated={completeSignIn} />
          )}
          <Button
            variant="link"
            className="self-center"
            onClick={() => void signOut()}
          >
            {reason === "disabled"
              ? "Back to the sign-in"
              : "Sign in as someone else"}
          </Button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** The frame of every page of the panel: navigation, top bar, work area. */
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  useHotkey("/", () => setSearchOpen(true));
  useHotkey("k", () => setSearchOpen((open) => !open), { meta: true });

  // A new page closes the drawer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the address
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg"
      >
        Skip to the content
      </a>

      <Sidebar />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-canvas">
          <div className="flex h-14 shrink-0 items-center px-4">
            <Logo height={32} />
          </div>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            The pages of the panel
          </SheetDescription>
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-safe">
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <Topbar
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 bg-surface outline-none"
        >
          {/* Lists read their filters from the address, which suspends. */}
          <Suspense fallback={<LoadingBlock className="min-h-80" />}>
            {children}
          </Suspense>
        </main>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
