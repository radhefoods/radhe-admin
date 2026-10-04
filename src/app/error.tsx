"use client";

import { Crash } from "@/components/shell/crash";

/** A page outside the panel failed (sign-in, password change). */
export default function RootError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface">
      <Crash {...props} />
    </div>
  );
}
