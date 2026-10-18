"use client";

import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  ExternalLink,
  GalleryHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { describeError } from "@/lib/api/error-text";
import { BANNER_RULES, type Banner, type Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import { BANNER_STATUS } from "@/lib/status";
import { moveItem } from "@/features/catalogue/category-tree";
import type { SizeReader } from "@/features/catalogue/image-rules";
import {
  DragHandle,
  SortableList,
  useSortableEntry,
} from "@/features/catalogue/sortable";
import { BannerDialog, bannerLabel, type BannerEdit } from "./banner-dialog";
import { periodText } from "./banner-schema";
import {
  useBanners,
  useDeleteBanner,
  useReorderBanners,
  useUpdateBanner,
} from "./queries";

interface Actions {
  manage: boolean;
  edit: (banner: Banner) => void;
  setActive: (banner: Banner, active: boolean) => void;
  remove: (banner: Banner) => void;
  reorder: (orderedIds: Id[]) => void;
}

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_minmax(9rem,13rem)_7rem_2rem]";

/** The link of a banner, as the shop will follow it. */
function LinkText({ linkUrl }: { linkUrl: string | null }) {
  if (!linkUrl) return <span className="text-ink-subtle">No link</span>;
  const external = linkUrl.startsWith("https://");
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1">
      {external ? (
        <ExternalLink
          aria-label="Opens in a new tab"
          className="size-3.5 shrink-0 text-ink-subtle"
        />
      ) : null}
      <span className="truncate font-mono text-xs">{linkUrl}</span>
    </span>
  );
}

function Row({
  banner,
  index,
  ids,
  actions,
}: {
  banner: Banner;
  index: number;
  ids: Id[];
  actions: Actions;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    banner.id,
  );
  const { manage } = actions;
  const movable = manage && ids.length > 1;
  const name = bannerLabel(banner, index);
  const period = periodText(banner, formatDateTime);
  const alt = banner.image.alt?.en?.trim() || banner.image.alt?.de?.trim();

  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "border-t border-line first:border-t-0",
        dragging && "relative z-10 rounded-md bg-surface shadow-pop",
      )}
    >
      <div className={cn(COLUMNS, "py-2 pr-2 pl-1.5")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <DragHandle
            setHandle={setHandle}
            handleProps={handleProps}
            label={`Move ${name}, place ${index + 1} of ${ids.length}`}
            disabled={!movable}
          />
          <button
            type="button"
            onClick={() => actions.edit(banner)}
            aria-label={`Picture of ${name}: open the banner`}
            className="shrink-0 overflow-hidden rounded-md border border-line bg-sunken"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
            <img
              src={banner.image.sizes.small.url}
              alt=""
              width={96}
              height={40}
              loading="lazy"
              decoding="async"
              className="aspect-[12/5] w-20 object-cover sm:w-24"
            />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                onClick={() => actions.edit(banner)}
                className={cn(
                  "truncate rounded-xs text-left text-sm font-semibold hover:underline",
                  banner.status === "live"
                    ? "text-accent-text"
                    : "text-ink-muted",
                )}
              >
                {name}
              </button>
              <StatusBadge
                kind="banner"
                value={banner.status}
                className="sm:hidden"
              />
              {alt ? null : <Badge tone="attention">No description</Badge>}
            </span>
            <span className="flex min-w-0 flex-col text-13 text-ink-subtle">
              <LinkText linkUrl={banner.linkUrl} />
              <span className="sm:hidden">{period}</span>
            </span>
          </div>
        </div>

        <span className="hidden sm:block">
          <StatusBadge kind="banner" value={banner.status} />
        </span>

        <span className="hidden text-13 text-ink-muted sm:block">{period}</span>

        <label className="flex items-center gap-2 text-13 text-ink-muted">
          <Switch
            checked={banner.isActive}
            disabled={!manage}
            aria-label={`${name} is switched on`}
            onCheckedChange={(active) => actions.setActive(banner, active)}
          />
          <span className="hidden sm:inline" aria-hidden="true">
            {banner.isActive ? "On" : "Off"}
          </span>
        </label>

        {manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${name}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => actions.edit(banner)}>
                <PencilLine />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.edit(banner)}>
                <RefreshCw />
                Replace picture
              </DropdownMenuItem>
              {ids.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() =>
                      actions.reorder(moveItem(ids, index, index - 1))
                    }
                  >
                    <ArrowUp />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === ids.length - 1}
                    onSelect={() =>
                      actions.reorder(moveItem(ids, index, index + 1))
                    }
                  >
                    <ArrowDown />
                    Move down
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={() => actions.remove(banner)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span />
        )}
      </div>
    </li>
  );
}

/** What the switch did, from the status the API answered. */
function switchedText(banner: Banner): [string, string | undefined] {
  const name = banner.name?.trim() || "The banner";
  switch (banner.status) {
    case "live":
      return [`${name} is in the shop`, undefined];
    case "scheduled":
      return [
        `${name} is switched on`,
        `It appears in the shop on ${formatDateTime(banner.startsAt)}.`,
      ];
    case "expired":
      return [
        `${name} is switched on, but its period has ended`,
        `It ended on ${formatDateTime(banner.endsAt)}. Move the end to show it.`,
      ];
    default:
      return [`${name} is switched off`, "The shop does not show it."];
  }
}

export function BannersView({
  readSize,
}: {
  /** How the size of a picture is read; tests have no decoder. */
  readSize?: SizeReader;
} = {}) {
  const manage = useCan()("catalog.manage");
  const banners = useBanners();
  const update = useUpdateBanner();
  const remove = useDeleteBanner();
  const reorder = useReorderBanners();

  const [edit, setEdit] = useState<BannerEdit | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);

  const items = banners.data?.items;
  const ids = useMemo(() => items?.map((banner) => banner.id) ?? [], [items]);
  const full = (items?.length ?? 0) >= BANNER_RULES.maxBanners;
  const live = items?.filter((banner) => banner.status === "live").length ?? 0;

  async function setActive(banner: Banner, active: boolean): Promise<void> {
    try {
      const saved = await update.mutateAsync({
        id: banner.id,
        isActive: active,
      });
      notify.success(...switchedText(saved));
    } catch (error) {
      notify.error(error);
    }
  }

  const actions: Actions = {
    manage,
    edit: (banner) => setEdit({ mode: "edit", id: banner.id }),
    setActive: (banner, active) => void setActive(banner, active),
    remove: (banner) => setDeleting(banner),
    reorder: (orderedIds) => {
      reorder.mutate(orderedIds, {
        onError: (error) => notify.error(error),
      });
    },
  };

  // The banner being changed, as the list has it now: a picture replaced in
  // the form shows in the form at once.
  const current =
    edit?.mode === "edit"
      ? (items?.find((banner) => banner.id === edit.id) ?? null)
      : null;
  const notice = banners.error ? describeError(banners.error) : null;

  return (
    <RequirePermission permission="catalog.read">
      <PageHeader
        title="Banners"
        description="The slides of the homepage carousel: one finished picture each, with an optional link and period. The shop shows the live ones, in this order, within a minute of a change."
        actions={
          <ActionButton
            permission="catalog.manage"
            variant="primary"
            icon={<Plus />}
            blocked={
              full
                ? `The shop holds ${BANNER_RULES.maxBanners} banners at most. Delete one first.`
                : undefined
            }
            onClick={() => setEdit({ mode: "new" })}
          >
            New banner
          </ActionButton>
        }
      />
      <PageBody className="gap-3">
        {notice && !items ? (
          <Alert
            tone="danger"
            title="The banners could not be loaded"
            actions={
              <Button onClick={() => void banners.refetch()}>Try again</Button>
            }
          >
            {notice.message}
            {notice.requestId ? (
              <span className="mt-1 block font-mono text-2xs">
                {notice.technical} · Request {notice.requestId}
              </span>
            ) : null}
          </Alert>
        ) : !items ? (
          <div
            role="status"
            aria-label="Loading the banners"
            className="flex flex-col divide-y divide-line rounded-lg border border-line"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="h-10 w-24 rounded-md" />
                <Skeleton className="w-40" />
                <Skeleton className="ml-auto w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<GalleryHorizontal />}
              title="No banner yet"
              action={
                manage ? (
                  <Button
                    variant="primary"
                    onClick={() => setEdit({ mode: "new" })}
                  >
                    Upload the first banner
                  </Button>
                ) : null
              }
            >
              The homepage shows no carousel until a banner is live. Design the
              picture elsewhere, {BANNER_RULES.recommended.width} ×{" "}
              {BANNER_RULES.recommended.height} px, with every text on it.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-line">
              <div
                aria-hidden="true"
                className={cn(
                  COLUMNS,
                  "rounded-t-lg border-b border-line bg-sunken py-2 pr-2 pl-3.5 text-xs font-semibold text-ink-muted",
                )}
              >
                <span>Banner</span>
                <span className="hidden sm:block">Status</span>
                <span className="hidden sm:block">Period</span>
                <span>Switch</span>
                <span />
              </div>
              <SortableList
                ids={ids}
                labelOf={(id) => {
                  const index = ids.indexOf(id);
                  const banner = items[index];
                  return banner ? bannerLabel(banner, index) : "the banner";
                }}
                layout="list"
                disabled={!manage || ids.length < 2 || reorder.isPending}
                onReorder={actions.reorder}
              >
                <ul aria-label="Banners in display order">
                  {items.map((banner, index) => (
                    <Row
                      key={banner.id}
                      banner={banner}
                      index={index}
                      ids={ids}
                      actions={actions}
                    />
                  ))}
                </ul>
              </SortableList>
            </div>
            <p className="text-13 text-ink-muted">
              {plural(items.length, "banner")} of {BANNER_RULES.maxBanners},{" "}
              {live === 0 ? "none" : live}{" "}
              {BANNER_STATUS.live.label.toLowerCase()}.{" "}
              {manage
                ? "Drag a banner by its handle to change its place in the carousel, or focus the handle and use Space and the arrow keys."
                : "The order here is the order of the carousel."}
            </p>
          </>
        )}
      </PageBody>

      <BannerDialog
        edit={edit?.mode === "edit" && !current ? null : edit}
        banner={current}
        onClose={() => setEdit(null)}
        onCreated={(banner) => setEdit({ mode: "edit", id: banner.id })}
        readSize={readSize}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting ? bannerLabel(deleting, ids.indexOf(deleting.id)) : "the banner"}?`}
        description="The banner and its picture are removed for good; the file is not kept. The shop stops showing it within a minute."
        facts={
          deleting
            ? [
                {
                  label: "Status",
                  value: BANNER_STATUS[deleting.status].label,
                  strong: deleting.status === "live",
                },
                { label: "Link", value: deleting.linkUrl ?? "None" },
              ]
            : []
        }
        confirmLabel="Delete the banner"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          notify.success("Banner deleted");
        }}
      >
        {deleting ? (
          // eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes
          <img
            src={deleting.image.sizes.small.url}
            alt=""
            style={{
              aspectRatio: `${deleting.image.sizes.large.width} / ${deleting.image.sizes.large.height}`,
            }}
            className="w-full rounded-md border border-line bg-sunken object-contain"
          />
        ) : null}
      </ConfirmDialog>
    </RequirePermission>
  );
}
