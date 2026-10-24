"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Ellipsis,
  Eye,
  EyeOff,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
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
import type { Faq, FaqGroup, Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { moveItem } from "@/features/catalogue/category-tree";
import {
  DragHandle,
  SortableList,
  useSortableEntry,
} from "@/features/catalogue/sortable";
import { FaqDialog, type FaqEdit } from "./faq-dialog";
import { GroupDialog, type GroupEdit } from "./group-dialog";
import {
  useDeleteFaq,
  useDeleteFaqGroup,
  useFaqGroups,
  useFaqs,
  useReorderFaqGroups,
  useReorderFaqs,
  useUpdateFaq,
  useUpdateFaqGroup,
} from "./queries";

interface Actions {
  manage: boolean;
  busy: boolean;
  editFaq: (faq: Faq) => void;
  newFaq: (groupId: Id | null) => void;
  publish: (faq: Faq, published: boolean) => void;
  removeFaq: (faq: Faq) => void;
  reorderFaqs: (groupId: Id | null, orderedIds: Id[]) => void;
  editGroup: (group: FaqGroup) => void;
  showGroup: (group: FaqGroup, visible: boolean) => void;
  removeGroup: (group: FaqGroup) => void;
  reorderGroups: (orderedIds: Id[]) => void;
}

/** What a question is called in the interface. */
const questionLabel = (faq: Faq) => translated(faq.question);

function QuestionRow({
  faq,
  index,
  ids,
  groupId,
  actions,
}: {
  faq: Faq;
  index: number;
  ids: Id[];
  groupId: Id | null;
  actions: Actions;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    faq.id,
  );
  const { manage, busy } = actions;
  const label = questionLabel(faq);
  const german = faq.question.de?.trim();
  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "border-t border-line",
        dragging && "relative z-10 rounded-md bg-surface shadow-pop",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_2rem] items-center gap-x-3 py-2 pr-2 pl-1.5">
        <DragHandle
          setHandle={setHandle}
          handleProps={handleProps}
          label={`Move ${label}, place ${index + 1} of ${ids.length}`}
          disabled={!manage || ids.length < 2 || busy}
        />
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => actions.editFaq(faq)}
              className="truncate rounded-xs text-left text-sm font-semibold text-accent-text hover:underline"
            >
              {label}
            </button>
            <Badge tone={faq.isPublished ? "success" : "neutral"}>
              {faq.isPublished ? "Published" : "Draft"}
            </Badge>
          </span>
          {german ? (
            <span lang="de" className="truncate text-13 text-ink-subtle">
              {german}
            </span>
          ) : (
            <span className="text-13 text-ink-subtle">
              No German question yet
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-13 text-ink-muted">
          <Switch
            checked={faq.isPublished}
            disabled={!manage || busy}
            aria-label={`${label} is published`}
            onCheckedChange={(checked) => actions.publish(faq, checked)}
          />
          <span className="hidden sm:inline" aria-hidden="true">
            {faq.isPublished ? "On" : "Off"}
          </span>
        </label>
        {manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${label}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => actions.editFaq(faq)}>
                <PencilLine />
                Edit
              </DropdownMenuItem>
              {ids.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() =>
                      actions.reorderFaqs(
                        groupId,
                        moveItem(ids, index, index - 1),
                      )
                    }
                  >
                    <ArrowUp />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === ids.length - 1}
                    onSelect={() =>
                      actions.reorderFaqs(
                        groupId,
                        moveItem(ids, index, index + 1),
                      )
                    }
                  >
                    <ArrowDown />
                    Move down
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={() => actions.removeFaq(faq)}>
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

/** The questions of one group (or of none), in their order. */
function QuestionList({
  groupId,
  name,
  faqs,
  actions,
}: {
  groupId: Id | null;
  name: string;
  faqs: Faq[];
  actions: Actions;
}) {
  const ids = useMemo(() => faqs.map((faq) => faq.id), [faqs]);
  if (faqs.length === 0) {
    return (
      <p className="border-t border-line px-4 py-3 text-13 text-ink-subtle">
        No question here yet.
      </p>
    );
  }
  return (
    <SortableList
      ids={ids}
      labelOf={(id) => {
        const faq = faqs.find((entry) => entry.id === id);
        return faq ? questionLabel(faq) : "the question";
      }}
      layout="list"
      disabled={!actions.manage || ids.length < 2 || actions.busy}
      onReorder={(orderedIds) => actions.reorderFaqs(groupId, orderedIds)}
    >
      <ul aria-label={`Questions of ${name}`}>
        {faqs.map((faq, index) => (
          <QuestionRow
            key={faq.id}
            faq={faq}
            index={index}
            ids={ids}
            groupId={groupId}
            actions={actions}
          />
        ))}
      </ul>
    </SortableList>
  );
}

function GroupSection({
  group,
  index,
  ids,
  faqs,
  actions,
}: {
  group: FaqGroup;
  index: number;
  ids: Id[];
  faqs: Faq[];
  actions: Actions;
}) {
  const { setNode, style, dragging, setHandle, handleProps } = useSortableEntry(
    group.id,
  );
  const { manage, busy } = actions;
  const name = translated(group.name);
  const german = group.name.de?.trim();
  const count = group.faqCount ?? faqs.length;
  const published =
    group.publishedCount ?? faqs.filter((faq) => faq.isPublished).length;
  return (
    <li
      ref={setNode}
      style={style}
      className={cn(
        "rounded-lg border border-line bg-surface",
        dragging && "relative z-10 shadow-pop",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-2 pl-1.5">
        <DragHandle
          setHandle={setHandle}
          handleProps={handleProps}
          label={`Move the group ${name}, place ${index + 1} of ${ids.length}`}
          disabled={!manage || ids.length < 2 || busy}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="truncate text-base font-semibold text-ink">
              {name}
            </h2>
            {group.isVisible ? null : (
              <Badge tone="attention">Hidden in the shop</Badge>
            )}
          </span>
          <span className="text-13 text-ink-subtle">
            {german ? (
              <>
                <span lang="de">{german}</span> ·{" "}
              </>
            ) : null}
            {plural(count, "question")}, {published} published
          </span>
        </div>
        {manage ? (
          <>
            <Button
              size="sm"
              icon={<Plus />}
              disabled={busy}
              onClick={() => actions.newFaq(group.id)}
            >
              Add question
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for the group ${name}`}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => actions.editGroup(group)}>
                  <PencilLine />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => actions.showGroup(group, !group.isVisible)}
                >
                  {group.isVisible ? <EyeOff /> : <Eye />}
                  {group.isVisible ? "Hide in the shop" : "Show in the shop"}
                </DropdownMenuItem>
                {ids.length > 1 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={index === 0}
                      onSelect={() =>
                        actions.reorderGroups(moveItem(ids, index, index - 1))
                      }
                    >
                      <ArrowUp />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === ids.length - 1}
                      onSelect={() =>
                        actions.reorderGroups(moveItem(ids, index, index + 1))
                      }
                    >
                      <ArrowDown />
                      Move down
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  disabled={count > 0}
                  onSelect={() => actions.removeGroup(group)}
                >
                  <Trash2 />
                  <span className="flex flex-col">
                    Delete
                    {count > 0 ? (
                      <span className="text-xs font-normal text-ink-subtle">
                        Move or delete its questions first
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </header>
      <QuestionList
        groupId={group.id}
        name={name}
        faqs={faqs}
        actions={actions}
      />
    </li>
  );
}

/** The FAQ (22): groups in order, each with its questions in order, then the ones without a group. */
export function FaqView() {
  const manage = useCan()("content.manage");
  const groups = useFaqGroups();
  const faqs = useFaqs();
  const updateFaq = useUpdateFaq();
  const updateGroup = useUpdateFaqGroup();
  const removeFaq = useDeleteFaq();
  const removeGroup = useDeleteFaqGroup();
  const reorderFaqs = useReorderFaqs();
  const reorderGroups = useReorderFaqGroups();

  const [groupEdit, setGroupEdit] = useState<GroupEdit | null>(null);
  const [faqEdit, setFaqEdit] = useState<FaqEdit | null>(null);
  const [deletingFaq, setDeletingFaq] = useState<Faq | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<FaqGroup | null>(null);

  const items = groups.data?.items;
  const all = faqs.data?.items;
  const groupIds = useMemo(
    () => items?.map((group) => group.id) ?? [],
    [items],
  );
  const ungrouped = all?.filter((faq) => faq.groupId === null) ?? [];
  const busy = reorderFaqs.isPending || reorderGroups.isPending;

  const actions: Actions = {
    manage,
    busy,
    editFaq: (faq) => setFaqEdit({ mode: "edit", faq }),
    newFaq: (groupId) => setFaqEdit({ mode: "new", groupId }),
    publish: (faq, published) => {
      updateFaq.mutate(
        { id: faq.id, isPublished: published },
        {
          onSuccess: (saved) =>
            notify.success(
              saved.isPublished
                ? "Question published"
                : "Question taken offline",
              saved.isPublished
                ? saved.group &&
                  !items?.find((g) => g.id === saved.groupId)?.isVisible
                  ? "Its group is hidden: the shop shows it once the group is shown."
                  : "The shop shows it within five minutes."
                : "The shop stops showing it within five minutes.",
            ),
          onError: (error) => notify.error(error),
        },
      );
    },
    removeFaq: (faq) => setDeletingFaq(faq),
    reorderFaqs: (groupId, orderedIds) =>
      reorderFaqs.mutate(
        { groupId, orderedIds },
        { onError: (error) => notify.error(error) },
      ),
    editGroup: (group) => setGroupEdit({ mode: "edit", group }),
    showGroup: (group, visible) =>
      updateGroup.mutate(
        { id: group.id, isVisible: visible },
        {
          onSuccess: (saved) =>
            notify.success(
              saved.isVisible
                ? `${translated(saved.name)} is shown in the shop`
                : `${translated(saved.name)} is hidden in the shop`,
              saved.isVisible
                ? "Its published questions appear within five minutes."
                : "Its questions disappear within five minutes; they stay here.",
            ),
          onError: (error) => notify.error(error),
        },
      ),
    removeGroup: (group) => setDeletingGroup(group),
    reorderGroups: (orderedIds) =>
      reorderGroups.mutate(orderedIds, {
        onError: (error) => notify.error(error),
      }),
  };

  const error = groups.error ?? faqs.error;
  const notice = error ? describeError(error) : null;
  const loading = !items || !all;
  const total = all?.length ?? 0;
  const publishedTotal = all?.filter((faq) => faq.isPublished).length ?? 0;
  const empty = items?.length === 0 && total === 0;

  return (
    <RequirePermission permission="content.read">
      <PageHeader
        title="FAQ"
        description="The questions and answers of the shop, in English and German, under headings in this order. The shop shows the published questions of the shown groups within five minutes; the questions without a group come after the groups."
        actions={
          <>
            <ActionButton
              permission="content.manage"
              icon={<Plus />}
              onClick={() => setGroupEdit({ mode: "new" })}
            >
              New group
            </ActionButton>
            <ActionButton
              permission="content.manage"
              variant="primary"
              icon={<Plus />}
              onClick={() => setFaqEdit({ mode: "new", groupId: null })}
            >
              New question
            </ActionButton>
          </>
        }
      />
      <PageBody className="gap-4">
        {notice && loading ? (
          <Alert
            tone="danger"
            title="The FAQ could not be loaded"
            actions={
              <Button
                onClick={() => {
                  void groups.refetch();
                  void faqs.refetch();
                }}
              >
                Try again
              </Button>
            }
          >
            {notice.message}
          </Alert>
        ) : loading ? (
          <div
            role="status"
            aria-label="Loading the FAQ"
            className="flex flex-col gap-4"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-lg" />
            ))}
          </div>
        ) : empty ? (
          <div className="rounded-lg border border-line">
            <EmptyState
              icon={<CircleHelp />}
              title="No questions yet"
              action={
                manage ? (
                  <Button
                    variant="primary"
                    onClick={() => setFaqEdit({ mode: "new", groupId: null })}
                  >
                    Write the first question
                  </Button>
                ) : null
              }
            >
              The shop shows no FAQ page until a question is published. Groups
              are headings: Orders, Delivery, Returns. A question needs no
              group.
            </EmptyState>
          </div>
        ) : (
          <>
            <SortableList
              ids={groupIds}
              labelOf={(id) => {
                const group = items.find((entry) => entry.id === id);
                return group
                  ? `the group ${translated(group.name)}`
                  : "the group";
              }}
              layout="list"
              disabled={!manage || groupIds.length < 2 || busy}
              onReorder={actions.reorderGroups}
            >
              <ul
                aria-label="FAQ groups in display order"
                className="flex flex-col gap-4"
              >
                {items.map((group, index) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    index={index}
                    ids={groupIds}
                    faqs={all.filter((faq) => faq.groupId === group.id)}
                    actions={actions}
                  />
                ))}
              </ul>
            </SortableList>
            <section
              aria-label="Without group"
              className="rounded-lg border border-dashed border-line-strong bg-surface"
            >
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <h2 className="text-base font-semibold text-ink">
                    Without group
                  </h2>
                  <span className="text-13 text-ink-subtle">
                    Shown after the groups ·{" "}
                    {plural(ungrouped.length, "question")},{" "}
                    {ungrouped.filter((faq) => faq.isPublished).length}{" "}
                    published
                  </span>
                </div>
                {manage ? (
                  <Button
                    size="sm"
                    icon={<Plus />}
                    disabled={busy}
                    onClick={() => actions.newFaq(null)}
                  >
                    Add question
                  </Button>
                ) : null}
              </header>
              <QuestionList
                groupId={null}
                name="the questions without a group"
                faqs={ungrouped}
                actions={actions}
              />
            </section>
            <p className="text-13 text-ink-muted">
              {plural(total, "question")} in {plural(items.length, "group")},{" "}
              {publishedTotal} published.{" "}
              {manage
                ? "Drag a group or a question by its handle, or focus the handle and use Space and the arrow keys. The order is saved at once."
                : "The order here is the order of the shop."}
            </p>
          </>
        )}
      </PageBody>

      <GroupDialog edit={groupEdit} onClose={() => setGroupEdit(null)} />
      <FaqDialog
        edit={faqEdit}
        groups={items ?? []}
        onClose={() => setFaqEdit(null)}
      />

      <ConfirmDialog
        open={deletingFaq !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFaq(null);
        }}
        title="Delete this question?"
        description={
          deletingFaq
            ? `“${questionLabel(deletingFaq)}” is removed for good, with its answer in both languages.${deletingFaq.isPublished ? " The shop stops showing it within five minutes." : ""}`
            : undefined
        }
        confirmLabel="Delete the question"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deletingFaq) return;
          await removeFaq.mutateAsync(deletingFaq.id);
          notify.success("Question deleted");
        }}
      />
      <ConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingGroup(null);
        }}
        title={`Delete the group ${deletingGroup ? translated(deletingGroup.name) : ""}?`}
        description="The heading is removed for good. It has no questions, so nothing else changes."
        confirmLabel="Delete the group"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deletingGroup) return;
          await removeGroup.mutateAsync(deletingGroup.id);
          notify.success(`${translated(deletingGroup.name)} deleted`);
        }}
      />
    </RequirePermission>
  );
}
