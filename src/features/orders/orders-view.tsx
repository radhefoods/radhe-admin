"use client";

import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { OrdersList } from "./orders-list";

export function OrdersView() {
  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        title="Orders"
        description="Every order and its way to the customer. The payment confirms an order; open one to prepare it, dispatch it with a tracking number, mark it delivered, correct what was delivered, or cancel it."
      />
      <PageBody>
        <OrdersList />
      </PageBody>
    </RequirePermission>
  );
}
