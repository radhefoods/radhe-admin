"use client";

import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster as SonnerToaster, toast } from "sonner";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import { useTheme } from "@/components/shell/theme";

/**
 * Where toasts appear. A live region: screen readers hear a toast when it
 * arrives (errors at once, everything else politely).
 */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      gap={8}
      visibleToasts={4}
      closeButton
      containerAriaLabel="Notifications"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group pointer-events-auto flex w-[min(100vw-2rem,24rem)] items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-ink shadow-float",
          title: "font-semibold leading-snug",
          description: "mt-0.5 text-13 leading-snug text-ink-muted",
          icon: "mt-0.5 shrink-0",
          content: "min-w-0 flex-1",
          closeButton:
            "!static order-last !ml-auto flex size-6 shrink-0 !translate-none items-center justify-center !rounded-sm !border-0 !bg-transparent !text-ink-subtle hover:!bg-sunken hover:!text-ink",
          actionButton:
            "mt-2 inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-13 font-semibold text-accent-fg",
        },
      }}
      icons={{
        success: <CircleCheck className="size-4 text-success-fg" />,
        error: <CircleAlert className="size-4 text-danger-fg" />,
        info: <Info className="size-4 text-planned-fg" />,
      }}
    />
  );
}

function technicalLine(technical: string | null, requestId: string | null) {
  if (!technical && !requestId) return null;
  return (
    <span className="mt-1 block font-mono text-2xs break-all text-ink-subtle">
      {technical}
      {technical && requestId ? " · " : null}
      {requestId ? `Request ${requestId}` : null}
    </span>
  );
}

export const notify = {
  success(title: ReactNode, description?: ReactNode) {
    toast.success(title, { description });
  },
  info(title: ReactNode, description?: ReactNode) {
    toast.info(title, { description });
  },
  /**
   * Shows what went wrong. A documented error gets the panel's sentence; an
   * unexpected one also shows what the API said and the request id. A
   * session that ended is not reported here: the sign-in takes over.
   */
  error(error: unknown, title?: string) {
    if (isSessionError(error)) return;
    const notice = describeError(error);
    toast.error(title ?? notice.message, {
      description: (
        <>
          {title ? notice.message : null}
          {technicalLine(notice.technical, notice.requestId)}
        </>
      ),
      duration: notice.requestId ? 12000 : 7000,
    });
  },
};
