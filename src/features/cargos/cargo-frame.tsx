"use client";

import { Container, Pencil, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { PageHeader, gutter } from "@/components/shell/page";
import { CountBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { tabClass } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/menu";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { CargoDetail } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDayRange } from "@/lib/format/dates";
import { routes } from "@/lib/routes";
import { CargoActions } from "./cargo-actions";
import { CargoForm, editable, toCargoPatch } from "./cargo-form";
import {
  useCargo,
  useCargoPaymentSummary,
  useDeleteCargo,
  useOrderSummary,
  useUpdateCargo,
} from "./queries";

function Tabs({ cargo }: { cargo: CargoDetail }) {
  const pathname = usePathname();
  const can = useCan();
  const orders = useOrderSummary(cargo.id).data;
  const payments = useCargoPaymentSummary(cargo.id).data;
  const tabs: {
    href: Route;
    label: string;
    count?: ReactNode;
    show: boolean;
  }[] = [
    { href: routes.cargo(cargo.id), label: "Overview", show: true },
    {
      href: routes.cargoProducts(cargo.id),
      label: "Products",
      count: (
        <span className="text-ink-subtle tabular">
          {cargo.products.enabled}
        </span>
      ),
      show: true,
    },
    {
      href: routes.cargoOrders(cargo.id),
      label: "Orders",
      count: orders ? (
        <span className="text-ink-subtle tabular">{orders.orders}</span>
      ) : null,
      show: can("orders.read"),
    },
    {
      href: routes.cargoPayments(cargo.id),
      label: "Payments",
      count: payments ? (
        <CountBadge count={payments.overdue.orders} tone="danger" />
      ) : null,
      show: can("payments.read"),
    },
  ];
  return (
    <nav
      aria-label={`Sections of ${cargo.code}`}
      className={cn(
        gutter,
        "relative no-scrollbar flex gap-5 overflow-x-auto border-b border-line",
      )}
    >
      {tabs
        .filter((tab) => tab.show)
        .map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={pathname === tab.href ? "page" : undefined}
            className={tabClass}
          >
            {tab.label}
            {tab.count}
          </Link>
        ))}
    </nav>
  );
}

/** The frame of a cargo: its header with the next step, and its sections. */
export function CargoFrame({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const cargo = useCargo(id);
  const update = useUpdateCargo(id);
  const remove = useDeleteCargo();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const back = { href: routes.cargos, label: "Cargos" };

  if (cargo.isError) {
    return (
      <RequirePermission permission="cargos.read">
        <PageHeader title="Cargo" back={back} />
        <div className={gutter}>
          {hasErrorCode(cargo.error, "CARGO_NOT_FOUND", "VALIDATION_FAILED") ? (
            <EmptyState icon={<Container />} title="This cargo does not exist">
              It may have been a draft that was deleted.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The cargo could not be loaded"
              actions={
                <Button onClick={() => void cargo.refetch()}>Try again</Button>
              }
            >
              {errorMessage(cargo.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = cargo.data;
  if (!data) {
    return (
      <RequirePermission permission="cargos.read">
        <PageHeader title={<Skeleton className="h-9 w-40" />} back={back} />
        <div className={cn(gutter, "flex flex-col gap-4")}>
          <Skeleton className="h-10" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  const manage = can("cargos.manage");

  return (
    <RequirePermission permission="cargos.read">
      <PageHeader
        back={back}
        title={data.code}
        badges={
          <>
            <StatusBadge kind="cargo" value={data.status} />
            {data.attention ? (
              <StatusBadge kind="cargoAttention" value={data.attention} />
            ) : null}
          </>
        }
        description={
          <>
            {data.internalName} · Delivery{" "}
            {formatDayRange(data.delivery.start, data.delivery.end)}
          </>
        }
        actions={
          <CargoActions
            cargo={data}
            menu={
              manage ? (
                <>
                  {editable(data.status).any ? (
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Pencil />
                      Edit the cargo
                    </DropdownMenuItem>
                  ) : null}
                  {data.status === "draft" ? (
                    <DropdownMenuItem danger onSelect={() => setDeleting(true)}>
                      <Trash2 />
                      Delete the draft
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null
            }
          />
        }
        className="pb-3"
      />
      <Tabs cargo={data} />
      <div className={cn(gutter, "flex flex-col gap-6 pt-6 pb-12")}>
        {children}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="lg">
          <DialogHeader
            title={`Edit ${data.code}`}
            description="Names, messages and notes can always change. Times and days can change until they have passed."
          />
          <DialogBody className="pb-6">
            <CargoForm
              key={data.updatedAt}
              cargo={data}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              onSubmit={async (values) => {
                const patch = toCargoPatch(values, data);
                if (Object.keys(patch).length > 0) {
                  await update.mutateAsync(patch);
                  notify.success(`${data.code} saved`);
                }
                setEditing(false);
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the draft ${data.code}?`}
        description="The draft and its product settings are removed for good. No order belongs to it."
        confirmLabel="Delete the draft"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(data.id);
          notify.success(`${data.code} deleted`);
          router.replace(routes.cargos);
        }}
      />
    </RequirePermission>
  );
}

/** The cargo of the page, for its sections. The frame has loaded it already. */
export function useCurrentCargo(): CargoDetail | undefined {
  const { id } = useParams<{ id: string }>();
  return useCargo(id).data;
}
