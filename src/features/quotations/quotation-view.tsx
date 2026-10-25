"use client";

import { Ellipsis, FileText } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PdfDialog, usePdfFile } from "@/components/domain/pdf-viewer";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { CopyButton, DateTime } from "@/components/domain/values";
import { UnsavedGuard } from "@/components/form/fields";
import { useSubmit, useZodForm } from "@/components/form/form";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
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
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Id, QuotationDetail, QuotationWithEmails } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import { LOCALE_LABEL, plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { EmailsCard } from "./quotation-emails";
import { LinesCard } from "./quotation-lines";
import {
  useQuotation,
  useQuotationActions,
  type QuotationActions,
} from "./queries";
import {
  actionsFor,
  canPrice,
  isClosed,
  lineValues,
  LINES_SCHEMA,
  emptiedPrices,
  linesText,
  revisionText,
  sendBlocked,
  toLinesPatch,
  type QuotationAction,
} from "./rules";

const back = { href: routes.quotations, label: "Quotations" };
const NONE: ReadonlySet<Id> = new Set();

/** What each action says before it runs, and what it is called (24). */
const ACTION: Record<
  QuotationAction,
  {
    label: string;
    title: string;
    confirm: string;
    tone: "primary" | "danger";
    done: string;
    describe: (quotation: QuotationDetail) => string;
  }
> = {
  send: {
    label: "Send quotation",
    title: "Send the quotation?",
    confirm: "Send the quotation",
    tone: "primary",
    done: "The quotation is on its way",
    describe: (quotation) =>
      `An email with the PDF goes to ${quotation.contact.email}.${
        quotation.revision > 0
          ? ` It is revision ${quotation.revision + 1}: the email says the quotation was updated.`
          : ""
      }`,
  },
  resend: {
    label: "Send again",
    title: "Send it again?",
    confirm: "Send again",
    tone: "primary",
    done: "The quotation is on its way again",
    describe: (quotation) =>
      `The same revision ${quotation.revision} goes to ${quotation.contact.email} once more, for a customer who lost the email.`,
  },
  accept: {
    label: "Mark accepted",
    title: "Mark the quotation as accepted?",
    confirm: "Mark accepted",
    tone: "primary",
    done: "Marked as accepted",
    describe: () =>
      "Records that the customer ordered. The quotation is closed; no email is sent.",
  },
  decline: {
    label: "Mark declined",
    title: "Mark the quotation as declined?",
    confirm: "Mark declined",
    tone: "primary",
    done: "Marked as declined",
    describe: () =>
      "Records that the customer did not order. The quotation is closed; no email is sent.",
  },
  cancel: {
    label: "Cancel request",
    title: "Cancel the request?",
    confirm: "Cancel the request",
    tone: "danger",
    done: "Request cancelled",
    describe: () =>
      "Withdrawn, spam or no longer wanted: the quotation is closed for good. The customer gets no email.",
  },
};

function Actions({
  quotation,
  actions,
  dirty,
  onUnpriced,
}: {
  quotation: QuotationDetail;
  actions: QuotationActions;
  dirty: boolean;
  onUnpriced: (ids: Id[]) => void;
}) {
  const can = useCan();
  const [pending, setPending] = useState<QuotationAction | null>(null);
  const offered = actionsFor(quotation.status);
  const manage = can("quotations.manage");
  const blocked = sendBlocked(quotation, dirty);
  const words = pending ? ACTION[pending] : null;

  return (
    <>
      {manage && offered.includes("cancel") ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label="More actions for this quotation">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem danger onSelect={() => setPending("cancel")}>
              {ACTION.cancel.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {offered.includes("resend") ? (
        <ActionButton
          permission="quotations.manage"
          onClick={() => setPending("resend")}
        >
          {ACTION.resend.label}
        </ActionButton>
      ) : null}
      {offered.includes("decline") ? (
        <ActionButton
          permission="quotations.manage"
          onClick={() => setPending("decline")}
        >
          {ACTION.decline.label}
        </ActionButton>
      ) : null}
      {offered.includes("accept") ? (
        <ActionButton
          permission="quotations.manage"
          variant="primary"
          onClick={() => setPending("accept")}
        >
          {ACTION.accept.label}
        </ActionButton>
      ) : null}
      {offered.includes("send") ? (
        <ActionButton
          permission="quotations.manage"
          variant="primary"
          blocked={blocked}
          onClick={() => setPending("send")}
        >
          {ACTION.send.label}
        </ActionButton>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={words?.title ?? ""}
        description={words?.describe(quotation)}
        facts={[
          { label: "Quotation", value: quotation.number },
          { label: "Company", value: quotation.contact.company },
          { label: "Lines", value: linesText(quotation) },
          ...(quotation.totals
            ? [
                {
                  label: "Total incl. VAT",
                  value: formatMoney(quotation.totals.gross),
                  strong: true,
                },
              ]
            : []),
        ]}
        confirmLabel={words?.confirm ?? ""}
        cancelLabel={pending === "cancel" ? "Keep it" : "Not now"}
        tone={words?.tone ?? "primary"}
        onConfirm={async () => {
          if (!pending || !words) return;
          try {
            await actions[pending].mutateAsync();
          } catch (error) {
            if (hasErrorCode(error, "QUOTATION_NOT_PRICED")) {
              onUnpriced(error.details?.unpriced ?? []);
            }
            throw error;
          }
          notify.success(words.done);
        }}
      />
    </>
  );
}

function ContactCard({ quotation }: { quotation: QuotationDetail }) {
  const { contact } = quotation;
  return (
    <Card>
      <CardHeader title="Contact" />
      <CardBody>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Fact label="Company">{contact.company}</Fact>
          <Fact label="Contact">{contact.name}</Fact>
          <Fact label="Email">
            <a
              href={`mailto:${contact.email}`}
              className="break-all text-accent-text hover:underline"
            >
              {contact.email}
            </a>
          </Fact>
          <Fact label="Phone">
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="text-accent-text hover:underline"
              >
                {contact.phone}
              </a>
            ) : (
              <span className="text-ink-subtle">—</span>
            )}
          </Fact>
          <Fact label="City">
            {contact.city ?? <span className="text-ink-subtle">—</span>}
          </Fact>
          <Fact label="Language of the request">
            {LOCALE_LABEL[quotation.locale]}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

function RequestCard({ quotation }: { quotation: QuotationDetail }) {
  return (
    <Card>
      <CardHeader title="Request" />
      <CardBody>
        <dl className="grid gap-4">
          <Fact label="Message">
            {quotation.message ? (
              <span className="whitespace-pre-line">“{quotation.message}”</span>
            ) : (
              <span className="text-ink-subtle">No message.</span>
            )}
          </Fact>
          <Fact label="Submitted">
            <DateTime value={quotation.createdAt} />
          </Fact>
          <Fact label="Privacy consent">
            <DateTime value={quotation.consent.acceptedAt} />
            <span className="mt-0.5 block text-13 text-ink-subtle">
              From {quotation.consent.ip}
            </span>
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

function ProgressCard({ quotation }: { quotation: QuotationDetail }) {
  const by = (admin: { name: string } | null) => admin?.name ?? "—";
  return (
    <Card>
      <CardHeader title="Progress" />
      <CardBody>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Fact label="Priced">
            {quotation.pricedAt ? (
              <>
                <DateTime value={quotation.pricedAt} />
                <span className="block text-13 text-ink-subtle">
                  by {by(quotation.updatedBy)}
                </span>
              </>
            ) : (
              <span className="text-ink-subtle">Not yet</span>
            )}
          </Fact>
          <Fact label="Sent">
            {quotation.sentAt ? (
              <>
                <DateTime value={quotation.sentAt} />
                <span className="block text-13 text-ink-subtle">
                  by {by(quotation.sentBy)}
                  {quotation.sentCount > 1
                    ? `, ${plural(quotation.sentCount, "time")} in all`
                    : ""}
                  {quotation.firstSentAt &&
                  quotation.firstSentAt !== quotation.sentAt
                    ? ", first on "
                    : ""}
                  {quotation.firstSentAt &&
                  quotation.firstSentAt !== quotation.sentAt ? (
                    <DateTime value={quotation.firstSentAt} short />
                  ) : null}
                </span>
              </>
            ) : (
              <span className="text-ink-subtle">Not yet</span>
            )}
          </Fact>
          {quotation.closedAt ? (
            <Fact label="Closed">
              <DateTime value={quotation.closedAt} />
              <span className="block text-13 text-ink-subtle">
                by {by(quotation.closedBy)}
              </span>
            </Fact>
          ) : null}
          <Fact label="Last change">
            <DateTime value={quotation.updatedAt} />
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

/** The page of one quotation: its lines to price, its emails, the contact and the progress. */
function QuotationPage({ data }: { data: QuotationWithEmails }) {
  const { quotation } = data;
  const can = useCan();
  const actions = useQuotationActions(quotation.id);
  const pdf = usePdfFile(quotation, (id) => api.quotations.pdf(id));
  // The lines a refused send named: they belong to the quotation as it
  // was then, and go away with the next change.
  const [flagged, setFlagged] = useState<{
    at: string;
    ids: ReadonlySet<Id>;
  } | null>(null);
  const unpriced = flagged?.at === quotation.updatedAt ? flagged.ids : NONE;
  const editable = can("quotations.manage") && canPrice(quotation.status);

  // The form lives on across saves and actions, and starts afresh from
  // each answer of the API.
  const form = useZodForm(LINES_SCHEMA, {
    defaultValues: lineValues(quotation.items),
  });
  useEffect(() => {
    form.reset(lineValues(quotation.items));
  }, [form, quotation]);
  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values) => {
      const emptied = emptiedPrices(values, quotation.items);
      if (emptied.length > 0) {
        emptied.forEach(({ index, message }, position) =>
          form.setError(
            `lines.${index}.unitPrice`,
            { type: "manual", message },
            { shouldFocus: position === 0 },
          ),
        );
        return;
      }
      const items = toLinesPatch(values, quotation.items);
      if (items.length === 0) return;
      await actions.save.mutateAsync({ items });
      setFlagged(null);
      notify.success("Prices saved");
    },
    {
      aliases: Object.fromEntries(
        quotation.items.flatMap((_item, index) => [
          [`items.${index}.unitPrice`, `lines.${index}.unitPrice`],
          [`items.${index}.cartons`, `lines.${index}.cartons`],
        ]),
      ),
    },
  );
  const dirty = toLinesPatch(form.watch(), quotation.items).length > 0;
  const revision = revisionText(quotation);

  return (
    <>
      <UnsavedGuard when={dirty} />
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-1.5">
            {quotation.number}
            <CopyButton
              value={quotation.number}
              label="Copy the quotation number"
            />
          </span>
        }
        badges={
          <>
            <StatusBadge kind="quotation" value={quotation.status} />
            {revision ? <Badge dot={false}>{revision}</Badge> : null}
          </>
        }
        description={
          <>
            {quotation.contact.company}, {quotation.contact.name} · submitted{" "}
            <DateTime value={quotation.createdAt} short />
            {isClosed(quotation.status)
              ? ". Closed: nothing here changes any more."
              : quotation.status === "sent"
                ? ". A changed price makes it a draft again; the next send is a new revision."
                : quotation.totals
                  ? ". Every line is priced: the quotation can be sent."
                  : ". Price every line, save, then send."}
          </>
        }
        actions={
          <>
            <Button
              icon={<FileText />}
              loading={pdf.loading}
              onClick={pdf.open}
            >
              PDF
            </Button>
            <Actions
              quotation={quotation}
              actions={actions}
              dirty={dirty}
              onUnpriced={(ids) =>
                setFlagged({ at: quotation.updatedAt, ids: new Set(ids) })
              }
            />
          </>
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <LinesCard
              quotation={quotation}
              form={form}
              editable={editable}
              unpriced={unpriced}
              submit={() => void onSubmit()}
              saving={pending || actions.save.isPending}
              state={state}
            />
            <EmailsCard
              quotationId={quotation.id}
              messages={data.notifications}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <ContactCard quotation={quotation} />
            <RequestCard quotation={quotation} />
            <ProgressCard quotation={quotation} />
          </div>
        </div>
      </PageBody>
      <PdfDialog
        pdf={pdf}
        title={quotation.number}
        description={
          quotation.totals
            ? "The PDF as the customer gets it."
            : "The PDF as it stands: unpriced lines show a dash and the totals read “Prices to be confirmed”."
        }
      />
    </>
  );
}

export function QuotationView() {
  const { id } = useParams<{ id: string }>();
  const quotation = useQuotation(id);

  if (quotation.isError) {
    return (
      <RequirePermission permission="quotations.read">
        <PageHeader title="Quotation" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            quotation.error,
            "QUOTATION_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState
              icon={<FileText />}
              title="This quotation does not exist"
            >
              Check the address, or find the quotation by its number in the
              list.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The quotation could not be loaded"
              actions={
                <Button onClick={() => void quotation.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(quotation.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  if (!quotation.data) {
    return (
      <RequirePermission permission="quotations.read">
        <PageHeader title={<Skeleton className="h-9 w-40" />} back={back} />
        <PageBody>
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  return (
    <RequirePermission permission="quotations.read">
      <QuotationPage data={quotation.data} />
    </RequirePermission>
  );
}
