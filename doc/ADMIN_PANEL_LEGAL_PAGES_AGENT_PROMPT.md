# Prompt for the admin panel agent: six legal pages

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). **Settings → Legal texts** manages two texts today: the terms and the privacy policy. The API now manages six legal pages the same way, and each page has an address and texts for search engines. Extend the existing screens to all six. Do not build a second system next to them.

**Read first:** `doc/LEGAL_PAGES.md` in the `radhe-api` repository (the sibling folder `../radhe-api`), all of it, and section 6 of `doc/ADMIN_API_DOCUMENTATION.md` there. They hold the complete contract: endpoints, payloads, validation, workflows. Where this prompt and those documents differ, the documents are right. If you cannot read that repository, ask for the files.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse what the legal screens already have: the list, the "New version" dialog, the draft editor with its Markdown preview, the comparison of two versions, the publish confirmation.

## What changed in the API

1. **Six types** instead of two, in this order: `imprint`, `shipping`, `refund`, `terms`, `privacy`, `withdrawal`. `GET /v1/admin/legal-documents` answers them as `types`. Everything you do with a version (create, edit, publish, delete, read) works the same for all six.
2. **Only `terms` and `privacy` are accepted at checkout** (`requiredTypes`, unchanged). The other four are information pages: they are never required for ordering.
3. **One language is enough to publish.** The rule "English is required to publish" is gone: a version needs its text in English **or** German. The title still needs English.
4. **New: the page of each type.** `GET /v1/admin/legal-documents/pages` answers six page objects (also for a type without any version): `requiresConsent`, `slug { en, de }`, `defaultSlug`, `seo { title, description }`, `current` (the published version that applies, or `null`), `draft` (the newest draft, or `null`), `versions`. `PUT /v1/admin/legal-documents/pages/{type}` sets `slug` and `seo` as a whole; it is not a version. `409 LEGAL_SLUG_TAKEN` when the address belongs to another legal page (`details.type` names it).
5. **New fields on a version:** `publishedByAdmin` and `createdByAdmin` (`{ id, name }` or `null`). The list takes a `status` filter (`draft`, `published`).

## What to build

1. **The overview** (`src/features/legal/legal-view.tsx`): six sections or cards from `GET …/pages`, in the API's order, with these labels:

   | Type         | Label                | Short description                         |
   | ------------ | -------------------- | ----------------------------------------- |
   | `imprint`    | Imprint              | Who runs the shop (Impressum).            |
   | `shipping`   | Shipping information | How and where the shop delivers.          |
   | `refund`     | Refund policy        | How money is given back.                  |
   | `terms`      | Terms and conditions | What customers agree to at checkout.      |
   | `privacy`    | Privacy policy       | How the data of customers is handled.     |
   | `withdrawal` | Right of withdrawal  | How a customer withdraws from a contract. |

   Each shows: the published version (number, date, who published it) or "Not published"; whether a draft exists; the address; the button "New version"; the version history as it is shown today. Mark `terms` and `privacy` with a badge "Accepted at checkout". The warning "customers cannot check out" stays for those two only (`requiredTypes`); an unpublished information page gets a neutral hint "Not shown in the shop yet", never a warning about checkout.

2. **Types and helpers** (`src/lib/api/types/legal.ts`, `src/features/legal/legal.ts`): `LegalType` with six values; `LEGAL_TYPES` and `LEGAL_TYPE` (label, short name, description, default title) for all six; `groupByType` must not hard-code two keys. Types for the page object and the two new endpoints in `src/lib/api/endpoints/shop.ts` (`legalApi.pages()`, `legalApi.setPage(type, input)`).

3. **The editor** (`legal-document-view.tsx`, `new-version-dialog.tsx`): works for every type. Remove the wording and the check that English is required; publishing is possible when either language has text. Keep both language tabs and the preview. Add a hint when only one language is filled: "Readers of the other language will see this text."

4. **Page settings**, a small form per type (a dialog or a section on the page of the type): address in English and German, title and description for search engines in English and German. Empty fields mean "default": show `defaultSlug` and the title of the current version as placeholders. Save with `PUT …/pages/{type}`, sending **everything the page keeps** (the call replaces the whole page). Validate the address before sending: lower-case letters, digits and single hyphens, at most 120 characters; the search-engine texts at most 300 characters each. Show `LEGAL_SLUG_TAKEN` at the address field: "This address belongs to the page <label of details.type>." Say under the form: "Changing the address changes the link of the page at once. Links to the old address stop working."

5. **History**: add "published by" and "created by" to the rows.

6. **Permissions**: reading with `legal.read`, every write (versions and page settings) with `legal.manage`, as today.

7. **Mocks and tests** (`mocks/`, `legal-flows.test.tsx`): the mock API with six types, the pages endpoints and the relaxed publish rule; tests for a new type from first draft to published, for the page settings (save, reset, taken address), and that only `terms` and `privacy` raise the checkout warning.

## How to work

Write a short plan and wait for my go. Then build it, run the panel's lint, type check and tests, and report what you built and what you left out.
