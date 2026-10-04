"use client";

import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { OrdersList } from "./orders-list";

export function OrdersView() {
  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        title="Orders"
        description="Every pre-order and its way to the customer. Open an order to change its status, its delivery, its cargo or what was really delivered."
      />
      <PageBody>
        <OrdersList />
      </PageBody>
    </RequirePermission>
  );
}
