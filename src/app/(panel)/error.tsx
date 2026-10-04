"use client";

import { Crash } from "@/components/shell/crash";

/** A page of the panel failed: the navigation stays, the page says so. */
export default function PanelError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <Crash {...props} />;
}
