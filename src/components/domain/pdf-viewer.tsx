"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import type { Id } from "@/lib/api/types";

export interface PdfFile {
  /** A local address of the file while the viewer is open. */
  url: string | null;
  open: () => void;
  close: () => void;
  loading: boolean;
  download: () => void;
}

/**
 * A PDF of the API (an invoice, a quotation). It is fetched with the
 * session (a plain link would not refresh it) and handed to the browser
 * as a local file, which is given back when the viewer closes.
 */
export function usePdfFile(
  document: { id: Id; number: string } | undefined,
  load: (id: Id) => Promise<Blob>,
): PdfFile {
  const [url, setUrl] = useState<string | null>(null);
  const fetchPdf = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("No document");
      return URL.createObjectURL(await load(document.id));
    },
    onSuccess: (created) => setUrl(created),
    onError: (error) => notify.error(error),
  });
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return {
    url,
    open: () => fetchPdf.mutate(),
    close: () => setUrl(null),
    loading: fetchPdf.isPending,
    download: () => {
      if (!url || !document) return;
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.number}.pdf`;
      anchor.click();
    },
  };
}

/** The viewer: the PDF in the page, with a way out to a tab and a download. */
export function PdfDialog({
  pdf,
  title,
  description,
}: {
  pdf: PdfFile;
  title: string;
  description?: ReactNode;
}) {
  return (
    <Dialog
      open={pdf.url !== null}
      onOpenChange={(open) => !open && pdf.close()}
    >
      <DialogContent
        size="xl"
        className="h-[calc(100dvh-2rem)] sm:h-[calc(100dvh-4rem)]"
      >
        <DialogHeader title={title} description={description} />
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-5 sm:px-6">
          {pdf.url ? (
            <iframe
              title={`PDF of ${title}`}
              src={pdf.url}
              className="min-h-0 flex-1 rounded-md border border-line bg-sunken"
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {/* Phones and some browsers show no PDF inside a page. */}
            {pdf.url ? (
              <Button asChild variant="ghost">
                <a href={pdf.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open in a new tab
                </a>
              </Button>
            ) : null}
            <Button icon={<Download />} onClick={pdf.download}>
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
