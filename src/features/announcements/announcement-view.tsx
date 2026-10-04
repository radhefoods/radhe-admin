"use client";

import { MegaphoneOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { DateTime, useAdminNames } from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Badge, toneClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { notify } from "@/components/ui/toast";
import { CHANNEL_LABEL } from "@/features/notifications/labels";
import { useWhatsappEnabled } from "@/features/notifications/queries";
import { WhatsappState } from "@/features/notifications/whatsapp-state";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  type Announcement,
  type AnnouncementProgress,
  type AnnouncementWithProgress,
  type NotificationCounts,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { NOTIFICATION_STATUS } from "@/lib/status";
import { AnnouncementAbout } from "./announcements-view";
import {
  stillGoingOut,
  useAnnouncement,
  useCancelAnnouncement,
} from "./queries";

const back = { href: routes.announcements, label: "Announcements" };

function total(counts: NotificationCounts): number {
  return NOTIFICATION_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

/** The messages that can still be withdrawn: the queued ones (15: cancel). */
function waiting(progress: AnnouncementProgress): number {
  return progress.email.queued + progress.whatsapp.queued;
}

/**
 * The progress of an announcement: its messages per channel and status,
 * always with every status, each number leading to those messages.
 */
function Progress({ announcement, progress }: AnnouncementWithProgress) {
  const whatsappEnabled = useWhatsappEnabled();
  const live = stillGoingOut(progress) > 0;

  return (
    <Card>
      <CardHeader
        title="Progress"
        description={
          live
            ? "Messages are going out. The numbers are read again every 10 seconds."
            : "Every message of this announcement, by channel and status. A number leads to those messages."
        }
      />
      <ScrollX label="Messages of this announcement by channel and status">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Messages of this announcement by channel and status
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-line px-4 py-2 text-left text-xs font-semibold text-ink-muted sm:px-5"
              >
                Channel
              </th>
              {NOTIFICATION_STATUSES.map((status) => (
                <th
                  key={status}
                  scope="col"
                  className="border-b border-line px-3 py-2 text-right text-xs font-semibold whitespace-nowrap text-ink-muted"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        toneClass[NOTIFICATION_STATUS[status].tone].dot,
                      )}
                    />
                    {NOTIFICATION_STATUS[status].label}
                  </span>
                </th>
              ))}
              <th
                scope="col"
                className="border-b border-line px-4 py-2 text-right text-xs font-semibold text-ink-muted sm:px-5"
              >
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const counts = progress[channel];
              const chosen = announcement.channels.includes(channel);
              return (
                <tr key={channel} className="[&:last-child>*]:border-b-0">
                  <th
                    scope="row"
                    className="border-b border-line px-4 py-3 text-left font-medium whitespace-nowrap text-ink sm:px-5"
                  >
                    {CHANNEL_LABEL[channel]}
                    {chosen ? null : (
                      <span className="ml-2 text-13 font-normal text-ink-subtle">
                        not chosen
                      </span>
                    )}
                  </th>
                  {NOTIFICATION_STATUSES.map((status) => (
                    <td
                      key={status}
                      className="border-b border-line px-3 py-3 text-right tabular"
                    >
                      {counts[status] > 0 ? (
                        <Link
                          href={withQuery(routes.notifications, {
                            announcementId: announcement.id,
                            channel,
                            status,
                          })}
                          aria-label={`${counts[status]} ${NOTIFICATION_STATUS[status].label.toLowerCase()} by ${CHANNEL_LABEL[channel]}: open these messages`}
                          className={cn(
                            "font-semibold hover:underline",
                            status === "failed" ? "text-danger-fg" : "text-ink",
                          )}
                        >
                          {counts[status].toLocaleString("en")}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">0</span>
                      )}
                    </td>
                  ))}
                  <td className="border-b border-line px-4 py-3 text-right font-semibold text-ink tabular sm:px-5">
                    {total(counts).toLocaleString("en")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      {progress.whatsapp.skipped > 0 && whatsappEnabled === false ? (
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <WhatsappState enabled={false} className="border-0 p-0">
            The WhatsApp messages are stored as skipped because WhatsApp is not
            configured in the API. They can be sent again, one by one, once it
            is.
          </WhatsappState>
        </div>
      ) : null}
    </Card>
  );
}

function Language({
  tag,
  name,
  lang,
  subject,
  message,
}: {
  tag: string;
  name: string;
  lang: string;
  subject: string | null | undefined;
  message: string | null | undefined;
}) {
  const missing = !subject?.trim() && !message?.trim();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex items-center gap-2 text-2xs font-semibold tracking-wide text-ink-subtle">
        <span className="rounded-xs bg-sunken px-1 text-ink-muted">{tag}</span>
        {name}
      </p>
      {missing ? (
        <Badge tone="attention" className="self-start">
          {name} is missing
        </Badge>
      ) : (
        <div lang={lang} className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-ink">
            {subject?.trim() || (
              <span className="font-normal text-ink-subtle">No subject</span>
            )}
          </p>
          <p className="text-sm break-words whitespace-pre-line text-ink">
            {message?.trim() || (
              <span className="text-ink-subtle">No message</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function Details({ announcement }: { announcement: Announcement }) {
  const adminName = useAdminNames();
  const label = announcement.linkLabel;
  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="About">
            <AnnouncementAbout announcement={announcement} />
          </Fact>
          <Fact label="Channels">
            {announcement.channels
              .map((channel) => CHANNEL_LABEL[channel] ?? channel)
              .join(", ")}
          </Fact>
          <Fact label="Recipients">
            <span className="tabular">
              {plural(announcement.recipients, "customer")}
            </span>
          </Fact>
          <Fact label="Messages queued">
            <span className="tabular">
              {announcement.queued.toLocaleString("en")}
            </span>
          </Fact>
          <Fact label="Button leads to" className="sm:col-span-2">
            {announcement.link ? (
              <a
                href={announcement.link}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-accent-text underline-offset-2 hover:underline"
              >
                {announcement.link}
              </a>
            ) : (
              <span className="text-ink-subtle">The shop</span>
            )}
          </Fact>
          <Fact label="Button label" className="sm:col-span-2">
            {label?.en || label?.de ? (
              <span className="flex flex-col">
                {label.en ? <span>{label.en}</span> : null}
                {label.de ? <span lang="de">{label.de}</span> : null}
              </span>
            ) : (
              <span className="text-ink-subtle">
                The default: “Visit the shop”, “Zum Shop”
              </span>
            )}
          </Fact>
          <Fact label="Sent">
            <DateTime value={announcement.createdAt} />
          </Fact>
          <Fact label="Sent by">{adminName(announcement.createdBy)}</Fact>
          {announcement.cancelledAt ? (
            <Fact label="Cancelled">
              <DateTime value={announcement.cancelledAt} />
            </Fact>
          ) : null}
        </dl>
      </CardBody>
    </Card>
  );
}

export function AnnouncementView() {
  const { id } = useParams<{ id: string }>();
  const query = useAnnouncement(id);
  const cancel = useCancelAnnouncement(id);
  const [cancelling, setCancelling] = useState(false);

  if (query.isError) {
    return (
      <RequirePermission permission="notifications.read">
        <PageHeader title="Announcement" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            query.error,
            "ANNOUNCEMENT_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState
              icon={<MegaphoneOff />}
              title="This announcement does not exist"
            >
              The link may be old, or the address was mistyped.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The announcement could not be loaded"
              actions={
                <Button onClick={() => void query.refetch()}>Try again</Button>
              }
            >
              {errorMessage(query.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <RequirePermission permission="notifications.read">
        <PageHeader title={<Skeleton className="h-9 w-72" />} back={back} />
        <div className={cn(gutter, "flex flex-col gap-6")}>
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  const { announcement, progress } = data;
  const queued = waiting(progress);
  const sent = progress.email.sent + progress.whatsapp.sent;

  return (
    <RequirePermission permission="notifications.read">
      <PageHeader
        back={back}
        title={announcement.subject.en}
        badges={
          <>
            {announcement.cancelledAt ? <Badge>Cancelled</Badge> : null}
            {queued > 0 ? (
              <Badge tone="planned">{plural(queued, "message")} waiting</Badge>
            ) : null}
          </>
        }
        description={
          <>
            Sent {formatDateTime(announcement.createdAt)} to{" "}
            {plural(announcement.recipients, "customer")}
          </>
        }
        actions={
          <>
            <Button asChild>
              <Link
                href={withQuery(routes.notifications, {
                  announcementId: announcement.id,
                })}
              >
                Open its messages
              </Link>
            </Button>
            <ActionButton
              permission="notifications.manage"
              variant="danger-outline"
              blocked={
                queued === 0
                  ? "Nothing waits to go out: every message was sent or has ended."
                  : null
              }
              onClick={() => setCancelling(true)}
            >
              Cancel what has not gone out
            </ActionButton>
          </>
        }
      />
      <PageBody>
        {announcement.cancelledAt ? (
          <Alert
            title={`Cancelled ${formatDateTime(announcement.cancelledAt)}`}
          >
            The messages that were still waiting at that moment were withdrawn.
            What had gone out before stays sent.
          </Alert>
        ) : null}

        <Progress announcement={announcement} progress={progress} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader
              title="Content"
              description="What the customers got, each in their own language."
            />
            <CardBody className="grid gap-6 md:grid-cols-2">
              <Language
                tag="EN"
                name="English"
                lang="en"
                subject={announcement.subject.en}
                message={announcement.message.en}
              />
              <Language
                tag="DE"
                name="German"
                lang="de"
                subject={announcement.subject.de}
                message={announcement.message.de}
              />
            </CardBody>
          </Card>
          <Details announcement={announcement} />
        </div>
      </PageBody>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel the ${plural(queued, "message")} that ${queued === 1 ? "has" : "have"} not gone out?`}
        description="They are withdrawn, and those customers do not get the news. Messages that have gone out stay sent."
        facts={[
          {
            label: "Waiting by email",
            value: progress.email.queued.toLocaleString("en"),
          },
          {
            label: "Waiting by WhatsApp",
            value: progress.whatsapp.queued.toLocaleString("en"),
          },
          {
            label: "To be cancelled",
            value: plural(queued, "message"),
            strong: true,
          },
          { label: "Already sent", value: plural(sent, "message") },
        ]}
        tone="danger"
        confirmLabel={`Cancel ${plural(queued, "message")}`}
        cancelLabel="Let them go out"
        canConfirm={queued > 0}
        onConfirm={async () => {
          const before = progress.email.cancelled + progress.whatsapp.cancelled;
          const result = await cancel.mutateAsync();
          const after =
            result.progress.email.cancelled +
            result.progress.whatsapp.cancelled;
          notify.success(
            `${plural(Math.max(0, after - before), "message")} cancelled`,
            `“${announcement.subject.en}”`,
          );
        }}
      />
    </RequirePermission>
  );
}
