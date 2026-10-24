"use client";

import { Inbox, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import { CopyButton, DateTime, Money } from "@/components/domain/values";
import {
  BerlinDateTimeField,
  BilingualField,
  MoneyField,
  SwitchField,
  UnitField,
} from "@/components/form/fields";
import { TextField, useZodForm } from "@/components/form/form";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge, CountBadge, toneClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Kbd,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { STATUS_TABLES, type StatusKind, type Tone } from "@/lib/status";
import {
  translatedDefaults,
  zBerlinDateTime,
  zEuros,
  zInt,
  zText,
  zTranslated,
} from "@/lib/validation";

// The parts every page is made of, on one page: to check a change to a
// token or a component everywhere at once, in both themes. Not in the
// navigation; the address is in CONTRIBUTING.md.

const TONES: { tone: Tone; meaning: string }[] = [
  { tone: "neutral", meaning: "Not started, switched off, over and filed" },
  { tone: "planned", meaning: "Set and waiting for its time" },
  { tone: "moving", meaning: "On its way, in work" },
  { tone: "attention", meaning: "Waits for a person or a deadline" },
  { tone: "success", meaning: "Done, paid, live" },
  { tone: "danger", meaning: "A problem" },
];

const SURFACES = [
  { name: "canvas", box: "bg-canvas" },
  { name: "surface", box: "bg-surface" },
  { name: "sunken", box: "bg-sunken" },
  { name: "accent", box: "bg-accent" },
  { name: "accent-soft", box: "bg-accent-soft" },
  { name: "gold-soft", box: "bg-gold-soft" },
  { name: "gold", box: "bg-gold" },
  { name: "ink", box: "bg-ink" },
] as const;

const STATUS_TITLES: Record<StatusKind, string> = {
  blogPost: "Blog post",
  order: "Order",
  payment: "Payment",
  return: "Return",
  refund: "Refund",
  notification: "Notification",
  product: "Product",
  customer: "Customer",
  admin: "Admin",
  legal: "Legal text",
  invoiceType: "Invoice type",
  banner: "Banner",
};

const demoSchema = z.object({
  name: zText(120),
  price: zEuros({ min: 1 }),
  days: zInt({ min: 1, max: 60 }),
  deadline: zBerlinDateTime,
  title: zTranslated(120),
  visible: z.boolean(),
});

function Part({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-5">{children}</CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function StyleguideView() {
  const [confirming, setConfirming] = useState<"primary" | "danger" | null>(
    null,
  );
  const form = useZodForm(demoSchema, {
    defaultValues: {
      name: "",
      price: "",
      days: "7",
      deadline: "",
      title: translatedDefaults(null),
      visible: true,
    },
  });

  return (
    <>
      <PageHeader
        title="Styleguide"
        description="The parts of the panel. Change a token in globals.css or a component and check it here, in the light and the dark theme."
      />
      <PageBody>
        <Part
          title="Six tones, six meanings"
          description="A colour never stands alone: every badge carries its word and a dot."
        >
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {TONES.map(({ tone, meaning }) => (
              <li key={tone} className="flex items-center gap-3">
                <Badge tone={tone} className="w-24 justify-start">
                  {tone}
                </Badge>
                <span className="text-13 text-ink-muted">{meaning}</span>
              </li>
            ))}
          </ul>
          <Row label="Counts in the navigation and on tabs">
            {TONES.map(({ tone }, index) => (
              <CountBadge key={tone} tone={tone} count={(index + 1) * 3} />
            ))}
            <CountBadge tone="attention" count={128} />
          </Row>
        </Part>

        <Part
          title="Every status of the API"
          description="The names are the API's own, made readable. A status the panel does not know yet is shown in grey."
        >
          <dl className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            {(Object.keys(STATUS_TABLES) as StatusKind[]).map((kind) => (
              <div key={kind} className="flex flex-col gap-2">
                <dt className="text-xs font-medium text-ink-subtle">
                  {STATUS_TITLES[kind]}
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {Object.keys(STATUS_TABLES[kind]).map((value) => (
                    <StatusBadge key={value} kind={kind} value={value} />
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <Row label="Unknown to the panel">
            <StatusBadge kind="order" value="held_at_customs" />
          </Row>
        </Part>

        <Part title="Colour">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {SURFACES.map(({ name, box }) => (
              <li key={name} className="flex flex-col gap-1.5">
                <span
                  className={cn("h-12 rounded-md border border-line", box)}
                />
                <span className="font-mono text-2xs text-ink-muted">
                  {name}
                </span>
              </li>
            ))}
          </ul>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {TONES.map(({ tone }) => (
              <li
                key={tone}
                className={cn(
                  "flex h-12 items-center gap-2 rounded-md px-3 text-13 font-semibold",
                  toneClass[tone].badge,
                )}
              >
                <span
                  className={cn("size-2 rounded-full", toneClass[tone].dot)}
                />
                {tone}
              </li>
            ))}
          </ul>
        </Part>

        <Part title="Type">
          <div className="flex flex-col gap-3">
            <p className="font-display text-[1.75rem] leading-tight text-ink">
              Page title, 28 semibold, tight
            </p>
            <p className="text-base font-semibold text-ink">
              Section title, 16 semibold
            </p>
            <p className="text-sm text-ink">
              Body text, 14. The order RF-1042 of Asha Patel waits for payment.
            </p>
            <p className="text-13 text-ink-muted">
              Secondary text, 13 muted. Hints, descriptions, table cells.
            </p>
            <p className="text-xs font-medium text-ink-subtle">
              Label, 12 subtle
            </p>
            <p className="text-sm text-ink tabular">
              Tabular figures: {formatMoney(111111)} · {formatMoney(408090)} ·{" "}
              {formatMoney(5)}
            </p>
          </div>
        </Part>

        <Part
          title="Buttons"
          description="One primary action a screen. Red only for what destroys."
        >
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="soft">Soft</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger-outline">Danger outline</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="xl" variant="primary">
              For a thumb
            </Button>
            <Button size="icon" aria-label="Add">
              <Plus aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete">
              <Trash2 aria-hidden="true" />
            </Button>
          </Row>
          <Row label="States">
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button disabled>Disabled</Button>
            <Button variant="primary" icon={<Plus aria-hidden="true" />}>
              With an icon
            </Button>
          </Row>
          <Row label="Keys">
            <Kbd>/</Kbd>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
            <Kbd>Esc</Kbd>
            <Kbd>Enter</Kbd>
          </Row>
        </Part>

        <Part title="Notices">
          <div className="grid gap-3 lg:grid-cols-2">
            <Alert tone="info" title="For information">
              Card payments are not connected yet. Cash and bank transfer work.
            </Alert>
            <Alert tone="success" title="Done">
              14 orders were marked dispatched.
            </Alert>
            <Alert tone="time" title="About time">
              The payment page is open until Thursday, 23:59, German time.
            </Alert>
            <Alert tone="warning" title="Check this">
              3 products are at or below their low-stock threshold.
            </Alert>
            <Alert
              tone="danger"
              title="This did not work"
              actions={<Button size="sm">Try again</Button>}
            >
              Only 3 units are in stock; 5 cannot be removed.
            </Alert>
          </div>
          <Row label="Toasts">
            <Button onClick={() => notify.success("Saved")}>Success</Button>
            <Button
              onClick={() =>
                notify.info("Nothing to send", "Every customer was told.")
              }
            >
              Information
            </Button>
          </Row>
        </Part>

        <Part
          title="Confirmations"
          description="Whatever destroys or moves money restates the real numbers first. The focus starts on the way out."
        >
          <Row label="Open one">
            <Button variant="primary" onClick={() => setConfirming("primary")}>
              Money-moving
            </Button>
            <Button
              variant="danger-outline"
              onClick={() => setConfirming("danger")}
            >
              Destructive, typed
            </Button>
          </Row>
          <ConfirmDialog
            open={confirming === "primary"}
            onOpenChange={(open) => setConfirming(open ? "primary" : null)}
            title="Activate payment for RF-C025?"
            description="Every delivered order gets its invoice and the customer is told how to pay."
            facts={[
              { label: "Orders", value: "14" },
              { label: "To collect", value: formatMoney(128450), strong: true },
            ]}
            confirmLabel="Activate and notify 14 customers"
            onConfirm={() =>
              notify.success("Nothing happened: a demonstration")
            }
          />
          <ConfirmDialog
            open={confirming === "danger"}
            onOpenChange={(open) => setConfirming(open ? "danger" : null)}
            tone="danger"
            title="Cancel order RF-1084?"
            description="The order is cancelled for good and the customer is told. What was paid waits for a refund."
            facts={[
              { label: "Customer", value: "Priya Shah" },
              {
                label: "Paid, to refund afterwards",
                value: formatMoney(3097),
                strong: true,
              },
            ]}
            requireText="RF-1084"
            confirmLabel="Cancel the order"
            onConfirm={() =>
              notify.success("Nothing happened: a demonstration")
            }
          />
        </Part>

        <Part title="Values">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Money (integer cents)">
              <Money cents={128450} />
            </Fact>
            <Fact label="Nothing, shown quietly">
              <Money cents={0} muted />
            </Fact>
            <Fact label="No value">
              <Money cents={null} />
            </Fact>
            <Fact label="A moment, German time">
              <DateTime value="2026-11-26T22:59:00.000Z" />
            </Fact>
            <Fact label="An id to copy">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono text-13">RF-1042</span>
                <CopyButton value="RF-1042" label="Copy the order number" />
              </span>
            </Fact>
          </dl>
        </Part>

        <Part
          title="Form fields"
          description="Checked when a field is left. Money is typed in euros and sent in cents; times are German time."
        >
          <form
            noValidate
            onSubmit={form.handleSubmit(() => notify.success("Valid"))}
            className="grid gap-4 sm:grid-cols-2"
          >
            <TextField
              form={form}
              name="name"
              label="Internal name"
              required
              hint="Only the team sees this."
            />
            <MoneyField form={form} name="price" label="Price" required />
            <UnitField
              form={form}
              name="days"
              label="Days to pay"
              unit="days"
              required
            />
            <BerlinDateTimeField
              form={form}
              name="deadline"
              label="Order deadline"
              required
            />
            <BilingualField
              form={form}
              name="title"
              label="Title"
              requiredEn
              maxLength={120}
              className="sm:col-span-2"
            />
            <SwitchField
              form={form}
              name="visible"
              label="Visible in the shop"
              hint="Customers can see and order it."
            />
            <div className="flex items-end justify-end">
              <Button type="submit" variant="primary">
                Check the form
              </Button>
            </div>
          </form>
        </Part>

        <div className="grid gap-6 lg:grid-cols-2">
          <Part title="History">
            <Timeline
              entries={[
                {
                  key: "paid",
                  at: "2026-10-02T09:12:00.000Z",
                  title: "Paid in cash",
                  by: "Vrushabh",
                  tone: "success",
                },
                {
                  key: "delivered",
                  at: "2026-10-01T15:40:00.000Z",
                  title: "Delivered",
                  by: "Vrushabh",
                  note: "Left with the neighbour, as agreed.",
                  tone: "moving",
                },
                {
                  key: "placed",
                  at: "2026-09-24T18:03:00.000Z",
                  title: "Order placed",
                  by: "The customer",
                },
              ]}
            />
          </Part>
          <Part title="Empty and loading">
            <EmptyState
              icon={<Inbox />}
              title="No returns are waiting"
              action={<Button size="sm">Show all returns</Button>}
            >
              A return a customer asks for shows up here until it is decided.
            </EmptyState>
            {/* `data-demo`: these never finish loading (see e2e/accessibility). */}
            <div data-demo className="flex flex-col gap-2">
              <Skeleton className="w-1/3" />
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
            </div>
          </Part>
        </div>
      </PageBody>
    </>
  );
}
