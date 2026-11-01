"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CustomerName } from "@/components/domain/customer";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import {
  PictureDialog,
  type Picture,
} from "@/components/domain/picture-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import { DateTime, Money, useAdminNames } from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ScrollX } from "@/components/ui/scroll-x";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { Issue } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { ISSUE_STATUS } from "@/lib/status";
import { ISSUE_TRANSITIONS } from "@/lib/status/transitions";
import { issueCustomer, ProblemChips } from "./issue-columns";
import { IssueDecideDialog, type IssueDecision } from "./issue-dialogs";
import { useIssue, useIssueActions } from "./queries";
import {
  ISSUE_ACTION_LABEL,
  ISSUE_RESOLUTION_LABEL,
  ISSUE_WISH_LABEL,
  reportedUnits,
} from "./rules";

const back = { href: routes.issues, label: "Problem reports" };

/** The photos the customer added, as thumbnails that open at full size. */
function Photos({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState<Picture | null>(null);
  return (
    <Card>
      <CardHeader
        title="Photos"
        description={
          issue.images.length > 0
            ? `${plural(issue.images.length, "photo")} from the customer. Open one to see it at full size.`
            : undefined
        }
      />
      <CardBody>
        {issue.images.length === 0 ? (
          <p className="text-13 text-ink-muted">The customer added no photo.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {issue.images.map((image, index) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() =>
                    setOpen({
                      sizes: image.sizes,
                      title: `Photo ${index + 1} of ${issue.images.length}`,
                      alt: `Photo ${index + 1} of ${issue.issueNumber}`,
                    })
                  }
                  className="block overflow-hidden rounded-md border border-line bg-sunken focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Open photo ${index + 1} of ${issue.images.length} at full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
                  <img
                    src={image.sizes.small.url}
                    alt=""
                    width={120}
                    height={120}
                    loading="lazy"
                    decoding="async"
                    className="size-[120px] object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <PictureDialog
        picture={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </Card>
  );
}

function Products({ issue }: { issue: Issue }) {
  if (issue.items.length === 0) {
    return (
      <Card>
        <CardHeader title="Products" />
        <CardBody>
          <p className="text-13 text-ink-muted">
            The report is about the delivery as a whole, not about single
            products. Nothing can be refunded by the unit.
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Products" />
      <ScrollX label={`Products of ${issue.issueNumber}`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Products of {issue.issueNumber}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              <th
                scope="col"
                className="px-4 py-2 text-left font-semibold sm:px-5"
              >
                Product
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Reported
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Refunded
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-right font-semibold sm:px-5"
              >
                Unit price
              </th>
            </tr>
          </thead>
          <tbody>
            {issue.items.map((item) => (
              <tr
                key={item.variantId}
                className="border-b border-line last:border-b-0"
              >
                <th
                  scope="row"
                  className="px-4 py-2.5 text-left font-normal sm:px-5"
                >
                  {translated(item.name)}{" "}
                  <span className="text-ink-muted">{item.packSize.label}</span>
                  <span className="block text-13 text-ink-subtle">
                    {item.sku}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-right tabular">
                  {item.quantity}
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  {issue.status === "resolved" ? (
                    item.refundedQuantity
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right sm:px-5">
                  <Money cents={item.unitPrice} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <CardBody className="border-t border-line">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Reported">
            <Money cents={issue.reportedAmount} />
          </Fact>
          <Fact label="Credited">
            {issue.resolution?.type === "refund" &&
            issue.resolution.amount !== null ? (
              <Money
                cents={issue.resolution.amount}
                className="font-semibold"
              />
            ) : (
              <span className="text-ink-subtle">
                {issue.status === "resolved"
                  ? "Nothing: no refund"
                  : "Not yet: on a refund"}
              </span>
            )}
          </Fact>
          <Fact label="Units">{plural(reportedUnits(issue), "unit")}</Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

export function IssueView() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const adminName = useAdminNames();
  const issue = useIssue(id);
  const actions = useIssueActions(id);
  const [decision, setDecision] = useState<IssueDecision>(null);
  const record = issue.data;
  const order = useQuery({
    queryKey: queryKeys.orders.detail(record?.orderId ?? ""),
    queryFn: async ({ signal }) =>
      (await api.orders.get(record?.orderId ?? "", signal)).order,
    enabled: Boolean(record),
  }).data;

  if (issue.isError) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title="Problem report" back={back} />
        <div className={gutter}>
          {hasErrorCode(issue.error, "ISSUE_NOT_FOUND", "VALIDATION_FAILED") ? (
            <EmptyState
              icon={<MessageSquareWarning />}
              title="This report does not exist"
            />
          ) : (
            <Alert
              tone="danger"
              title="The report could not be loaded"
              actions={
                <Button onClick={() => void issue.refetch()}>Try again</Button>
              }
            >
              {errorMessage(issue.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }
  if (!record) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title={<Skeleton className="h-9 w-44" />} back={back} />
        <PageBody>
          <Skeleton className="h-64 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const next = ISSUE_TRANSITIONS[record.status];
  const resolution = record.resolution;

  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        back={back}
        title={record.issueNumber}
        badges={<StatusBadge kind="issue" value={record.status} />}
        description={
          <>
            Order{" "}
            <Link
              href={routes.order(record.orderId)}
              className="font-medium text-accent-text hover:underline"
            >
              {record.orderNumber}
            </Link>
            {" · "}
            <CustomerName customer={issueCustomer(record)} />
            {" · reported "}
            <DateTime value={record.reportedAt} />
          </>
        }
        actions={
          <>
            {next.includes("rejected") ? (
              <ActionButton
                permission="orders.manage"
                variant="danger-outline"
                onClick={() => setDecision("reject")}
              >
                {ISSUE_ACTION_LABEL.rejected}
              </ActionButton>
            ) : null}
            {next.includes("in_review") ? (
              <ActionButton
                permission="orders.manage"
                variant="primary"
                onClick={() => setDecision("review")}
              >
                {ISSUE_ACTION_LABEL.in_review}
              </ActionButton>
            ) : null}
            {next.includes("resolved") ? (
              <ActionButton
                permission="orders.manage"
                variant="primary"
                onClick={() => setDecision("resolve")}
              >
                {ISSUE_ACTION_LABEL.resolved}
              </ActionButton>
            ) : null}
          </>
        }
      />
      <PageBody>
        {record.status === "open" ? (
          <Alert tone="time" title="Nobody has looked at this report yet">
            Take it on first: the customer can then no longer take it back, and
            you can resolve or reject it.
          </Alert>
        ) : null}
        {record.status === "in_review" ? (
          <Alert tone="info" title="In review">
            Resolve the report with a refund, a replacement or a note, or reject
            it. The customer is emailed either way.
          </Alert>
        ) : null}
        {resolution?.type === "refund" ? (
          <Alert
            tone="info"
            title={`${formatMoney(resolution.amount ?? 0)} was credited on ${record.orderNumber}`}
            actions={
              can("payments.read") ? (
                <Button asChild size="sm">
                  <Link href={`${routes.order(record.orderId)}#payment`}>
                    Open the payment of the order
                  </Link>
                </Button>
              ) : null
            }
          >
            The delivered quantities of the order were corrected and a credit
            note was issued.{" "}
            {order?.payment.needsRefund
              ? "The customer is owed this amount; it waits for your refund decision on the order."
              : "The refund of this amount was decided on the order."}
          </Alert>
        ) : null}
        {resolution && resolution.type !== "refund" ? (
          <Alert
            tone="info"
            title={
              resolution.type === "replacement"
                ? "Resolved with a replacement"
                : "Settled with a note"
            }
          >
            By {adminName(resolution.adminId, resolution.admin)} on{" "}
            <DateTime value={resolution.at} />.
            {resolution.type === "replacement"
              ? " The replacement is sent by hand; the order and its bill stay as they are."
              : ""}
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="What went wrong" />
              <CardBody>
                <dl className="grid gap-4">
                  <Fact label="Problems">
                    <ProblemChips issue={record} />
                  </Fact>
                  <Fact label="The customer wrote">
                    <span className="whitespace-pre-line">
                      “{record.description}”
                    </span>
                  </Fact>
                  <Fact label="The customer would like">
                    {ISSUE_WISH_LABEL[record.preferredResolution]}
                  </Fact>
                </dl>
              </CardBody>
            </Card>
            <Photos issue={record} />
            <Products issue={record} />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="History" />
              <CardBody>
                <Timeline
                  entries={[...record.statusHistory]
                    .reverse()
                    .map((entry, index) => ({
                      key: `${entry.at}-${index}`,
                      at: entry.at,
                      title: ISSUE_STATUS[entry.to].label,
                      tone: ISSUE_STATUS[entry.to].tone,
                      by:
                        entry.by === "admin"
                          ? adminName(entry.adminId, entry.admin)
                          : entry.by === "customer"
                            ? "The customer"
                            : "The system",
                      note: entry.note,
                    }))}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <dl className="grid gap-4">
                  {resolution ? (
                    <Fact label="Decision">
                      {ISSUE_RESOLUTION_LABEL[resolution.type]}
                    </Fact>
                  ) : null}
                  <Fact label="What the customer was told">
                    {resolution?.note ? (
                      `“${resolution.note}”`
                    ) : record.status === "rejected" ? (
                      (() => {
                        const last = [...record.statusHistory]
                          .reverse()
                          .find((entry) => entry.to === "rejected");
                        return last?.note ? (
                          `“${last.note}”`
                        ) : (
                          <span className="text-ink-subtle">Nothing</span>
                        );
                      })()
                    ) : (
                      <span className="text-ink-subtle">Nothing yet</span>
                    )}
                  </Fact>
                  <Fact label="Internal note (never shown to the customer)">
                    {record.internalNote ?? (
                      <span className="text-ink-subtle">None</span>
                    )}
                  </Fact>
                </dl>
              </CardBody>
            </Card>
            {order ? (
              <Card>
                <CardHeader title="The order" />
                <CardBody>
                  <dl className="grid gap-4">
                    <Fact label="Order">
                      <Link
                        href={routes.order(order.id)}
                        className="font-medium text-accent-text hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </Fact>
                    <Fact label="Status">
                      <span className="flex flex-wrap gap-1.5">
                        <StatusBadge kind="order" value={order.status} />
                        <StatusBadge
                          kind="payment"
                          value={order.paymentStatus}
                        />
                      </span>
                    </Fact>
                    {order.delivery.deliveredAt ? (
                      <Fact label="Delivered">
                        <DateTime value={order.delivery.deliveredAt} />
                      </Fact>
                    ) : null}
                    <Fact label="Final bill">
                      <Money cents={order.finalTotal} />
                    </Fact>
                  </dl>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      </PageBody>
      <IssueDecideDialog
        key={`${record.status}-${decision ?? "none"}`}
        issue={record}
        decision={decision}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      />
    </RequirePermission>
  );
}
