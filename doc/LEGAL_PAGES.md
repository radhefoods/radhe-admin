# Legal pages: imprint, shipping, refunds, terms, privacy, withdrawal

The six legal pages of the shop are written, versioned and published in the admin panel, under **Settings → Legal texts**. This document is the contract for whoever builds the screens in the panel and the pages on the website. Built on 2026-11-11 by extending the legal texts there were (`terms`, `privacy`): nothing they held was changed.

The API contains no legal text. Every word is typed by the admin; a page without a published version does not exist for customers.

## The six pages

| `type`       | Page                                        | Accepted at checkout | Default address (en / de)           |
| ------------ | ------------------------------------------- | -------------------- | ----------------------------------- |
| `imprint`    | Imprint (Impressum)                         | no                   | `imprint` / `impressum`             |
| `shipping`   | Shipping information (Versandinformationen) | no                   | `shipping` / `versand`              |
| `refund`     | Refund policy (Rückerstattungsrichtlinie)   | no                   | `refund-policy` / `rueckerstattung` |
| `terms`      | Terms and conditions (AGB)                  | **yes**              | `terms` / `agb`                     |
| `privacy`    | Privacy policy (Datenschutzerklärung)       | **yes**              | `privacy` / `datenschutz`           |
| `withdrawal` | Right of withdrawal (Widerrufsbelehrung)    | no                   | `withdrawal` / `widerruf`           |

The API answers the types in this order (`types`). The default addresses of `terms`, `privacy`, `imprint` and `withdrawal` are the ones the website already uses.

## How it works

**Versions.** Each type has its own versions, numbered 1, 2, 3 … A version is a `draft` until it is published. A `published` version can never be changed or deleted: a correction is a new version. The version that applies is the published one with the highest number. Earlier published versions stay readable for good, with the date each was published: the version that applied on a given day is the latest one published by then.

**Two languages.** Every version has a title (`en` required, `de` optional) and a text (`en` and `de`, each optional). A version can be published with the text in **one** language; the shop then shows that text to readers of the other language and says which language it is (`contentLanguage`). Until 2026-11-11 the English text was required.

**The text.** Plain text or Markdown, up to 300,000 characters per language. The API stores and answers it exactly as typed and never interprets it. Whoever shows it renders Markdown and **must not render HTML it contains**.

**The page.** Each type has one page in the shop: an address per language (`slug`) and a title and description for search engines (`seo`). These belong to the page, not to a version. Changing them applies at once, to whatever version is shown, and does **not** create a version. A new version keeps them.

**Checkout.** Only `terms` and `privacy` are accepted at checkout. Their versions are sent with the order and recorded on it, and no order can be placed until both are published. The other four pages inform: nobody is asked to accept them, publishing or changing them never interrupts a checkout, and a missing one never blocks an order.

## Admin API

All calls use the admin session. Reading needs `legal.read`, writing `legal.manage` (both exist already).

| Call                                          | Permission     | What it does                                |
| --------------------------------------------- | -------------- | ------------------------------------------- |
| `GET /v1/admin/legal-documents/pages`         | `legal.read`   | The overview: the six pages                 |
| `PUT /v1/admin/legal-documents/pages/{type}`  | `legal.manage` | Address and search-engine texts of one page |
| `GET /v1/admin/legal-documents`               | `legal.read`   | Every version without its text: the history |
| `GET /v1/admin/legal-documents/{id}`          | `legal.read`   | One version with its text                   |
| `POST /v1/admin/legal-documents`              | `legal.manage` | A new version, as a draft                   |
| `PATCH /v1/admin/legal-documents/{id}`        | `legal.manage` | Change a draft                              |
| `POST /v1/admin/legal-documents/{id}/publish` | `legal.manage` | Publish a draft                             |
| `DELETE /v1/admin/legal-documents/{id}`       | `legal.manage` | Delete a draft                              |

The first two and the fields marked "new" below were added; the other calls work as before.

### The document object (one version)

```json
{
  "id": "66f1a2b3c4d5e6f7a8b9c0b4",
  "type": "imprint",
  "version": 2,
  "status": "published",
  "title": { "en": "Imprint", "de": "Impressum" },
  "content": { "en": "…markdown…", "de": "…markdown…" },
  "note": "New address",
  "publishedAt": "2026-11-11T10:05:00.000Z",
  "publishedByAdmin": { "id": "66f1…", "name": "Asha Patel" },
  "createdByAdmin": { "id": "66f1…", "name": "Asha Patel" },
  "createdAt": "2026-11-11T10:00:00.000Z",
  "updatedAt": "2026-11-11T10:05:00.000Z"
}
```

- `content` is only in the answers for one version; the lists leave it out.
- `note` is internal: what changed against the version before. `null` when there is none.
- `publishedAt` and `publishedByAdmin` are `null` on a draft. New: `publishedByAdmin`, `createdByAdmin` (`{ id, name }`, or `null` when the admin no longer exists).
- In lists every document also has `isCurrent`: true for the published version that applies now.

### The page object (one per type)

```json
{
  "type": "shipping",
  "requiresConsent": false,
  "slug": { "en": "shipping", "de": "versandinformationen" },
  "defaultSlug": { "en": "shipping", "de": "versand" },
  "seo": {
    "title": { "en": "Shipping | Radhe Foods", "de": "Versand | Radhe Foods" },
    "description": { "de": "So liefern wir." }
  },
  "current": {
    "id": "…",
    "type": "shipping",
    "version": 3,
    "status": "published",
    "…": ""
  },
  "draft": null,
  "versions": 4,
  "updatedAt": "2026-11-11T10:00:00.000Z"
}
```

| Field             | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `requiresConsent` | True for `terms` and `privacy`.                                                          |
| `slug`            | The address that applies now, in both languages: what the admin set, else the default.   |
| `defaultSlug`     | The address the page has when the admin sets none.                                       |
| `seo.title`       | `{ en?, de? }` or `null`. Without it the shop uses the title of the text.                |
| `seo.description` | `{ en?, de? }` or `null`.                                                                |
| `current`         | The published version that applies now, without `content`. `null`: nothing is published. |
| `draft`           | The newest draft, without `content`. `null`: there is no draft.                          |
| `versions`        | How many versions the type has, drafts included.                                         |
| `updatedAt`       | When the page (address, search-engine texts) was last changed. `null`: never.            |

### `GET /v1/admin/legal-documents/pages`

Answers `{ "items": [ page × 6 ], "requiredTypes": ["terms", "privacy"] }`, always six entries in the order of the table at the top, also for a type nobody has written yet (`current: null`, `draft: null`, `versions: 0`).

### `PUT /v1/admin/legal-documents/pages/{type}`

Sets the page **as a whole**. What is left out or `null` goes back to the default, so send everything the page should keep.

```json
{
  "slug": { "en": "shipping", "de": "versandinformationen" },
  "seo": {
    "title": { "en": "Shipping | Radhe Foods", "de": "Versand | Radhe Foods" },
    "description": { "en": "How we deliver.", "de": "So liefern wir." }
  }
}
```

| Field                       | Validation                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug.en`, `slug.de`        | Optional. Lower-case letters, digits and single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), at most 120 characters. A language left out has the default. |
| `seo.title.en`, `.de`       | Optional, at most 300 characters each.                                                                                                             |
| `seo.description.en`, `.de` | Optional, at most 300 characters each.                                                                                                             |

Answers `{ "page": { … } }`.

Errors: `400 VALIDATION_FAILED` (a field breaks a rule, or the body has an unknown field), `400 BAD_REQUEST` (`type` is not one of the six), `409 LEGAL_SLUG_TAKEN` when an address is the type or the address of **another** legal page, in either language; `details: { "slug": "agb", "type": "terms" }` names the page that has it.

An address change takes effect at once: the old address stops working, the type (`/v1/store/legal/shipping`) always works.

### `GET /v1/admin/legal-documents`

Query: `type` (one of the six, optional), `status` (`draft` or `published`, optional).

```json
{
  "items": [
    {
      "id": "…",
      "type": "imprint",
      "version": 2,
      "status": "published",
      "isCurrent": true,
      "…": ""
    },
    {
      "id": "…",
      "type": "imprint",
      "version": 1,
      "status": "published",
      "isCurrent": false,
      "…": ""
    }
  ],
  "types": ["imprint", "shipping", "refund", "terms", "privacy", "withdrawal"],
  "requiredTypes": ["terms", "privacy"]
}
```

Sorted by type, then newest version first. Never contains `content`. New: `types`, the `status` filter, and the four new values of `type`.

### `POST /v1/admin/legal-documents`

```json
{
  "type": "imprint",
  "title": { "en": "Imprint", "de": "Impressum" },
  "content": { "en": "…", "de": "…" },
  "note": "What changed"
}
```

| Field     | Required | Validation                                                                    |
| --------- | -------- | ----------------------------------------------------------------------------- |
| `type`    | yes      | One of the six types.                                                         |
| `title`   | yes      | `en` 1 to 160 characters; `de` optional, at most 160.                         |
| `content` | yes      | An object. `en`, `de` optional, at most 300,000 characters each. May be `{}`. |
| `note`    | no       | At most 1,000 characters.                                                     |

Answers `201` with `{ "document": { … } }`, `status: "draft"`, and the next version number of its type. Texts are trimmed; an empty string counts as not sent.

### `GET /v1/admin/legal-documents/{id}`

`{ "document": { …with content… } }` for any version: a draft, the current one, an earlier one. `404 LEGAL_DOCUMENT_NOT_FOUND`.

### `PATCH /v1/admin/legal-documents/{id}`

Drafts only. `{ "title"?, "content"?, "note"?: string | null }`. `title` and `content` each replace the whole object (send both languages); `note: null` removes the note. `409 LEGAL_DOCUMENT_PUBLISHED` for a published version.

### `POST /v1/admin/legal-documents/{id}/publish`

No body. Answers the document with `status: "published"`, `publishedAt` and `publishedByAdmin`. Publishing a published version again changes nothing and answers it as it is. `400 VALIDATION_FAILED` when the version has no text in either language.

### `DELETE /v1/admin/legal-documents/{id}`

Drafts only: `204`. `409 LEGAL_DOCUMENT_PUBLISHED` for a published version. A deleted draft's number is not used again.

## Workflows

1. **The overview.** `GET …/pages`. Six cards. Each shows the published version (number, date, by whom), whether a draft exists, and the address.
2. **Write the first version.** `POST` with the type → a draft. Edit with `PATCH`.
3. **Preview.** `GET …/{id}` and render `content` as Markdown in the language chosen, without rendering HTML. The panel's editor already has this preview.
4. **Publish.** `POST …/{id}/publish`, after a confirmation that says a published version cannot be changed. From this moment the shop shows it.
5. **Change a published text.** Read the current version with `GET …/{id}`, create a new draft with its title and text (`POST`), edit, publish. The old version stays in the history.
6. **Bring an earlier version back.** The same, starting from the earlier version: it becomes a new version with a new number. Nothing is ever "unpublished".
7. **History.** `GET /v1/admin/legal-documents?type=imprint`: every version with status, dates and who published it; `isCurrent` marks the one that applies. Open any of them with `GET …/{id}`, or compare two.
8. **Address and search engines.** `PUT …/pages/{type}` with the whole page. No version is created.

## Public API (the website)

No authentication. `locale` (`en` or `de`) as a query parameter, else `Accept-Language`, else `en`.

### `GET /v1/store/legal`

Every page that has a published version, in the version that applies, without the texts.

```json
{
  "items": [
    {
      "type": "imprint",
      "version": 2,
      "title": "Impressum",
      "publishedAt": "2026-11-11T10:05:00.000Z",
      "slug": "impressum",
      "slugs": { "en": "imprint", "de": "impressum" },
      "requiresConsent": false
    }
  ]
}
```

New: the four new types, `slug`, `slugs`, `requiresConsent`. A type that is not published is not in the list.

### `GET /v1/store/legal/{key}`

`key` is the type (`terms`) or the address of the page in either language (`agb`).

```json
{
  "document": {
    "type": "imprint",
    "version": 2,
    "title": "Impressum",
    "publishedAt": "2026-11-11T10:05:00.000Z",
    "slug": "impressum",
    "slugs": { "en": "imprint", "de": "impressum" },
    "requiresConsent": false,
    "content": "…markdown or plain text…",
    "contentLanguage": "de",
    "seo": { "title": "Impressum", "description": null }
  }
}
```

- `content` is in the language asked for when there is one, else in the other; `contentLanguage` says which.
- `seo.title` is never empty (the admin's, else the title of the text); `seo.description` may be `null`.
- `404 LEGAL_DOCUMENT_NOT_FOUND` when the page has no published version or `key` names no page. (An unknown type answered `400` before.)

Only the current version is public. Drafts and earlier versions are for admins.

## Checkout

Nothing changed for the customer. `POST /v1/store/checkout` and the guest checkout take `consent.versions` with `terms` and `privacy` only; any other key is refused (`400 VALIDATION_FAILED`). `409 LEGAL_DOCUMENTS_MISSING` names `terms` or `privacy` when one is not published; `409 LEGAL_VERSION_CHANGED` comes only when one of those two was republished. The order keeps `consent.documents` with the type, version and id of the two texts accepted.

## Errors

| Status | Code                       | When                                                                |
| ------ | -------------------------- | ------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`        | A field breaks a rule; publishing a version without any text.       |
| 400    | `BAD_REQUEST`              | `pages/{type}` with a type that does not exist.                     |
| 401    | `UNAUTHENTICATED`          | No admin session.                                                   |
| 403    | `FORBIDDEN`                | The permission is missing.                                          |
| 404    | `LEGAL_DOCUMENT_NOT_FOUND` | No such version; in the shop, no published version or no such page. |
| 409    | `LEGAL_DOCUMENT_PUBLISHED` | Changing or deleting a published version.                           |
| 409    | `LEGAL_SLUG_TAKEN`         | The address belongs to another legal page.                          |
| 409    | `LEGAL_DOCUMENTS_MISSING`  | Checkout while `terms` or `privacy` is not published.               |
| 409    | `LEGAL_VERSION_CHANGED`    | Checkout with an old version of `terms` or `privacy`.               |

## Data

- `legalDocuments`: unchanged. The versions of `terms` and `privacy` that exist are the same records, with the same numbers; the four new types start at version 1.
- `legalPages` (new): at most one small record per type, created when the admin first changes an address or a search-engine text. No migration, no new index.
- Orders: unchanged.

## Not part of this

- The cookie page of the website is not one of the six and stays where it is.
- A version cannot be scheduled for a future date, and cannot be withdrawn once published; publish a new version instead.
- The order does not record which version of the four informing pages applied when it was placed. It follows from the history: the latest version published before the order.
