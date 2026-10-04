"use client";

import { Plus, ScrollText } from "lucide-react";
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
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import type { LegalDocumentSummary, LegalType } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { routes } from "@/lib/routes";
import {
  LEGAL_TYPE,
  LEGAL_TYPES,
  groupByType,
  unpublishedRequiredTypes,
} from "./legal";
import { NewVersionDialog } from "./new-version-dialog";
import { useLegalDocuments } from "./queries";

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
    meta: { skeleton: "w-32", className: "w-[26%]" },
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
    meta: { className: "w-[20%]" },
  },
  {
    id: "published",
    header: "Published",
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <DateTime value={row.original.publishedAt} />
      ) : (
        <span className="text-ink-subtle">Not yet</span>
      ),
    meta: { from: "sm", skeleton: "w-28", className: "w-[19%]" },
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
      from: "lg",
      align: "right",
      skeleton: "w-20",
      className: "w-[13%]",
    },
  },
];

function TypeSection({
  type,
  versions,
  required,
  onNewVersion,
}: {
  type: LegalType;
  versions: LegalDocumentSummary[];
  required: boolean;
  onNewVersion: () => void;
}) {
  const meta = LEGAL_TYPE[type];
  const current = versions.find((version) => version.isCurrent);
  return (
    <section className="flex flex-col gap-3" aria-label={meta.label}>
      <SectionTitle
        description={
          <>
            {meta.description}{" "}
            {current
              ? `Customers accept version ${current.version}.`
              : required
                ? "Required: no order can be placed without a published version."
                : "Optional: nothing is published."}
          </>
        }
        actions={
          <ActionButton
            permission="legal.manage"
            icon={<Plus />}
            onClick={onNewVersion}
          >
            New version
          </ActionButton>
        }
      >
        {meta.label}
      </SectionTitle>
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
              ? "Customers cannot order until a version is published. Start the first version, write the text and publish it."
              : "Start the first version when the shop needs this text."}
          </EmptyState>
        }
      />
    </section>
  );
}

/** The legal texts of the shop, grouped by type, each in its versions. */
export function LegalView() {
  const can = useCan();
  const list = useLegalDocuments();
  const [type, setType] = useState<LegalType>("terms");
  const [starting, setStarting] = useState(false);

  const groups = list.data ? groupByType(list.data.items) : null;
  const requiredTypes = list.data?.requiredTypes ?? [];
  const blocking = list.data
    ? unpublishedRequiredTypes(list.data.items, requiredTypes)
    : [];
  const notice = list.isError && !list.data ? describeError(list.error) : null;

  return (
    <RequirePermission permission="legal.read">
      <PageHeader
        title="Legal texts"
        description="Terms, pre-order terms and the privacy policy, in versions. Customers accept the current published versions at checkout. A published version never changes: a correction is a new version."
      />
      <PageBody className="gap-8">
        {blocking.length > 0 ? (
          <Alert
            tone="danger"
            title={`Orders are refused: ${blocking
              .map((entry) => `the ${LEGAL_TYPE[entry].short}`)
              .join(
                " and ",
              )} ${blocking.length === 1 ? "is" : "are"} not published`}
            actions={
              can("legal.manage")
                ? blocking.map((entry) => {
                    // Nothing is published, so the newest version is a draft.
                    const draft = groups?.[entry][0];
                    return draft ? (
                      <Button key={entry} size="sm" asChild>
                        <Link href={routes.legalDocument(draft.id)}>
                          Open the draft of the {LEGAL_TYPE[entry].short}
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
                        Start the {LEGAL_TYPE[entry].short}
                      </Button>
                    );
                  })
                : null
            }
          >
            The shop accepts no order until{" "}
            {requiredTypes
              .map((entry) => `the ${LEGAL_TYPE[entry].short}`)
              .join(" and ")}{" "}
            {requiredTypes.length === 1 ? "has" : "have"} a published version.
          </Alert>
        ) : null}

        {notice ? (
          <Alert
            tone="danger"
            title="The legal texts could not be loaded"
            actions={
              <Button onClick={() => void list.refetch()}>Try again</Button>
            }
          >
            {notice.message}
            {notice.requestId ? (
              <span className="mt-1 block font-mono text-2xs break-all">
                {notice.technical} · Request {notice.requestId}
              </span>
            ) : null}
          </Alert>
        ) : groups ? (
          LEGAL_TYPES.map((entry) => (
            <TypeSection
              key={entry}
              type={entry}
              versions={groups[entry]}
              required={requiredTypes.includes(entry)}
              onNewVersion={() => {
                setType(entry);
                setStarting(true);
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
        open={starting}
        onOpenChange={setStarting}
      />
    </RequirePermission>
  );
}
