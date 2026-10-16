"use client";

import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import { Card, CardBody, CardHeader, FactRows } from "@/components/ui/surface";
import { WhatsappState } from "@/features/notifications/whatsapp-state";
import type {
  AnnouncementInput,
  AnnouncementPreview,
  Locale,
} from "@/lib/api/types";
import { LOCALES } from "@/lib/api/types";
import { LOCALE_LABEL, plural } from "@/lib/format/names";
import { withoutLinkTargets } from "./schema";

/**
 * The rendered email of one language. The frame is sandboxed without any
 * permission (`sandbox=""`): nothing in it can run a script, submit a form
 * or reach the panel around it.
 */
function EmailFrame({ html, language }: { html: string; language: string }) {
  return (
    <iframe
      title={`The email in ${language}`}
      srcDoc={withoutLinkTargets(html)}
      sandbox=""
      className="h-[32rem] w-full rounded-md border border-line bg-paper"
    />
  );
}

/**
 * What `POST /announcements/preview` answered: who would get the news on
 * which channel, where its button leads, and how it reads in each
 * language. Nothing has been sent at this point.
 */
export function AnnouncementPreviewPanel({
  input,
  preview,
  about,
}: {
  /** What was previewed, and what will be sent. */
  input: AnnouncementInput;
  preview: AnnouncementPreview;
  /** The chosen product by name, for the record of the announcement. */
  about?: { product?: string };
}) {
  const languages = LOCALES.filter((locale) => preview.email[locale]);
  const [language, setLanguage] = useState<Locale>(languages[0] ?? "en");
  const byWhatsapp = preview.channels.includes("whatsapp");
  const byEmail = preview.channels.includes("email");
  const templates = byWhatsapp
    ? LOCALES.flatMap((locale) => {
        const template = preview.whatsapp?.[locale];
        return template ? [{ locale, template }] : [];
      })
    : [];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader
            title="Who gets it"
            description="Only customers who opted in to news, each in their own language."
          />
          <CardBody className="flex flex-col gap-3">
            <FactRows
              rows={[
                {
                  label: "By email",
                  value: byEmail
                    ? plural(preview.recipients.email, "customer")
                    : "Not chosen",
                  strong: byEmail,
                },
                {
                  label: "By WhatsApp",
                  value: byWhatsapp
                    ? plural(preview.recipients.whatsapp, "customer")
                    : "Not chosen",
                  strong: byWhatsapp,
                },
              ]}
            />
            {byWhatsapp ? (
              <WhatsappState enabled={preview.whatsappEnabled}>
                {preview.whatsappEnabled
                  ? "WhatsApp goes to the customers who opted in to news and to WhatsApp."
                  : "WhatsApp is not configured in the API: these messages would be stored as skipped and could be sent again once it is."}
              </WhatsappState>
            ) : null}
          </CardBody>
        </Card>

        {about?.product ? (
          <Card>
            <CardHeader
              title="What it is about"
              description="Kept with the announcement; customers do not see it."
            />
            <CardBody>
              <FactRows
                rows={[
                  ...(about.product
                    ? [{ label: "Product", value: about.product }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="The button"
            description="Where the customer lands."
          />
          <CardBody className="flex flex-col gap-2 text-sm">
            <a
              href={preview.link}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium break-all text-accent-text underline-offset-2 hover:underline"
            >
              {preview.link}
            </a>
            {input.link ? null : (
              <p className="text-13 text-ink-muted">
                {input.productId
                  ? "No link was given: the button leads to the product's page."
                  : "No link was given: the button leads to the shop."}
              </p>
            )}
          </CardBody>
        </Card>

        {templates.length > 0 ? (
          <Card>
            <CardHeader
              title="WhatsApp template"
              description="The approved template and the values put into it. The first value is the customer's first name."
            />
            <div className="divide-y divide-line">
              {templates.map(({ locale, template }) => (
                <div
                  key={locale}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:px-5"
                >
                  <p className="text-13 font-semibold text-ink">
                    {LOCALE_LABEL[locale]}
                    <span className="ml-2 font-mono font-normal text-ink-muted">
                      {template.name} ({template.languageCode})
                    </span>
                  </p>
                  <ol className="flex flex-col gap-1.5">
                    {template.bodyParameters.map((parameter, index) => (
                      <li key={index} className="flex gap-2.5 text-sm">
                        <span className="w-10 shrink-0 font-mono text-13 text-ink-subtle tabular">
                          {`{{${index + 1}}}`}
                        </span>
                        <span className="min-w-0 break-words whitespace-pre-line text-ink">
                          {parameter}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <Card className="min-w-0">
        <CardHeader
          title="The email"
          description="As it is rendered for the customer. Its button and links are switched off in this preview."
        />
        <CardBody>
          {languages.length > 0 ? (
            <Tabs
              value={language}
              onValueChange={(value) => setLanguage(value as Locale)}
              className="flex flex-col gap-3"
            >
              <TabsList aria-label="Language of the preview">
                {languages.map((locale) => (
                  <TabsTrigger key={locale} value={locale}>
                    {LOCALE_LABEL[locale]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {languages.map((locale) => {
                const email = preview.email[locale];
                if (!email) return null;
                return (
                  <TabsContent
                    key={locale}
                    value={locale}
                    className="flex flex-col gap-3"
                  >
                    <p className="text-sm">
                      <span className="text-ink-muted">Subject: </span>
                      <span className="font-medium text-ink" lang={locale}>
                        {email.subject}
                      </span>
                    </p>
                    <EmailFrame
                      html={email.html}
                      language={LOCALE_LABEL[locale]}
                    />
                  </TabsContent>
                );
              })}
            </Tabs>
          ) : (
            <p className="text-13 text-ink-muted">
              The API sent no rendered email.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
