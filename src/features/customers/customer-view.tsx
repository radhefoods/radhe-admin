"use client";

import {
  Bell,
  MessageSquareWarning,
  ReceiptText,
  ShoppingBag,
  Star,
  Undo2,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DataTable } from "@/components/data/data-table";
import { LoadMore } from "@/components/data/pagination";
import { KindBadge } from "@/components/domain/customer";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { useRecordName } from "@/features/notifications/queries";
import { OrderCard, orderColumns } from "@/features/orders/order-columns";
import { useReferrals } from "@/features/referrals/queries";
import {
  ReferralCard,
  referralColumns,
} from "@/features/referrals/referral-columns";
import { useReviews } from "@/features/reviews/queries";
import { ReviewCard, reviewColumns } from "@/features/reviews/review-columns";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Customer, CustomerAddress } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import {
  LOCALE_LABEL,
  isDeletedAccount,
  personName,
  shortId,
} from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes, withQuery } from "@/lib/routes";
import { CustomerStatusDialog } from "./customer-status-dialog";
import { OptIn } from "./customers-view";
import { NEWEST_ORDERS, useCustomer, useCustomerOrders } from "./queries";

const back = { href: routes.customers, label: "Customers" };

// The customer is the same in every row here, and the table sits in the
// narrower column of the page: the delivery details stay on the order.
const LEFT_OUT = ["customer", "delivery", "items"];
const orderTableColumns = orderColumns().filter(
  (column) => !LEFT_OUT.includes(column.id ?? ""),
);
const referralTableColumns = referralColumns(["referrer", "code"]);
const reviewTableColumns = reviewColumns(["customer", "author"]);

const TABS = ["orders", "referrals", "reviews"] as const;

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

/** The customer whose code this one signed up with (27). */
function ReferredBy({ id }: { id: string }) {
  const name = useRecordName("customer", id);
  return (
    <Link
      href={routes.customer(id)}
      className="font-medium text-accent-text hover:underline"
    >
      {name ?? `Customer ${shortId(id)}`}
    </Link>
  );
}

function Profile({ customer }: { customer: Customer }) {
  const guest = customer.kind === "guest";
  return (
    <Card>
      <CardHeader
        title="Profile"
        description={
          guest
            ? "A guest ordered with an email and an address, without an account. Signing up with the same email turns this record into the account."
            : "Customers change their own details in the shop. They cannot be edited here."
        }
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
          <Fact label="Kind">
            <KindBadge kind={customer.kind} />
          </Fact>
          <Fact label="Language">
            {LOCALE_LABEL[customer.locale] ?? customer.locale}
          </Fact>
          <Fact label="Email verified">
            {customer.emailVerifiedAt ? (
              <DateTime value={customer.emailVerifiedAt} />
            ) : (
              <Missing>{guest ? "Not needed for a guest" : "Not yet"}</Missing>
            )}
          </Fact>
          <Fact label="Customer since">
            <DateTime value={customer.createdAt} />
          </Fact>
          <Fact label="Last sign-in">
            {customer.lastLoginAt ? (
              <DateTime value={customer.lastLoginAt} />
            ) : (
              <Missing>{guest ? "Guests do not sign in" : "Never"}</Missing>
            )}
          </Fact>
          <Fact label="Referral code">
            {customer.referralCode ? (
              <span className="flex items-center gap-1">
                <span className="font-mono">{customer.referralCode}</span>
                <CopyButton
                  value={customer.referralCode}
                  label="Copy the referral code"
                />
              </span>
            ) : (
              <Missing>
                {guest ? "Guests cannot refer" : "Not asked for yet"}
              </Missing>
            )}
          </Fact>
          <Fact label="Referred by">
            {customer.referredBy ? (
              <ReferredBy id={customer.referredBy} />
            ) : (
              <Missing>Nobody</Missing>
            )}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

/** What is left of a closed account (4): the dates, nothing personal. */
function ClosedAccount({ customer }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader
        title="Account"
        description="The customer closed the account. Name, email, phone, addresses, preferences and referral code are gone; orders, invoices, credit notes, returns and reports stay for the books."
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Kind">
            <KindBadge kind={customer.kind} />
          </Fact>
          <Fact label="Language">
            {LOCALE_LABEL[customer.locale] ?? customer.locale}
          </Fact>
          <Fact label="Customer since">
            <DateTime value={customer.createdAt} />
          </Fact>
          <Fact label="Closed">
            {customer.deletedAt ? (
              <DateTime value={customer.deletedAt} />
            ) : (
              <Missing>Date unknown</Missing>
            )}
          </Fact>
          <Fact label="Referred by">
            {customer.referredBy ? (
              <ReferredBy id={customer.referredBy} />
            ) : (
              <Missing>Nobody</Missing>
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
        description="Emails about orders, returns and refunds are always sent. WhatsApp and news need the customer's opt-in."
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
      href: withQuery(routes.issues, {
        customerId: customer.id,
        status: "all",
      }),
      label: "Problem reports",
      icon: MessageSquareWarning,
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

// In the narrower column a wide row scrolls inside the table; its header
// then has nothing of the page to stick to.
const narrowTable = "[&_th]:static [&>div]:overflow-x-auto";

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
        className={narrowTable}
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

/** Whom this customer invited (27), newest first. */
function Referrals({ customer }: { customer: Customer }) {
  const referrals = useReferrals({ referrerId: customer.id });
  const rows = referrals.data?.pages.flatMap((page) => page.items);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        description={
          customer.referralCode
            ? `People who signed up with the code ${customer.referralCode}.`
            : undefined
        }
        actions={
          <Link
            href={withQuery(routes.referrals, { referrerId: customer.id })}
            className="text-13 font-medium text-accent-text hover:underline"
          >
            In the referral list
          </Link>
        }
      >
        Referrals
      </SectionTitle>
      <DataTable
        caption={`Referrals of ${personName(customer)}`}
        columns={referralTableColumns}
        data={rows}
        getRowId={(referral) => referral.id}
        error={referrals.error}
        onRetry={() => void referrals.refetch()}
        card={(referral) => <ReferralCard referral={referral} />}
        className={narrowTable}
        empty={
          <EmptyState
            icon={<UserPlus />}
            title="Nobody invited yet"
            className="py-10"
          >
            {isDeletedAccount(customer)
              ? "The referral records of a closed account are deleted."
              : customer.kind === "guest"
                ? "Guests have no referral code. One comes with the account."
                : "A referral appears here when somebody signs up with this customer's link."}
          </EmptyState>
        }
        footer={
          <LoadMore
            shown={rows?.length ?? 0}
            noun="referral"
            hasMore={referrals.hasNextPage}
            loading={referrals.isFetchingNextPage}
            onLoadMore={() => void referrals.fetchNextPage()}
          />
        }
      />
    </section>
  );
}

/** What this customer wrote about their delivered orders (28), newest first. */
function Reviews({ customer }: { customer: Customer }) {
  const reviews = useReviews({ customerId: customer.id });
  const rows = reviews.data?.pages.flatMap((page) => page.items);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        actions={
          <Link
            href={withQuery(routes.reviews, {
              customerId: customer.id,
              status: "all",
            })}
            className="text-13 font-medium text-accent-text hover:underline"
          >
            In the review list
          </Link>
        }
      >
        Reviews
      </SectionTitle>
      <DataTable
        caption={`Reviews of ${personName(customer)}`}
        columns={reviewTableColumns}
        data={rows}
        getRowId={(review) => review.id}
        error={reviews.error}
        onRetry={() => void reviews.refetch()}
        rowHref={(review) => routes.review(review.id)}
        card={(review) => <ReviewCard review={review} />}
        className={narrowTable}
        empty={
          <EmptyState icon={<Star />} title="No review yet" className="py-10">
            {isDeletedAccount(customer)
              ? "The reviews of a closed account are deleted."
              : "A review appears here when the customer writes one about a delivered order."}
          </EmptyState>
        }
        footer={
          <LoadMore
            shown={rows?.length ?? 0}
            noun="review"
            hasMore={reviews.hasNextPage}
            loading={reviews.isFetchingNextPage}
            onLoadMore={() => void reviews.fetchNextPage()}
          />
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
  const [state, setState] = useUrlState({
    tab: param.oneOfOr(TABS, "orders"),
  });
  const tabs = TABS.filter(
    (tab) =>
      (tab !== "orders" || can("orders.read")) &&
      (tab !== "reviews" || can("reviews.read")),
  );
  const tab = tabs.includes(state.tab) ? state.tab : (tabs[0] ?? "referrals");

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
  const deleted = isDeletedAccount(data);
  const blocked = data.status === "blocked";

  return (
    <RequirePermission permission="customers.read">
      <PageHeader
        back={back}
        title={name}
        badges={
          <>
            <StatusBadge kind="customer" value={data.status} />
            <KindBadge kind={data.kind} />
          </>
        }
        description={
          deleted ? (
            <>
              Closed{" "}
              {data.deletedAt ? formatDate(data.deletedAt) : "by the customer"}{" "}
              · Customer since {formatDate(data.createdAt)}
            </>
          ) : (
            <>
              {name === data.email ? null : <>{data.email} · </>}
              Customer since {formatDate(data.createdAt)}
            </>
          )
        }
        actions={
          deleted ? undefined : (
            <ActionButton
              permission="customers.manage"
              variant={blocked ? "secondary" : "danger-outline"}
              onClick={() => setChanging(true)}
            >
              {blocked ? "Unblock the account" : "Block the account"}
            </ActionButton>
          )
        }
      />
      <PageBody>
        {deleted ? (
          <Alert
            tone="info"
            title={
              data.deletedAt
                ? `This account was closed by the customer on ${formatDateTime(data.deletedAt)}`
                : "This account was closed by the customer"
            }
          >
            The personal details are gone and every session was revoked. The
            email address is free for a new account. Nothing can be changed here
            any more.
          </Alert>
        ) : null}
        {blocked ? (
          <Alert
            tone="danger"
            title={`This account is blocked since ${formatDateTime(data.blockedAt)}`}
          >
            <p>
              The customer is signed out everywhere and can neither sign in nor
              check out.
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
            {tabs.length > 0 ? (
              <Tabs
                value={tab}
                onValueChange={(value) =>
                  setState({ tab: value as (typeof TABS)[number] })
                }
              >
                <TabsList aria-label={`Records of ${name}`} className="mb-4">
                  {tabs.includes("orders") ? (
                    <TabsTrigger value="orders">Orders</TabsTrigger>
                  ) : null}
                  <TabsTrigger value="referrals">Referrals</TabsTrigger>
                  {tabs.includes("reviews") ? (
                    <TabsTrigger value="reviews">Reviews</TabsTrigger>
                  ) : null}
                </TabsList>
                {tabs.includes("orders") ? (
                  <TabsContent value="orders">
                    <NewestOrders customer={data} />
                  </TabsContent>
                ) : null}
                <TabsContent value="referrals">
                  <Referrals customer={data} />
                </TabsContent>
                {tabs.includes("reviews") ? (
                  <TabsContent value="reviews">
                    <Reviews customer={data} />
                  </TabsContent>
                ) : null}
              </Tabs>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {deleted ? (
              <ClosedAccount customer={data} />
            ) : (
              <>
                <Profile customer={data} />
                <Communication customer={data} />
                <Addresses customer={data} />
              </>
            )}
          </div>
        </div>
      </PageBody>

      {deleted ? null : (
        <CustomerStatusDialog
          customer={data}
          open={changing}
          onOpenChange={setChanging}
        />
      )}
    </RequirePermission>
  );
}
