"use client";

import { Container, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import { FilterBar, FilterSelect } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { TwoLine } from "@/components/domain/values";
import { useCargoOverview } from "@/components/shell/cargo-pill";
import { PageBody, PageHeader, SectionTitle } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { CARGO_STATUSES, type Cargo } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDateTime, formatDayRange } from "@/lib/format/dates";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { CARGO_STATUS, statusOptions } from "@/lib/status";
import { CargoCard } from "./cargo-card";
import { useCargoCheck, useCargos } from "./queries";

const columns: Column<Cargo>[] = [
  {
    id: "cargo",
    header: "Cargo",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.cargo(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {row.original.code}
          </Link>
        }
        secondary={row.original.internalName}
      />
    ),
    meta: { skeleton: "w-32" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="cargo" value={row.original.status} />
        {row.original.attention ? (
          <StatusBadge kind="cargoAttention" value={row.original.attention} />
        ) : null}
      </span>
    ),
  },
  {
    id: "window",
    header: "Order window",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <span className="tabular">
            {formatDateTime(row.original.orderOpenAt)}
          </span>
        }
        secondary={
          <span className="tabular">
            until {formatDateTime(row.original.orderCloseAt)}
          </span>
        }
      />
    ),
    meta: { from: "md", skeleton: "w-36" },
  },
  {
    id: "delivery",
    header: "Delivery",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular">
        {formatDayRange(row.original.delivery.start, row.original.delivery.end)}
      </span>
    ),
    meta: { from: "sm" },
  },
  {
    id: "products",
    header: "Products",
    cell: ({ row }) =>
      row.original.products.total === 0 ? (
        <span className="text-ink-subtle">None</span>
      ) : (
        `${row.original.products.enabled} of ${row.original.products.total}`
      ),
    meta: { align: "right", from: "lg", skeleton: "w-12" },
  },
];

export function CargosView() {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(CARGO_STATUSES),
    page: param.page(),
  });
  const cargos = useCargos({
    status: state.status,
    page: state.page,
    limit: 20,
  });
  const overview = useCargoOverview().data;
  const check = useCargoCheck();
  const live = overview
    ? [overview.current, ...overview.inProgress, overview.next].filter(
        (cargo) => cargo !== null,
      )
    : [];

  return (
    <RequirePermission permission="cargos.read">
      <PageHeader
        title="Cargos"
        description="A cargo is one pre-order cycle: an order window, delivery days, and the products that can be ordered in it. One cargo takes orders at a time."
        actions={
          <>
            <ActionButton
              permission="cargos.manage"
              variant="ghost"
              icon={<RefreshCw />}
              loading={check.isPending}
              onClick={() =>
                check.mutate(undefined, {
                  onSuccess: (result) => {
                    const done = [
                      ...result.closed.map((code) => `${code} closed`),
                      ...result.opened.map((code) => `${code} opened`),
                    ];
                    notify.success(
                      done.length > 0 ? done.join(", ") : "Nothing was due",
                      done.length > 0
                        ? undefined
                        : "No cargo is past its deadline and none is due to open.",
                    );
                  },
                })
              }
            >
              Run the check
            </ActionButton>
            {can("cargos.manage") ? (
              <Button asChild variant="primary">
                <Link href={routes.cargoNew}>
                  <Plus />
                  New cargo
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="gap-8">
        {live.length > 0 && !state.status && state.page === 1 ? (
          <section className="flex flex-col gap-3">
            <SectionTitle>On their way</SectionTitle>
            <div className="grid gap-4 xl:grid-cols-2">
              {live.map((cargo) => (
                <CargoCard key={cargo.id} cargo={cargo} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <SectionTitle>All cargos</SectionTitle>
          <FilterBar active={Boolean(state.status)} onClear={clear}>
            <FilterSelect
              label="Status"
              value={state.status}
              options={statusOptions(CARGO_STATUS)}
              onChange={(status) => setState({ status })}
            />
          </FilterBar>
          <DataTable
            caption="Cargos, newest first"
            columns={columns}
            data={cargos.data?.items}
            getRowId={(cargo) => cargo.id}
            refreshing={cargos.isPlaceholderData}
            error={cargos.error}
            onRetry={() => void cargos.refetch()}
            rowHref={(cargo) => routes.cargo(cargo.id)}
            empty={
              <EmptyState
                icon={<Container />}
                title={
                  state.status ? "No cargo has this status" : "No cargo yet"
                }
                action={
                  !state.status && can("cargos.manage") ? (
                    <Button asChild variant="primary">
                      <Link href={routes.cargoNew}>Create the first cargo</Link>
                    </Button>
                  ) : null
                }
              >
                {state.status
                  ? "Choose another status or clear the filter."
                  : "Customers can order as soon as a cargo takes orders. Create one with its order window and delivery days."}
              </EmptyState>
            }
            footer={
              cargos.data ? (
                <Pagination
                  {...cargos.data}
                  noun="cargo"
                  onPage={(page) => setState({ page })}
                />
              ) : null
            }
          />
        </section>
      </PageBody>
    </RequirePermission>
  );
}
