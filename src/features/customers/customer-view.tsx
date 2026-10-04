"use client";

import {
  Bell,
  ReceiptText,
  ShoppingBag,
  Undo2,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DataTable } from "@/components/data/data-table";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { CopyButton, DateTime } from "@/components/domain/values";
import {
  PageBody,
  PageHeader,
  SectionTitle,
  gutter,
} from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { OrderCard, orderColumns } from "@/features/orders/order-columns";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Customer, CustomerAddress } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { LOCALE_LABEL, personName } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { CustomerOrdering } from "./customer-ordering";
import { CustomerStatusDialog } from "./customer-status-dialog";
import { OptIn, OrderingBadge } from "./customers-view";
import { NEWEST_ORDERS, useCustomer, useCustomerOrders } from "./queries";
import { SIGNUP_METHOD_LABEL } from "./schemas";

const back = { href: routes.customers, label: "Customers" };

// The customer is the same in every row here, and the table sits in the
// narrower column of the page: the delivery details stay on the order.
const LEFT_OUT = ["customer", "delivery", "items"];
const orderTableColumns = orderColumns().filter(
  (column) => !LEFT_OUT.includes(column.id ?? ""),
);

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-ink-subtle">{children}</span>;
}

/** An opt-in with the day it was given. */
function Consent({ value, at }: { value: boolean; at: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <OptIn value={value} />
      {value && at ? (
        <span className="text-13 text-ink-muted">
          since {formatDateTime(at)}
        </span>
      ) : null}
    </span>
  );
}

function Profile({ customer }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader
        title="Profile"
        description="Customers change their own details in the shop. They cannot be edited here."
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Name">
            {customer.firstName?.trim() || customer.lastName?.trim() ? (
              personName(customer)
            ) : (
              <Missing>Not given</Missing>
            )}
          </Fact>
          <Fact label="Phone">
            {customer.phone ? (
              <span className="tabular">{customer.phone}</span>
            ) : (
              <Missing>Not given</Missing>
            )}
          </Fact>
          <Fact label="Email" className="col-span-2">
            <span className="flex items-center gap-1">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {customer.email}
              </span>
              <CopyButton
                value={customer.email}
                label="Copy the email address"
              />
            </span>
          </Fact>
          <Fact label="Language">
            {LOCALE_LABEL[customer.locale] ?? customer.locale}
          </Fact>
          <Fact label="Signed up with">
            {SIGNUP_METHOD_LABEL[customer.signupMethod] ??
              customer.signupMethod}
          </Fact>
          <Fact label="Google sign-in">
            {customer.hasGoogleLogin ? (
              "Connected"
            ) : (
              <Missing>Not connected</Missing>
            )}
          </Fact>
          <Fact label="Email verified">
            {customer.emailVerifiedAt ? (
              <DateTime value={customer.emailVerifiedAt} />
            ) : (
              <Missing>Not verified</Missing>
            )}
          </Fact>
          <Fact label="Customer since">
            <DateTime value={customer.createdAt} />
          </Fact>
          <Fact label="Last sign-in">
            {customer.lastLoginAt ? (
              <DateTime value={customer.lastLoginAt} />
            ) : (
              <Missing>Never</Missing>
            )}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

function Communication({ customer }: { customer: Customer }) {
  const { communication } = customer;
  return (
    <Card>
      <CardHeader
        title="Communication"
        description="Emails about orders and payments are always sent. WhatsApp and news need the customer's opt-in."
      />
      <CardBody>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="News (announcements)">
            <Consent
              value={communication.marketingOptIn}
              at={communication.marketingOptInAt}
            />
            {!communication.marketingOptIn &&
            communication.marketingOptOutAt ? (
              <span className="text-13 text-ink-muted">
                Opted out {formatDateTime(communication.marketingOptOutAt)}
              </span>
            ) : null}
          </Fact>
          <Fact label="WhatsApp messages">
            <Consent
              value={communication.whatsappOptIn}
              at={communication.whatsappOptInAt}
            />
          </Fact>
          <Fact label="WhatsApp number">
            {communication.whatsappNumber ? (
              <span className="tabular">{communication.whatsappNumber}</span>
            ) : (
              <Missing>Not given</Missing>
            )}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

function addressLines(address: CustomerAddress): string[] {
  return [
    address.company,
    `${address.firstName} ${address.lastName}`.trim(),
    `${address.street} ${address.houseNumber}`.trim(),
    address.additionalLine,
    `${address.postalCode} ${address.city}`.trim(),
    address.countryCode === "DE" ? null : address.countryCode,
  ].filter((line): line is string => Boolean(line && line.trim()));
}

function Addresses({ customer }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader title="Addresses" />
      {customer.addresses.length > 0 ? (
        <ul className="divide-y divide-line">
          {customer.addresses.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5"
            >
              <address className="text-sm text-ink not-italic">
                {addressLines(address).map((line, index) => (
                  <span key={index} className="block">
                    {line}
                  </span>
                ))}
                {address.phone ? (
                  <span className="mt-1 block text-13 text-ink-muted tabular">
                    {address.phone}
                  </span>
                ) : null}
              </address>
              {address.isDefault ? (
                <Badge tone="planned" dot={false}>
                  Default
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <CardBody>
          <p className="text-13 text-ink-muted">
            The customer has saved no address yet. One is asked for with the
            first order.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function Related({ customer }: { customer: Customer }) {
  const can = useCan();
  const links: {
    href: Route;
    label: string;
    icon: LucideIcon;
    show: boolean;
  }[] = [
    {
      href: withQuery(routes.orders, { customerId: customer.id }),
      label: "Orders",
      icon: ShoppingBag,
      show: can("orders.read"),
    },
    {
      href: withQuery(routes.invoices, { customerId: customer.id }),
      label: "Invoices",
      icon: ReceiptText,
      show: can("payments.read"),
    },
    {
      href: withQuery(routes.returns, { customerId: customer.id }),
      label: "Returns",
      icon: Undo2,
      show: can("orders.read"),
    },
    {
      href: withQuery(routes.notifications, { customerId: customer.id }),
      label: "Messages",
      icon: Bell,
      show: can("notifications.read"),
    },
  ];
  const shown = links.filter((link) => link.show);
  if (shown.length === 0) return null;
  return (
    <nav
      aria-label={`Records of ${personName(customer)}`}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="mr-1 text-13 text-ink-muted">
        Everything of this customer:
      </span>
      {shown.map(({ href, label, icon: Icon }) => (
        <Button key={label} asChild size="sm">
          <Link href={href}>
            <Icon aria-hidden="true" />
            {label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

function NewestOrders({ customer }: { customer: Customer }) {
  const orders = useCustomerOrders(customer.id);
  const all = withQuery(routes.orders, { customerId: customer.id });
  const more = Boolean(orders.data?.nextCursor);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        description={
          more
            ? `The newest ${NEWEST_ORDERS}. The order list has all of them.`
            : undefined
        }
        actions={
          <Link
            href={all}
            className="text-13 font-medium text-accent-text hover:underline"
          >
            All orders of this customer
          </Link>
        }
      >
        Newest orders
      </SectionTitle>
      <DataTable
        caption={`The newest orders of ${personName(customer)}`}
        columns={orderTableColumns}
        data={orders.data?.items}
        getRowId={(order) => order.id}
        error={orders.error}
        onRetry={() => void orders.refetch()}
        rowHref={(order) => routes.order(order.id)}
        card={(order) => <OrderCard order={order} />}
        // In the narrower column a wide row scrolls inside the table; its
        // header then has nothing of the page to stick to.
        className="[&_th]:static [&>div]:overflow-x-auto"
        empty={
          <EmptyState
            icon={<ShoppingBag />}
            title="No order yet"
            className="py-10"
          >
            Orders of this customer appear here as soon as one is placed.
          </EmptyState>
        }
      />
    </section>
  );
}

export function CustomerView() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const customer = useCustomer(id);
  const [changing, setChanging] = useState(false);

  if (customer.isError) {
    return (
      <RequirePermission permission="customers.read">
        <PageHeader title="Customer" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            customer.error,
            "CUSTOMER_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<UserX />} title="This customer does not exist">
              The link may be old, or the address was mistyped.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The customer could not be loaded"
              actions={
                <Button onClick={() => void customer.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(customer.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = customer.data;
  if (!data) {
    return (
      <RequirePermission permission="customers.read">
        <PageHeader title={<Skeleton className="h-9 w-56" />} back={back} />
        <div
          className={cn(
            gutter,
            "grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
          )}
        >
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  const name = personName(data);
  const blocked = data.status === "blocked";

  return (
    <RequirePermission permission="customers.read">
      <PageHeader
        back={back}
        title={name}
        badges={
          <>
            <StatusBadge kind="customer" value={data.status} />
            <OrderingBadge customer={data} />
          </>
        }
        description={
          <>
            {name === data.email ? null : <>{data.email} · </>}
            Customer since {formatDate(data.createdAt)}
          </>
        }
        actions={
          <ActionButton
            permission="customers.manage"
            variant={blocked ? "secondary" : "danger-outline"}
            onClick={() => setChanging(true)}
          >
            {blocked ? "Unblock the account" : "Block the account"}
          </ActionButton>
        }
      />
      <PageBody>
        {blocked ? (
          <Alert
            tone="danger"
            title={`This account is blocked since ${formatDateTime(data.blockedAt)}`}
          >
            <p>
              The customer is signed out everywhere and can neither sign in nor
              order.
            </p>
            <p className="mt-1 text-ink">
              {data.blockedReason ? (
                <>Reason: {data.blockedReason}</>
              ) : (
                "No reason was given."
              )}
            </p>
          </Alert>
        ) : null}

        <Related customer={data} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <CustomerOrdering customer={data} />
            {can("orders.read") ? <NewestOrders customer={data} /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Profile customer={data} />
            <Communication customer={data} />
            <Addresses customer={data} />
          </div>
        </div>
      </PageBody>

      <CustomerStatusDialog
        customer={data}
        open={changing}
        onOpenChange={setChanging}
      />
    </RequirePermission>
  );
}
