"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { useRetryNotification } from "@/features/notifications/queries";
import { typeLabel } from "@/features/notifications/labels";
import { queryKeys } from "@/lib/api/query-keys";
import type { Notification } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { routes, withQuery } from "@/lib/routes";

/** A failed email can be sent again, as any other message of the log (13). */
function Retry({ message }: { message: Notification }) {
  const client = useQueryClient();
  const retry = useRetryNotification(message.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        permission="notifications.manage"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Retry
      </ActionButton>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Send this email again?"
        description={`${typeLabel(message.type)} to ${message.to}. The provider gets it once more, with the same content.`}
        confirmLabel="Send again"
        onConfirm={async () => {
          await retry.mutateAsync();
          await client.invalidateQueries({
            queryKey: queryKeys.quotations.all,
          });
          notify.success("The email is on its way again");
        }}
      />
    </>
  );
}

/** The emails about a quotation (24): newest first, with a retry for a failed one. */
export function EmailsCard({
  quotationId,
  messages,
}: {
  quotationId: string;
  messages: Notification[];
}) {
  const can = useCan();
  return (
    <Card>
      <CardHeader
        title="Emails"
        description="The confirmation to the requester, the heads-up to the shop, and each quotation sent."
        actions={
          can("notifications.read") && messages.length > 0 ? (
            <Link
              href={withQuery(routes.notifications, { quotationId })}
              className="text-13 font-medium text-accent-text hover:underline"
            >
              In the log
            </Link>
          ) : null
        }
      />
      {messages.length === 0 ? (
        <CardBody>
          <p className="text-13 text-ink-muted">
            No email about this quotation yet.
          </p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line" aria-label="Emails">
          {messages.map((message) => (
            <li
              key={message.id}
              className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-5"
            >
              <span className="flex min-w-0 flex-1 basis-56 flex-col">
                <span className="font-semibold text-ink">
                  {can("notifications.read") ? (
                    <Link
                      href={routes.notification(message.id)}
                      className="hover:underline"
                    >
                      {typeLabel(message.type)}
                    </Link>
                  ) : (
                    typeLabel(message.type)
                  )}
                </span>
                <span className="truncate text-13 text-ink-muted">
                  To {message.to}
                </span>
                {message.subject ? (
                  <span className="truncate text-13 text-ink-subtle">
                    {message.subject}
                  </span>
                ) : null}
                {message.status === "failed" && message.lastError ? (
                  <span className="mt-1 text-13 text-danger-fg">
                    {message.lastError}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge kind="notification" value={message.status} />
                <span className="text-13 text-ink-subtle">
                  {message.sentAt ? (
                    <DateTime value={message.sentAt} short />
                  ) : (
                    <DateTime value={message.createdAt} short />
                  )}
                </span>
                {message.status === "failed" ? (
                  <Retry message={message} />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
