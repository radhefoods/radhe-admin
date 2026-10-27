"use client";

import { BadgePercent, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { Pagination } from "@/components/data/pagination";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import {
  AdminName,
  CopyButton,
  DateTime,
  Money,
} from "@/components/domain/values";
import {
  BerlinDateTimeField,
  MoneyField,
  SwitchField,
  UnitField,
  UnsavedGuard,
} from "@/components/form/fields";
import {
  FormError,
  SelectField,
  TextField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
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
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import {
  DISCOUNT_RULES,
  type DiscountCode,
  type DiscountUse,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDateTime } from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import {
  discountDefaults,
  discountErrorField,
  discountSchema,
  toDiscountInput,
  toDiscountPatch,
  type DiscountFormValues,
} from "./discount-schema";
import { switchedText } from "./discounts-view";
import {
  useCreateDiscount,
  useDeleteDiscount,
  useDiscount,
  useDiscountUses,
  useUpdateDiscount,
} from "./queries";
import { inUse, inUseText, periodText, usesText, valueText } from "./rules";

const back = { href: routes.discounts, label: "Discount codes" };

/** The fields of the API's `VALIDATION_FAILED` details, as the form names them. */
const ALIASES = { expiresAt: "expiresAt", startsAt: "startsAt" };

// --- The form ----------------------------------------------------------------------

function DiscountForm({
  code,
  onCreated,
}: {
  /** Set when an existing code is changed. */
  code?: DiscountCode;
  onCreated?: (code: DiscountCode) => void;
}) {
  const manage = useCan()("discounts.manage");
  const create = useCreateDiscount();
  const update = useUpdateDiscount();
  const form = useZodForm(discountSchema, {
    defaultValues: discountDefaults(code),
  });
  const dirty = form.formState.isDirty;
  const locked = code ? inUse(code) : false;

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: DiscountFormValues) => {
      try {
        if (code) {
          const patch = toDiscountPatch(values, code);
          if (Object.keys(patch).length === 0) {
            notify.info(
              "Nothing to save",
              "The code already has these values.",
            );
            return;
          }
          const saved = await update.mutateAsync({ id: code.id, ...patch });
          notify.success(`${saved.code} saved`);
          form.reset(discountDefaults(saved));
          return;
        }
        const created = await create.mutateAsync(toDiscountInput(values));
        notify.success(
          `${created.code} created`,
          values.generate
            ? "The API made the code. Customers enter it on the checkout page."
            : "Customers enter it on the checkout page.",
        );
        form.reset(discountDefaults(created));
        onCreated?.(created);
      } catch (error) {
        const field = discountErrorField(error);
        if (!field) throw error;
        form.setError(
          field,
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
      }
    },
    { aliases: ALIASES },
  );

  const type = form.watch("type");
  const generate = form.watch("generate");
  const active = form.watch("isActive");
  const saleItems = form.watch("appliesToSaleItems");
  const once = form.watch("oncePerCustomer");

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-6"
    >
      <UnsavedGuard when={dirty && !form.formState.isSubmitSuccessful} />
      <Card aria-label="Discount code">
        <CardHeader
          title={code ? "Discount code" : "New discount code"}
          description={
            code
              ? "Only what you change is saved. Orders made with the code keep what they were given."
              : "What the customer types on the checkout page, and what it takes off the goods."
          }
        />
        <CardBody className="flex flex-col gap-4">
          <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-4">
            <legend className="sr-only">Discount code</legend>
            <TextField
              form={form}
              name="code"
              label="Code"
              required={!generate}
              disabled={locked || generate}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={DISCOUNT_RULES.codeMaxLength}
              className="font-mono uppercase"
              aside={
                !code && manage ? (
                  generate ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() =>
                        form.setValue("generate", false, { shouldDirty: true })
                      }
                    >
                      Type it instead
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => {
                        form.setValue("code", "", { shouldDirty: true });
                        form.clearErrors("code");
                        form.setValue("generate", true, { shouldDirty: true });
                      }}
                    >
                      Generate
                    </Button>
                  )
                ) : null
              }
              hint={
                locked && code
                  ? `Orders were made with this code (${inUseText(code)}), so its text cannot change.`
                  : generate
                    ? `The API makes a code of ${DISCOUNT_RULES.generatedLength} characters when the code is created.`
                    : `${DISCOUNT_RULES.codeMinLength} to ${DISCOUNT_RULES.codeMaxLength} letters, digits and hyphens. Customers may type it in any case.`
              }
            />
            <TextField
              form={form}
              name="note"
              label="Note"
              optional
              maxLength={DISCOUNT_RULES.noteMaxLength}
              hint="For the team only; customers never see it."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField form={form} name="type" label="Kind" required>
                <option value="percent">Percentage of the goods</option>
                <option value="fixed">Fixed amount</option>
              </SelectField>
              {type === "percent" ? (
                <UnitField
                  form={form}
                  name="value"
                  label="Percentage"
                  unit="%"
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  hint={`A whole number, ${DISCOUNT_RULES.percentMin} to ${DISCOUNT_RULES.percentMax}.`}
                />
              ) : (
                <MoneyField
                  form={form}
                  name="value"
                  label="Amount"
                  required
                  hint="Never more than the goods it applies to."
                />
              )}
            </div>
            <SwitchField
              form={form}
              name="appliesToSaleItems"
              label={
                saleItems
                  ? "Applies to products on sale"
                  : "Products on sale are left out"
              }
              disabled={!manage}
              hint="Off: lines sold at a reduced price get no discount."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                form={form}
                name="minOrderValue"
                label="Minimum goods value"
                optional
                hint="What the goods must be worth before the discount, delivery not counted."
              />
              <TextField
                form={form}
                name="maxUses"
                label="Maximum uses"
                optional
                inputMode="numeric"
                autoComplete="off"
                hint="How often the code may be used in all. Empty: no limit."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <BerlinDateTimeField
                form={form}
                name="startsAt"
                label="Start"
                optional
                hint="Empty: from now on. German time."
              />
              <BerlinDateTimeField
                form={form}
                name="expiresAt"
                label="End"
                optional
                hint="Empty: without end. German time."
              />
            </div>
            <SwitchField
              form={form}
              name="oncePerCustomer"
              label={
                once ? "Once per customer" : "Any number of times per customer"
              }
              disabled={!manage}
              hint="On: a customer may pay one order with it. An order given up unpaid does not count."
            />
            <SwitchField
              form={form}
              name="isActive"
              label={active ? "Switched on" : "Switched off"}
              disabled={!manage}
              hint="Off: the shop does not take the code, whatever else. Orders that used it are not affected."
            />
          </fieldset>
          <FormError state={state} />
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {code ? (
          <Button
            variant="ghost"
            size="lg"
            disabled={!dirty || pending}
            onClick={() => form.reset(discountDefaults(code))}
          >
            Discard changes
          </Button>
        ) : (
          <Button asChild variant="ghost" size="lg">
            <Link href={routes.discounts}>Cancel</Link>
          </Button>
        )}
        <ActionButton
          type="submit"
          permission="discounts.manage"
          variant="primary"
          size="lg"
          loading={pending}
          disabled={Boolean(code) && !dirty}
        >
          {code ? "Save changes" : "Create the code"}
        </ActionButton>
      </div>
    </form>
  );
}

// --- The facts and the uses -----------------------------------------------------------

function FactsCard({ code }: { code: DiscountCode }) {
  return (
    <Card aria-label="Facts">
      <CardHeader title="Uses and state" />
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Fact label="State">
            <StatusBadge kind="discount" value={code.state} />
          </Fact>
          <Fact label="Discount">
            <span className="tabular">{valueText(code)}</span>
          </Fact>
          <Fact label="Period">{periodText(code, formatDateTime)}</Fact>
          <Fact label="Paid orders">
            <span className="tabular">{code.usedCount}</span>
          </Fact>
          <Fact label="Waiting for payment">
            <span className="tabular">{code.reservedCount}</span>
          </Fact>
          <Fact label="Remaining">
            <span className="tabular">
              {code.remainingUses === null
                ? "Unlimited"
                : `${code.remainingUses} of ${code.maxUses}`}
            </span>
          </Fact>
          <Fact label="Created by">
            {code.createdBy ? (
              <AdminName id={code.createdBy.id} admin={code.createdBy} />
            ) : (
              <span className="text-ink-subtle">—</span>
            )}
          </Fact>
          <Fact label="Created">
            <DateTime value={code.createdAt} />
          </Fact>
          <Fact label="Last change">
            <DateTime value={code.updatedAt} />
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

const PAGE_SIZE = 25;

const useColumns: Column<DiscountUse>[] = [
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => (
      <Link
        href={routes.order(row.original.orderId)}
        className="font-semibold text-accent-text hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
    meta: { skeleton: "w-20" },
  },
  {
    id: "customer",
    header: "Customer",
    cell: ({ row }) => (
      <span className="text-ink-muted">{row.original.customer.email}</span>
    ),
    meta: { skeleton: "w-40", className: "max-w-64 truncate" },
  },
  {
    id: "amount",
    header: "Taken off",
    cell: ({ row }) => <Money cents={row.original.amount} />,
    meta: { align: "right", skeleton: "w-14" },
  },
  {
    id: "state",
    header: "State",
    cell: ({ row }) => (
      <StatusBadge kind="discountUse" value={row.original.state} />
    ),
    meta: { skeleton: "w-24" },
  },
  {
    id: "at",
    header: "Ordered",
    cell: ({ row }) => (
      <DateTime value={row.original.at} short className="text-ink-muted" />
    ),
    meta: { from: "md", skeleton: "w-20" },
  },
  {
    id: "settled",
    header: "Settled",
    cell: ({ row }) =>
      row.original.settledAt ? (
        <DateTime
          value={row.original.settledAt}
          short
          className="text-ink-muted"
        />
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { from: "lg", skeleton: "w-20" },
  },
];

function UsesCard({
  code,
  paused = false,
}: {
  code: DiscountCode;
  /** The code is being deleted: the uses are not asked for again. */
  paused?: boolean;
}) {
  const [page, setPage] = useState(1);
  const uses = useDiscountUses(code.id, { page, limit: PAGE_SIZE }, !paused);
  const data = uses.data;
  return (
    <Card id="uses" aria-label="Uses" className="scroll-mt-20">
      <CardHeader
        title="Uses"
        description="Every order made with the code, newest first. A use waits for the payment, is counted once paid, and is given back when the order was given up unpaid."
      />
      <CardBody>
        <DataTable
          caption={`Uses of ${code.code}`}
          columns={useColumns}
          data={data?.items}
          getRowId={(use) => use.id}
          refreshing={uses.isPlaceholderData}
          error={uses.error}
          onRetry={() => void uses.refetch()}
          empty={
            <p className="p-4 text-13 text-ink-muted">
              No order was made with this code yet.
            </p>
          }
          footer={
            data ? <Pagination {...data} noun="use" onPage={setPage} /> : null
          }
        />
      </CardBody>
    </Card>
  );
}

// --- The pages --------------------------------------------------------------------------

/** The page of a discount code: its form, its counts and the orders made with it. */
export function DiscountView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const update = useUpdateDiscount();
  const remove = useDeleteDiscount();
  const [deleting, setDeleting] = useState(false);
  const [switchingOff, setSwitchingOff] = useState(false);
  const [gone, setGone] = useState(false);
  const code = useDiscount(id, !gone);
  const data = code.data;

  if (code.isError) {
    return (
      <RequirePermission permission="discounts.read">
        <PageHeader title="Discount code" back={back} />
        <div className={gutter}>
          {hasErrorCode(code.error, "DISCOUNT_NOT_FOUND") ? (
            <EmptyState
              icon={<BadgePercent />}
              title="This code does not exist"
            >
              It may have been deleted. The list has every discount code.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The code could not be loaded"
              actions={
                <Button onClick={() => void code.refetch()}>Try again</Button>
              }
            >
              {errorMessage(code.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }
  if (!data) {
    return (
      <RequirePermission permission="discounts.read">
        <PageHeader title={<Skeleton className="h-9 w-48" />} back={back} />
        <PageBody>
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const used = inUse(data);

  return (
    <RequirePermission permission="discounts.read">
      <PageHeader
        back={back}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{data.code}</span>
            <CopyButton
              value={data.code}
              label={`Copy the code ${data.code}`}
            />
          </span>
        }
        badges={<StatusBadge kind="discount" value={data.state} />}
        description={
          <>
            {valueText(data)} · {usesText(data)}
            {data.note ? ` · ${data.note}` : ""}
          </>
        }
        actions={
          used ? (
            <ActionButton
              permission="discounts.manage"
              variant="danger-outline"
              icon={<Power />}
              blocked={
                data.isActive ? null : "The code is switched off already."
              }
              onClick={() => setSwitchingOff(true)}
            >
              Switch off
            </ActionButton>
          ) : (
            <ActionButton
              permission="discounts.manage"
              variant="danger-outline"
              icon={<Trash2 />}
              onClick={() => setDeleting(true)}
            >
              Delete
            </ActionButton>
          )
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DiscountForm key={data.id} code={data} />
          <div className="flex min-w-0 flex-col gap-6">
            <FactsCard code={data} />
            <UsesCard code={data} paused={gone} />
          </div>
        </div>
      </PageBody>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the code ${data.code}?`}
        description="It is removed for good. No order was made with it."
        confirmLabel="Delete the code"
        tone="danger"
        onConfirm={async () => {
          setGone(true);
          try {
            await remove.mutateAsync(data.id);
          } catch (error) {
            setGone(false);
            throw error;
          }
          notify.success(`${data.code} deleted`);
          router.push(routes.discounts);
        }}
        errorHelp={(error) =>
          hasErrorCode(error, "DISCOUNT_IN_USE") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDeleting(false);
                setSwitchingOff(true);
              }}
            >
              Switch it off instead
            </Button>
          ) : null
        }
      />
      <ConfirmDialog
        open={switchingOff}
        onOpenChange={setSwitchingOff}
        title={`Switch off ${data.code}?`}
        description={`The shop stops taking the code at once. It stays for the order history: ${plural(data.usedCount, "paid order")}${data.reservedCount > 0 ? ` and ${plural(data.reservedCount, "order")} waiting for payment` : ""} were made with it, and they keep their discount. Switch it on again whenever you like.`}
        confirmLabel="Switch off"
        tone="danger"
        onConfirm={async () => {
          const saved = await update.mutateAsync({
            id: data.id,
            isActive: false,
          });
          notify.success(...switchedText(saved));
        }}
      />
    </RequirePermission>
  );
}

/** A new discount code: the form alone; its page opens once it exists. */
export function DiscountNewView() {
  const router = useRouter();
  return (
    <RequirePermission permission="discounts.manage">
      <PageHeader
        back={back}
        title="New discount code"
        description="A code for the checkout page of the retail shop. Its uses are counted on its page once it exists."
      />
      <PageBody className="max-w-3xl">
        <DiscountForm
          onCreated={(created) => router.push(routes.discount(created.id))}
        />
      </PageBody>
    </RequirePermission>
  );
}
