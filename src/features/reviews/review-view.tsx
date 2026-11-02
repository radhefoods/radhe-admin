"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CustomerName, customerOf } from "@/components/domain/customer";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { Stars } from "@/components/domain/stars";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, useAdminNames } from "@/components/domain/values";
import { ReasonField } from "@/components/form/reason-field";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { describeError, errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Review } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { LOCALE_LABEL } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { useReview, useReviewActions, type ReviewActions } from "./queries";
import {
  REVIEW_NOTE_MAX,
  REVIEW_REPLY_MAX,
  reviewActions,
  reviewTitle,
} from "./rules";

const back = { href: routes.reviews, label: "Reviews" };

type Decision = "approve" | "reject" | "delete" | null;

function Decide({
  review,
  decision,
  actions,
  onOpenChange,
}: {
  review: Review;
  decision: Decision;
  actions: ReviewActions;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const reset = (open: boolean) => {
    if (!open) setNote("");
    onOpenChange(open);
  };

  if (decision === "approve") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title="Publish this review?"
        description="The shop shows it among what customers say, with the stars, the words, the author's name and the month. The customer is not told."
        facts={[
          { label: "Order", value: review.orderNumber },
          { label: "Rating", value: `${review.rating} of 5` },
          { label: "By", value: review.authorName },
        ]}
        confirmLabel="Publish the review"
        onConfirm={async () => {
          await actions.approve.mutateAsync();
          notify.success(
            "Review published",
            "It is among what customers say in the shop.",
          );
        }}
      />
    );
  }

  if (decision === "reject") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title={
          review.status === "published"
            ? "Take this review off the shop?"
            : "Reject this review?"
        }
        description="The customer reads your note in their account, next to the review. A review is written once: the customer cannot rewrite it, but may write a new one if you delete this one."
        tone="danger"
        confirmLabel={
          review.status === "published" ? "Take it off" : "Reject the review"
        }
        canConfirm={note.trim().length > 0}
        onConfirm={async () => {
          await actions.reject.mutateAsync(note.trim());
          notify.success(
            review.status === "published"
              ? "Review taken off the shop"
              : "Review rejected",
            "The customer can read your note.",
          );
        }}
      >
        <ReasonField
          label="Note to the customer"
          value={note}
          onChange={setNote}
          maxLength={REVIEW_NOTE_MAX}
          required
          placeholder="Please leave out the name of the delivery person."
        />
      </ConfirmDialog>
    );
  }

  if (decision === "delete") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title="Delete this review?"
        description="The review disappears for good, from the shop and from the customer's account. The customer may review the order again afterwards. Rejecting it with a note keeps it on record instead."
        tone="danger"
        requireText="DELETE"
        confirmLabel="Delete the review"
        onConfirm={async () => {
          await actions.remove.mutateAsync();
          notify.success("Review deleted");
          router.replace(routes.reviews);
        }}
      />
    );
  }
  return null;
}

/** The public answer of Radhe Foods under the review: written, replaced or removed. */
function ReplyCard({
  review,
  actions,
}: {
  review: Review;
  actions: ReviewActions;
}) {
  const can = useCan();
  const adminName = useAdminNames();
  const saved = review.reply?.text ?? "";
  const [text, setText] = useState(saved);
  const [removing, setRemoving] = useState(false);
  const dirty = text.trim() !== saved.trim();
  const manage = can("reviews.manage");

  return (
    <Card>
      <CardHeader
        title="Your public answer"
        description="Shown under the review in the shop, signed Radhe Foods. Answering again replaces what was there."
      />
      <CardBody>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || !text.trim()) return;
            actions.reply.mutate(text.trim(), {
              onSuccess: () =>
                notify.success(
                  saved ? "Answer replaced" : "Answer published",
                  "It is under the review in the shop.",
                ),
              onError: (error) => notify.error(error),
            });
          }}
        >
          {manage ? (
            <ReasonField
              label="Answer"
              value={text}
              onChange={setText}
              maxLength={REVIEW_REPLY_MAX}
              rows={4}
              placeholder="Thank you for your review. We are sorry about the …"
            />
          ) : review.reply ? (
            <p className="text-sm whitespace-pre-line text-ink">
              “{review.reply.text}”
            </p>
          ) : (
            <p className="text-13 text-ink-muted">No answer was given.</p>
          )}
          {review.reply ? (
            <p className="text-13 text-ink-muted">
              Answered by {adminName(review.reply.adminId, review.reply.admin)}{" "}
              on <DateTime value={review.reply.at} />.
            </p>
          ) : null}
          {actions.reply.isError ? (
            <Alert tone="danger" title="The answer could not be saved">
              {describeError(actions.reply.error).message}
            </Alert>
          ) : null}
          {manage ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {review.reply ? (
                <ActionButton
                  permission="reviews.manage"
                  variant="danger-outline"
                  size="sm"
                  onClick={() => setRemoving(true)}
                >
                  Remove the answer
                </ActionButton>
              ) : null}
              <ActionButton
                permission="reviews.manage"
                variant="primary"
                size="sm"
                type="submit"
                disabled={!dirty || !text.trim()}
                loading={actions.reply.isPending}
              >
                {saved ? "Replace the answer" : "Publish the answer"}
              </ActionButton>
            </div>
          ) : null}
        </form>
      </CardBody>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the answer?"
        description="The answer disappears from under the review in the shop. The review itself stays as it is."
        tone="danger"
        confirmLabel="Remove the answer"
        onConfirm={async () => {
          await actions.removeReply.mutateAsync();
          notify.success("Answer removed");
        }}
      />
    </Card>
  );
}

export function ReviewView() {
  const { id } = useParams<{ id: string }>();
  const review = useReview(id);
  const actions = useReviewActions(id);
  const adminName = useAdminNames();
  const [decision, setDecision] = useState<Decision>(null);

  if (review.isError) {
    return (
      <RequirePermission permission="reviews.read">
        <PageHeader title="Review" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            review.error,
            "REVIEW_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<Star />} title="This review does not exist">
              It may have been deleted, or the customer closed the account.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The review could not be loaded"
              actions={
                <Button onClick={() => void review.refetch()}>Try again</Button>
              }
            >
              {errorMessage(review.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = review.data;
  if (!data) {
    return (
      <RequirePermission permission="reviews.read">
        <PageHeader title={<Skeleton className="h-9 w-64" />} back={back} />
        <PageBody>
          <Skeleton className="h-64 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const allowed = reviewActions(data.status);
  const customer = customerOf(data.customerId, data.customer);

  return (
    <RequirePermission permission="reviews.read">
      <PageHeader
        back={back}
        title={reviewTitle(data)}
        badges={<StatusBadge kind="review" value={data.status} />}
        description={
          <>
            Written <DateTime value={data.writtenAt} />
            {" · "}
            {LOCALE_LABEL[data.locale] ?? data.locale}
          </>
        }
        actions={
          <>
            <ActionButton
              permission="reviews.manage"
              variant="danger-outline"
              onClick={() => setDecision("delete")}
            >
              Delete
            </ActionButton>
            {allowed.reject ? (
              <ActionButton
                permission="reviews.manage"
                variant="secondary"
                onClick={() => setDecision("reject")}
              >
                {data.status === "published" ? "Take off the shop" : "Reject"}
              </ActionButton>
            ) : null}
            {allowed.approve ? (
              <ActionButton
                permission="reviews.manage"
                variant="primary"
                onClick={() => setDecision("approve")}
              >
                {data.status === "rejected" ? "Publish after all" : "Publish"}
              </ActionButton>
            ) : null}
          </>
        }
      />
      <PageBody>
        {data.status === "pending" ? (
          <Alert tone="time" title="Waiting for your decision">
            The shop does not show this review until you publish it. Reject it
            with a note when it should not be shown.
          </Alert>
        ) : null}
        {data.status === "rejected" && data.moderation ? (
          <Alert
            tone="info"
            title={`Rejected by ${adminName(data.moderation.adminId, data.moderation.admin)}`}
          >
            On <DateTime value={data.moderation.at} />.
            {data.moderation.note
              ? ` The customer was told: “${data.moderation.note}”`
              : " No note was left for the customer."}
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader
                title="The review"
                description="As the customer wrote it about the order as a whole. Reviews are never edited here."
              />
              <CardBody className="flex flex-col gap-3">
                <Stars value={data.rating} size="md" />
                <p className="text-sm whitespace-pre-line text-ink">
                  {data.text}
                </p>
                <p className="text-13 text-ink-subtle">
                  {data.authorName}: the name the shop shows.
                </p>
              </CardBody>
            </Card>
            {/* A new answer from the API starts the form afresh. */}
            <ReplyCard
              key={data.reply?.text ?? ""}
              review={data}
              actions={actions}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="About" />
              <CardBody>
                <dl className="grid gap-4">
                  <Fact label="Order">
                    <Link
                      href={routes.order(data.orderId)}
                      className="font-medium text-accent-text hover:underline"
                    >
                      {data.orderNumber}
                    </Link>
                  </Fact>
                  <Fact label="Customer">
                    <CustomerName customer={customer} />
                  </Fact>
                  {data.publishedAt ? (
                    <Fact label="Published">
                      <DateTime value={data.publishedAt} />
                    </Fact>
                  ) : null}
                  {data.moderation && data.status !== "rejected" ? (
                    <Fact label="Decided">
                      {adminName(
                        data.moderation.adminId,
                        data.moderation.admin,
                      )}
                      , <DateTime value={data.moderation.at} />
                    </Fact>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>
      <Decide
        review={data}
        decision={decision}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      />
    </RequirePermission>
  );
}
