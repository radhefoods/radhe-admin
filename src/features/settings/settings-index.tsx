"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { useCan } from "@/lib/auth/auth-provider";
import { firstSettingsSection } from "./settings-frame";

/**
 * "Shop settings" opens on the first section the admin may open: the
 * company details for most, "Order costs" for a role that holds only the
 * permission of costs and profit.
 */
export function SettingsIndex() {
  const router = useRouter();
  const first = firstSettingsSection(useCan());
  useEffect(() => {
    if (first) router.replace(first);
  }, [first, router]);
  if (first) return null;
  return (
    <RequirePermission permission="settings.read">{null}</RequirePermission>
  );
}
