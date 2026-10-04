"use client";

import { GitCompareArrows } from "lucide-react";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import type {
  Id,
  LegalDocumentSummary,
  LegalStatus,
  Locale,
  TranslatedOptional,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format/dates";
import { LOCALE_LABEL, plural } from "@/lib/format/names";
import {
  afterParts,
  beforeParts,
  diffTexts,
  type DiffPart,
  type DiffRow,
} from "./diff";
import { LEGAL_TYPE, hasText } from "./legal";
import { useLegalDocument } from "./queries";
import { Segmented } from "./segmented";

/** One side of a comparison: a saved version, or the draft as it is typed. */
export interface CompareSide {
  version: number;
  status: LegalStatus;
  publishedAt?: string | null;
  title: TranslatedOptional;
  content: TranslatedOptional;
  /** The text is what stands in the editor, saved or not. */
  live?: boolean;
}

function sideLabel(side: CompareSide): string {
  if (side.live) return `Version ${side.version}, as typed now`;
  if (side.status === "published") {
    return `Version ${side.version}, published ${formatDate(side.publishedAt)}`;
  }
  return `Version ${side.version}, draft`;
}

const CHANGE_LABEL = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
} as const;
const CHANGE_SIGN = { added: "+", removed: "−", changed: "±" } as const;

/** The text of a passage without the line break that ends it. */
function trimmed(parts: DiffPart[]): DiffPart[] {
  if (parts.length === 0) return parts;
  const last = parts[parts.length - 1] as DiffPart;
  return [
    ...parts.slice(0, -1),
    { ...last, text: last.text.replace(/\n$/, "") },
  ];
}

/**
 * The words of a passage. What was added is underlined, what was removed is
 * struck through: the change never depends on the colour alone.
 */
function Parts({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {trimmed(parts).map((part, index) =>
        part.change === "added" ? (
          <ins
            key={index}
            className="rounded-xs bg-success-bg text-success-fg underline decoration-success-dot underline-offset-2"
          >
            {part.text}
          </ins>
        ) : part.change === "removed" ? (
          <del
            key={index}
            className="rounded-xs bg-danger-bg text-danger-fg line-through decoration-danger-dot"
          >
            {part.text}
          </del>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const CONTEXT_LINES = 3;

/** A long passage that did not change shows its first and last lines only. */
function shorten(
  text: string,
): { head: string; hidden: number; tail: string } | null {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length <= CONTEXT_LINES * 2 + 2) return null;
  return {
    head: lines.slice(0, CONTEXT_LINES).join("\n"),
    hidden: lines.length - CONTEXT_LINES * 2,
    tail: lines.slice(-CONTEXT_LINES).join("\n"),
  };
}

const cell = "min-w-0 px-3.5 py-2 break-words whitespace-pre-wrap";

function Gutter({ kind }: { kind: DiffRow["kind"] }) {
  if (kind === "same") return <span aria-hidden="true" />;
  return (
    <span
      className={cn(
        "py-2 text-center font-semibold select-none",
        kind === "added" && "text-success-fg",
        kind === "removed" && "text-danger-fg",
        kind === "changed" && "text-attention-fg",
      )}
    >
      <span aria-hidden="true">{CHANGE_SIGN[kind]}</span>
      <span className="sr-only">{CHANGE_LABEL[kind]}:</span>
    </span>
  );
}

function DiffBody({ rows, split }: { rows: DiffRow[]; split: boolean }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const tint = (kind: DiffRow["kind"], side: "before" | "after" | "both") => {
    if (kind === "added")
      return side === "before" ? "bg-sunken/60" : "bg-success-bg/40";
    if (kind === "removed")
      return side === "after" ? "bg-sunken/60" : "bg-danger-bg/40";
    if (kind === "changed") return "bg-attention-bg/30";
    return "";
  };

  /** One passage: across the whole width, or once per column. */
  function line(
    key: string,
    kind: DiffRow["kind"],
    before: ReactNode,
    after: ReactNode,
    both: ReactNode,
  ) {
    if (!split) {
      return (
        <div
          key={key}
          className={cn(
            "grid grid-cols-[1.75rem_minmax(0,1fr)] border-t border-line first:border-t-0",
            tint(kind, "both"),
          )}
        >
          <Gutter kind={kind} />
          <div className={cn(cell, "pl-0")}>{both}</div>
        </div>
      );
    }
    return (
      <Fragment key={key}>
        <div className={cn(cell, "border-t border-line", tint(kind, "before"))}>
          {before}
        </div>
        <div
          className={cn(
            cell,
            "border-t border-l border-line",
            tint(kind, "after"),
          )}
        >
          {after}
        </div>
      </Fragment>
    );
  }

  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === "same") {
          const text = row.parts.map((part) => part.text).join("");
          const short = expanded.has(index) ? null : shorten(text);
          if (!short) {
            const whole = <Parts parts={row.parts} />;
            return line(`${index}`, "same", whole, whole, whole);
          }
          return (
            <Fragment key={index}>
              {line(
                `${index}-head`,
                "same",
                short.head,
                short.head,
                short.head,
              )}
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => new Set(current).add(index))
                }
                className={cn(
                  "border-t border-line bg-sunken px-3.5 py-1.5 text-left font-sans text-13 font-medium text-accent-text hover:underline",
                  split && "col-span-2",
                )}
              >
                Show {plural(short.hidden, "more unchanged line")}
              </button>
              {line(
                `${index}-tail`,
                "same",
                short.tail,
                short.tail,
                short.tail,
              )}
            </Fragment>
          );
        }
        return line(
          `${index}`,
          row.kind,
          <Parts parts={beforeParts(row)} />,
          <Parts parts={afterParts(row)} />,
          <Parts parts={row.parts} />,
        );
      })}
    </>
  );
}

function LanguageDiff({
  before,
  after,
  language,
  split,
}: {
  before: CompareSide;
  after: CompareSide;
  language: Locale;
  split: boolean;
}) {
  const beforeText = before.content[language];
  const afterText = after.content[language];
  const diff = useMemo(
    () => diffTexts(beforeText, afterText),
    [beforeText, afterText],
  );
  const name = LOCALE_LABEL[language];
  const hadText = hasText(beforeText);
  const hasNow = hasText(afterText);
  const beforeTitle = before.title[language]?.trim() ?? "";
  const afterTitle = after.title[language]?.trim() ?? "";

  return (
    <div className="flex flex-col gap-3">
      {!hasNow ? (
        <Alert
          tone="warning"
          title={`${name} is missing in version ${after.version}`}
        >
          {hadText
            ? `Version ${before.version} had a ${name} text: all of it shows as removed.`
            : `Version ${before.version} had no ${name} text either.`}
        </Alert>
      ) : !hadText ? (
        <Alert
          tone="info"
          title={`Version ${before.version} had no ${name} text`}
        >
          All of the {name} text is new in version {after.version}.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {diff.identical ? (
          <Badge tone="neutral">
            {hasNow || hadText
              ? `The ${name} text is the same`
              : `No ${name} text to compare`}
          </Badge>
        ) : (
          <>
            <Badge tone="success">
              {plural(diff.addedWords, "word")} added
            </Badge>
            <Badge tone="danger">
              {plural(diff.removedWords, "word")} removed
            </Badge>
          </>
        )}
        {beforeTitle !== afterTitle ? (
          <span className="text-13 text-ink-muted">
            Title:{" "}
            {beforeTitle ? (
              <del className="rounded-xs bg-danger-bg px-1 text-danger-fg line-through">
                {beforeTitle}
              </del>
            ) : null}{" "}
            {afterTitle ? (
              <ins className="rounded-xs bg-success-bg px-1 text-success-fg underline underline-offset-2">
                {afterTitle}
              </ins>
            ) : (
              <span className="text-ink-subtle">no {name} title</span>
            )}
          </span>
        ) : null}
      </div>

      {hasNow || hadText ? (
        <div
          lang={language}
          className={cn(
            "overflow-hidden rounded-lg border border-line bg-surface font-mono text-13 leading-relaxed text-ink",
            split ? "grid grid-cols-2" : "flex flex-col",
          )}
        >
          {split ? (
            <>
              <div className="bg-sunken px-3.5 py-2 font-sans text-xs font-semibold text-ink-muted">
                {sideLabel(before)}
              </div>
              <div className="border-l border-line bg-sunken px-3.5 py-2 font-sans text-xs font-semibold text-ink-muted">
                {sideLabel(after)}
              </div>
            </>
          ) : null}
          <DiffBody rows={diff.rows} split={split} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What changed between this version and another of the same type: per
 * language, as one text with the changes marked, or with both versions
 * side by side.
 */
export function LegalCompare({
  current,
  others,
  defaultOtherId,
}: {
  current: CompareSide & { type: LegalDocumentSummary["type"] };
  /** The other versions of the same type, newest first. */
  others: readonly LegalDocumentSummary[];
  defaultOtherId: Id | null;
}) {
  const selectId = useId();
  const [chosen, setChosen] = useState<Id | null>(defaultOtherId);
  const otherId = others.some((entry) => entry.id === chosen)
    ? chosen
    : (others[0]?.id ?? null);
  const [language, setLanguage] = useState<Locale>("en");
  const [layout, setLayout] = useState<"inline" | "split">("inline");
  const other = useLegalDocument(otherId ?? undefined);

  if (others.length === 0 || !otherId) {
    return (
      <div className="rounded-lg border border-line">
        <EmptyState
          icon={<GitCompareArrows />}
          title="Nothing to compare with yet"
        >
          This is the only version of the {LEGAL_TYPE[current.type].short}. The
          next version is compared with this one.
        </EmptyState>
      </div>
    );
  }

  const otherSide: CompareSide | null = other.data
    ? {
        version: other.data.version,
        status: other.data.status,
        publishedAt: other.data.publishedAt,
        title: other.data.title,
        content: other.data.content,
      }
    : null;
  // The earlier version is always the left side, whichever was opened.
  const [before, after] =
    otherSide && otherSide.version > current.version
      ? [current, otherSide]
      : [otherSide, current];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={selectId} className="text-13 font-medium text-ink">
            Compare with
          </label>
          <Select
            id={selectId}
            value={otherId}
            onChange={(event) => setChosen(event.target.value)}
            className="min-w-64"
          >
            {others.map((entry) => (
              <option key={entry.id} value={entry.id}>
                Version {entry.version} ·{" "}
                {entry.status === "published"
                  ? `published ${formatDate(entry.publishedAt)}`
                  : "draft"}
                {entry.isCurrent ? " · current" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Language"
            value={language}
            onChange={setLanguage}
            options={(["en", "de"] as const).map((locale) => ({
              value: locale,
              label: (
                <>
                  {LOCALE_LABEL[locale]}
                  {hasText(current.content[locale]) ? null : (
                    <span className="text-attention-fg">(missing)</span>
                  )}
                </>
              ),
            }))}
          />
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "inline", label: "One text" },
              { value: "split", label: "Side by side" },
            ]}
          />
        </div>
      </div>

      {other.isError && !other.data ? (
        <Alert
          tone="danger"
          title="The other version could not be loaded"
          actions={
            <Button onClick={() => void other.refetch()}>Try again</Button>
          }
        >
          {errorMessage(other.error)}
        </Alert>
      ) : !before || !after ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only" role="status">
            Loading the other version
          </span>
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <LanguageDiff
          key={`${otherId}-${language}`}
          before={before}
          after={after}
          language={language}
          split={layout === "split"}
        />
      )}
    </div>
  );
}
