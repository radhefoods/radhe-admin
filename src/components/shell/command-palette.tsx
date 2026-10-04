"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Container,
  Search,
  ShoppingBag,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/domain/status-badge";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Kbd } from "@/components/ui/surface";
import { planSearch, hasRemoteSearch } from "@/features/search/classify";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import { personName, translated } from "@/lib/format/names";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { routes } from "@/lib/routes";
import { visibleNavigation } from "./nav";

interface Result {
  key: string;
  href: Route;
  icon: LucideIcon;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}

/**
 * The global search: an order by its number, a customer by the beginning
 * of the email, a product by words, a cargo by its code, and every page of
 * the panel. Opens with `/` or Ctrl/⌘ K.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const can = useCan();
  const [text, setText] = useState("");
  const debounced = useDebounced(text.trim(), 220);
  const plan = planSearch(debounced);
  const searching = hasRemoteSearch(plan);

  // A closed search starts empty the next time.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close
    if (!open) setText("");
  }, [open]);

  const search = useQuery({
    queryKey: queryKeys.search(debounced),
    enabled: open && searching,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const [byNumber, byEmail, customers, products, cargos] =
        await Promise.all([
          plan.orderNumber && can("orders.read")
            ? api.orders.list(
                { orderNumber: plan.orderNumber, limit: 5 },
                signal,
              )
            : null,
          plan.orderEmail && can("orders.read")
            ? api.orders.list({ email: plan.orderEmail, limit: 5 }, signal)
            : null,
          plan.customerEmailPrefix && can("customers.read")
            ? api.customers.list(
                { email: plan.customerEmailPrefix, limit: 5 },
                signal,
              )
            : null,
          plan.productQuery && can("catalog.read")
            ? api.products.list({ q: plan.productQuery, limit: 6 }, signal)
            : null,
          plan.cargoCode && can("cargos.read")
            ? api.cargos.list({ limit: 100 }, signal)
            : null,
        ]);
      return {
        orders: [...(byNumber?.items ?? []), ...(byEmail?.items ?? [])],
        customers: customers?.items ?? [],
        products: products?.items ?? [],
        cargos: (cargos?.items ?? []).filter(
          (cargo) => cargo.code === plan.cargoCode,
        ),
      };
    },
  });

  const needle = text.trim().toLowerCase();
  const pages: Result[] = visibleNavigation(can)
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        needle === "" ||
        item.label.toLowerCase().includes(needle) ||
        (item.keywords ?? "").includes(needle),
    )
    .map((item) => ({
      key: `page:${item.href}`,
      href: item.href,
      icon: item.icon,
      title: item.label,
    }));

  const found = search.data;
  const orders: Result[] = (found?.orders ?? []).map((order) => ({
    key: `order:${order.id}`,
    href: routes.order(order.id),
    icon: ShoppingBag,
    title: order.orderNumber,
    detail: `${personName(order.customer)} · ${order.cargo.code}`,
    trailing: (
      <>
        <StatusBadge kind="order" value={order.status} />
        <span className="text-ink-muted tabular">
          {formatMoney(order.finalTotal)}
        </span>
      </>
    ),
  }));
  const customers: Result[] = (found?.customers ?? []).map((customer) => ({
    key: `customer:${customer.id}`,
    href: routes.customer(customer.id),
    icon: Users,
    title: personName(customer),
    detail: customer.email,
    trailing:
      customer.status === "blocked" ? (
        <StatusBadge kind="customer" value={customer.status} />
      ) : null,
  }));
  const products: Result[] = (found?.products ?? []).map((product) => ({
    key: `product:${product.id}`,
    href: routes.product(product.id),
    icon: Tags,
    title: `${translated(product.name)} · ${product.packSize.label}`,
    detail: product.sku,
    trailing: (
      <span className="text-ink-muted tabular">
        {formatMoney(product.pricing.price)}
      </span>
    ),
  }));
  const cargos: Result[] = (found?.cargos ?? []).map((cargo) => ({
    key: `cargo:${cargo.id}`,
    href: routes.cargo(cargo.id),
    icon: Container,
    title: cargo.code,
    detail: cargo.internalName,
    trailing: <StatusBadge kind="cargo" value={cargo.status} />,
  }));

  const groups = [
    { heading: "Orders", results: orders },
    { heading: "Cargos", results: cargos },
    { heading: "Customers", results: customers },
    { heading: "Products", results: products },
    { heading: needle === "" ? "Go to" : "Pages", results: pages },
  ].filter((group) => group.results.length > 0);

  const waiting = searching && (search.isFetching || debounced !== text.trim());
  const nothing = groups.length === 0 && !waiting && needle !== "";

  function go(href: Route) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        hideClose
        className="top-0 max-h-[min(34rem,calc(100dvh-2rem))] overflow-hidden p-0 sm:top-[12vh] sm:translate-y-0"
      >
        <DialogHeader title="Search" className="sr-only" />
        <Command
          shouldFilter={false}
          label="Search"
          loop
          className="flex min-h-0 flex-col"
        >
          <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-line px-4">
            {waiting ? (
              <Spinner className="size-4 text-ink-subtle" />
            ) : (
              <Search aria-hidden="true" className="size-4 text-ink-subtle" />
            )}
            <Command.Input
              value={text}
              onValueChange={setText}
              placeholder="Order number, customer email, product, cargo…"
              className="h-13 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
            {nothing ? (
              <p className="px-3 py-8 text-center text-13 text-ink-muted">
                Nothing found for “{text.trim()}”. An order is found by its
                number (RF-1084), a customer by the beginning of the email, a
                product by name or article number.
              </p>
            ) : null}
            {search.isError ? (
              <p className="px-3 py-4 text-13 text-danger-fg">
                The search could not reach the API.
              </p>
            ) : null}
            {groups.map((group) => (
              <Command.Group
                key={group.heading}
                heading={group.heading}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:uppercase"
              >
                {group.results.map((result) => {
                  const Icon = result.icon;
                  return (
                    <Command.Item
                      key={result.key}
                      value={result.key}
                      onSelect={() => go(result.href)}
                      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-sm data-[selected=true]:bg-sunken"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-ink-subtle"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium text-ink">
                          {result.title}
                        </span>
                        {result.detail ? (
                          <span className="truncate text-13 text-ink-muted">
                            {result.detail}
                          </span>
                        ) : null}
                      </span>
                      {result.trailing ? (
                        <span className="flex shrink-0 items-center gap-2.5 text-13">
                          {result.trailing}
                        </span>
                      ) : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
