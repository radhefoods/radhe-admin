"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notify } from "@/components/ui/toast";
import { ReasonField } from "@/components/form/reason-field";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { Notification } from "@/lib/api/types";
import { NOTIFICATION_STATUS } from "@/lib/status";
import {
  CHANNEL_LABEL,
  canCancel,
  canRetry,
  refusalText,
  retryBlocked,
  typeLabel,
} from "./labels";
import {
  useCancelNotification,
  useRetryNotification,
  useWhatsappEnabled,
} from "./queries";

const CANCEL_REASON_MAX = 500;

/**
 * What can be done with one message: send a failed, skipped or cancelled
 * one again, or withdraw a queued one. Both reach a customer (or keep a
 * message from one), so both are confirmed with the recipient in view.
 */
export function NotificationActions({ message }: { message: Notification }) {
  const client = useQueryClient();
  const whatsappEnabled = useWhatsappEnabled();
  const retry = useRetryNotification(message.id);
  const cancel = useCancelNotification(message.id);
  const [dialog, setDialog] = useState<"retry" | "cancel" | null>(null);
  const [reason, setReason] = useState("");

  const facts = [
    { label: "To", value: <span className="break-all">{message.to}</span> },
    {
      label: "Message",
      value: `${typeLabel(message.type)}, ${CHANNEL_LABEL[message.channel] ?? message.channel}`,
    },
    {
      label: "Status now",
      value: NOTIFICATION_STATUS[message.status]?.label ?? message.status,
    },
  ];

  function close(open: boolean) {
    if (open) return;
    setDialog(null);
    setReason("");
  }

  const moved = (error: unknown) =>
    hasErrorCode(error, "NOTIFICATION_TRANSITION_NOT_ALLOWED");

  /** The API refused because the message moved on: read where it stands now. */
  function onRefusal(error: unknown) {
    if (moved(error)) {
      void client.invalidateQueries({ queryKey: queryKeys.notifications.all });
    }
  }

  return (
    <>
      {canCancel(message.status) ? (
        <ActionButton
          permission="notifications.manage"
          variant="danger-outline"
          onClick={() => setDialog("cancel")}
        >
          Cancel the message
        </ActionButton>
      ) : null}
      {canRetry(message.status) ? (
        <ActionButton
          permission="notifications.manage"
          variant="primary"
          blocked={retryBlocked(message, whatsappEnabled)}
          onClick={() => setDialog("retry")}
        >
          Send again
        </ActionButton>
      ) : null}

      <ConfirmDialog
        open={dialog === "retry"}
        onOpenChange={close}
        title="Send this message again?"
        description={`It goes back into the queue for a full round of attempts (up to ${message.maxAttempts}).`}
        facts={facts}
        confirmLabel="Send again"
        onConfirm={async () => {
          try {
            const result = await retry.mutateAsync();
            notify.success(
              result.status === "sent"
                ? "The message was sent"
                : "The message is queued again",
              `${typeLabel(message.type)} to ${message.to}`,
            );
          } catch (error) {
            onRefusal(error);
            throw error;
          }
        }}
        errorHelp={(error) =>
          moved(error) ? refusalText("retry", message, whatsappEnabled) : null
        }
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title="Cancel this message?"
        description="It is taken out of the queue, and the customer does not get it. A cancelled message can still be sent later."
        facts={facts.slice(0, 2)}
        tone="danger"
        confirmLabel="Cancel the message"
        cancelLabel="Keep it queued"
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(reason.trim() || undefined);
            notify.success(
              "The message is cancelled",
              `${typeLabel(message.type)} to ${message.to}`,
            );
          } catch (error) {
            onRefusal(error);
            throw error;
          }
        }}
        errorHelp={(error) =>
          moved(error) ? refusalText("cancel", message, whatsappEnabled) : null
        }
      >
        <ReasonField
          label="Reason"
          value={reason}
          onChange={setReason}
          maxLength={CANCEL_REASON_MAX}
          rows={2}
          hint="Kept on the message as the reason it was cancelled."
        />
      </ConfirmDialog>
    </>
  );
}
