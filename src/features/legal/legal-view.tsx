"use client";

import { ExternalLink, Plus, ScrollText, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader, SectionTitle } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Fact, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import type {
  LegalDocumentSummary,
  LegalPage,
  LegalType,
  Locale,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDate } from "@/lib/format/dates";
import { LOCALE_LABEL } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import {
  LEGAL_TYPE,
  LEGAL_TYPES,
  groupByType,
  legalPageUrl,
  unpublishedRequiredTypes,
} from "./legal";
import { NewVersionDialog } from "./new-version-dialog";
import { PageSettingsDialog } from "./page-settings-dialog";
import { useLegalDocuments, useLegalPages } from "./queries";

const LANGUAGES: readonly Locale[] = ["en", "de"];

const columns: Column<LegalDocumentSummary>[] = [
  {
    id: "version",
    header: "Version",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.legalDocument(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            Version {row.original.version}
          </Link>
        }
        secondary={row.original.title.en}
      />
    ),
    meta: { skeleton: "w-32", className: "w-[22%]" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="legal" value={row.original.status} />
        {row.original.isCurrent ? (
          <Badge tone="planned" dot={false}>
            Current
          </Badge>
        ) : null}
      </span>
    ),
    meta: { className: "w-[17%]" },
  },
  {
    id: "published",
    header: "Published",
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <TwoLine
          primary={<DateTime value={row.original.publishedAt} />}
          secondary={
            row.original.publishedByAdmin
              ? `by ${row.original.publishedByAdmin.name}`
              : undefined
          }
        />
      ) : (
        <span className="text-ink-subtle">Not yet</span>
      ),
    meta: { from: "sm", skeleton: "w-28", className: "w-[19%]" },
  },
  {
    id: "created",
    header: "Created",
    cell: ({ row }) => (
      <TwoLine
        primary={<DateTime value={row.original.createdAt} short />}
        secondary={
          row.original.createdByAdmin
            ? `by ${row.original.createdByAdmin.name}`
            : undefined
        }
      />
    ),
    meta: { from: "lg", skeleton: "w-24", className: "w-[16%]" },
  },
  {
    id: "note",
    header: "Note",
    cell: ({ row }) =>
      row.original.note ? (
        <span className="line-clamp-2 max-w-md text-ink-muted">
          {row.original.note}
        </span>
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { from: "md", skeleton: "w-40" },
  },
  {
    id: "updated",
    header: "Last change",
    cell: ({ row }) => <DateTime value={row.original.updatedAt} short />,
    meta: {
      from: "xl",
      align: "right",
      skeleton: "w-20",
      className: "w-[12%]",
    },
  },
];

/** The link of a page in the shop, in one language. */
function PageLink({ page, locale }: { page: LegalPage; locale: Locale }) {
  const url = legalPageUrl(locale, page.slug[locale]);
  // A page without a published version does not exist for customers: its
  // address is shown, but there is nothing to open yet.
  return page.current ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-start gap-1 font-medium text-accent-text hover:underline"
    >
      <span className="min-w-0 break-all">{url}</span>
      <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  ) : (
    <span className="break-all text-ink-muted">{url}</span>
  );
}

function TypeSection({
  page,
  versions,
  onNewVersion,
  onPageSettings,
}: {
  page: LegalPage;
  /** The versions of the type, newest first: its history. */
  versions: LegalDocumentSummary[];
  onNewVersion: () => void;
  onPageSettings: () => void;
}) {
  const meta = LEGAL_TYPE[page.type];
  const { current, draft } = page;
  const required = page.requiresConsent;
  const ownSeo = Boolean(page.seo.title || page.seo.description);
  return (
    <section className="flex flex-col gap-3" aria-label={meta.label}>
      <SectionTitle
        description={
          <>
            {meta.description}{" "}
            {required
              ? current
                ? `Customers accept version ${current.version}.`
                : "Required: no order can be placed without a published version."
              : current
                ? `The shop shows version ${current.version}.`
                : "Nobody is asked to accept it, and it never holds an order up."}
          </>
        }
        actions={
          <>
            <ActionButton
              permission="legal.manage"
              icon={<Settings2 />}
              onClick={onPageSettings}
            >
              Page settings
            </ActionButton>
            <ActionButton
              permission="legal.manage"
              icon={<Plus />}
              onClick={onNewVersion}
            >
              New version
            </ActionButton>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          {meta.label}
          {required ? (
            <Badge tone="planned" dot={false}>
              Accepted at checkout
            </Badge>
          ) : null}
        </span>
      </SectionTitle>

      <dl className="glass-inset grid gap-x-6 gap-y-3 rounded-lg px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Published">
          {current ? (
            <>
              Version {current.version}, {formatDate(current.publishedAt)}
              {current.publishedByAdmin
                ? `, by ${current.publishedByAdmin.name}`
                : null}
            </>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              Not published
              {required ? null : (
                <Badge tone="neutral" dot={false}>
                  Not shown in the shop yet
                </Badge>
              )}
            </span>
          )}
        </Fact>
        <Fact label="Draft">
          {draft ? (
            <Link
              href={routes.legalDocument(draft.id)}
              className="font-medium text-accent-text hover:underline"
            >
              Version {draft.version} is a draft
            </Link>
          ) : (
            <span className="text-ink-muted">No draft</span>
          )}
        </Fact>
        <Fact label="Search engines">
          {ownSeo ? (
            "Own title or description"
          ) : (
            <span className="text-ink-muted">The title of the text</span>
          )}
        </Fact>
        {LANGUAGES.map((locale) => (
          <Fact
            key={locale}
            label={`${LOCALE_LABEL[locale]} link`}
            className={locale === "de" ? "xl:col-span-2" : undefined}
          >
            <PageLink page={page} locale={locale} />
          </Fact>
        ))}
      </dl>

      <DataTable
        caption={`Versions of the ${meta.short}, newest first`}
        columns={columns}
        data={versions}
        getRowId={(version) => version.id}
        rowHref={(version) => routes.legalDocument(version.id)}
        empty={
          <EmptyState
            icon={<ScrollText />}
            title={`No ${meta.short} yet`}
            className="py-10"
          >
            {required
              ? "Nobody can check out until a version is published. Start the first version, write the text and publish it."
              : "Start the first version when the shop needs this page. Until one is published, the shop does not show it."}
          </EmptyState>
        }
      />
    </section>
  );
}

/**
 * The six legal pages of the shop: what is published and drafted of each,
 * its address, and its versions.
 */
export function LegalView() {
  const can = useCan();
  const overview = useLegalPages();
  const list = useLegalDocuments();
  const [type, setType] = useState<LegalType>("terms");
  const [starting, setStarting] = useState(false);
  const [settings, setSettings] = useState(false);

  const pages = overview.data?.items ?? null;
  const groups = list.data ? groupByType(list.data.items) : null;
  const requiredTypes = overview.data?.requiredTypes ?? [];
  const blocking = pages ? unpublishedRequiredTypes(pages, requiredTypes) : [];
  const failed =
    overview.isError && !overview.data
      ? overview
      : list.isError && !list.data
        ? list
        : null;
  const notice = failed ? describeError(failed.error) : null;
  const pageOf = (entry: LegalType) =>
    pages?.find((page) => page.type === entry) ?? null;
  const name = (entry: LegalType) => `the ${LEGAL_TYPE[entry]?.short ?? entry}`;

  return (
    <RequirePermission permission="legal.read">
      <PageHeader
        title="Legal texts"
        description="The six legal pages of the shop, each in versions. Customers accept the terms and the privacy policy at checkout: both must be published before anyone can check out. The other pages inform. A published version never changes: a correction is a new version."
      />
      <PageBody className="gap-8">
        {blocking.length > 0 ? (
          <Alert
            tone="danger"
            title={`Checkout is refused: ${blocking
              .map(name)
              .join(
                " and ",
              )} ${blocking.length === 1 ? "is" : "are"} not published`}
            actions={
              can("legal.manage")
                ? blocking.map((entry) => {
                    const draft = pageOf(entry)?.draft;
                    return draft ? (
                      <Button key={entry} size="sm" asChild>
                        <Link href={routes.legalDocument(draft.id)}>
                          Open the draft of {name(entry)}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        key={entry}
                        size="sm"
                        onClick={() => {
                          setType(entry);
                          setStarting(true);
                        }}
                      >
                        Start {name(entry)}
                      </Button>
                    );
                  })
                : null
            }
          >
            The shop accepts no order until{" "}
            {requiredTypes.map(name).join(" and ")}{" "}
            {requiredTypes.length === 1 ? "has" : "have"} a published version.
          </Alert>
        ) : null}

        {notice ? (
          <Alert
            tone="danger"
            title="The legal texts could not be loaded"
            actions={
              <Button onClick={() => void failed?.refetch()}>Try again</Button>
            }
          >
            {notice.message}
            {notice.requestId ? (
              <span className="mt-1 block font-mono text-2xs break-all">
                {notice.technical} · Request {notice.requestId}
              </span>
            ) : null}
          </Alert>
        ) : pages && groups ? (
          // Six pages, in the order the API answers them.
          pages.map((page) => (
            <TypeSection
              key={page.type}
              page={page}
              versions={groups[page.type] ?? []}
              onNewVersion={() => {
                setType(page.type);
                setStarting(true);
              }}
              onPageSettings={() => {
                setType(page.type);
                setSettings(true);
              }}
            />
          ))
        ) : (
          <div className="flex flex-col gap-8" aria-busy="true">
            <span className="sr-only" role="status">
              Loading the legal texts
            </span>
            {LEGAL_TYPES.map((entry) => (
              <div key={entry} className="flex flex-col gap-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-28 rounded-lg" />
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <NewVersionDialog
        type={type}
        versions={groups?.[type] ?? []}
        acceptedAtCheckout={requiredTypes.includes(type)}
        open={starting}
        onOpenChange={setStarting}
      />
      <PageSettingsDialog
        page={pageOf(type)}
        open={settings}
        onOpenChange={setSettings}
      />
    </RequirePermission>
  );
}
