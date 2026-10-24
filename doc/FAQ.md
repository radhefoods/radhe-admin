# FAQ (questions and answers)

For the Admin Panel agent and the Customer Web agent. The questions and answers the admin keeps, as the Radhe Foods API serves them as of 2026-10-24: in English and German, under optional headings (groups), in the admin's order, published or not. Section 22 of `doc/ADMIN_API_DOCUMENTATION.md` and section 18 of `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` are the short forms.

**Strict rule for both frontends:** do not change the visual design. Build the FAQ pages inside the panel's existing layouts and components, and the FAQ page of the shop with the shop's existing typography and accordion or list components.

## 1. The model

| Collection | Record | Fields |
| --- | --- | --- |
| `faqGroups` | A heading: "Orders", "Delivery", "Returns" | `name { en, de? }`, `sortOrder` (0 first), `isVisible` (default true; a hidden group hides its questions in the shop) |
| `faqs` | One question with its answer | `question { en, de? }` (≤300 chars each), `answer { en, de? }` (≤20 000 chars each, plain text or Markdown, as the legal texts), `groupId` (a group, or `null`), `sortOrder` (position within its group, 0 first), `isPublished` (default false), `publishedAt` (when it was first published) |

Rules:

- English is required for the question and the answer; German falls back to English in the shop until it is filled in.
- A new group goes last among the groups; a new question goes last in its group; a question moved to another group goes last there.
- The order of the groups is set with one complete list. The order of the questions of a group is set with a list that may be partial: the named questions come first, the rest keeps its order (the same rule as the product order of a category).
- A group with questions cannot be deleted; move or delete the questions first.
- The shop sees only published questions of visible groups. Questions without a group come after the groups.

## 2. Admin API

**Permissions:** `content.read` to see, `content.manage` to change (shared with the blog). All routes need a signed-in admin.

### The group object

```json
{
  "id": "66f3…",
  "name": { "en": "Orders", "de": "Bestellungen" },
  "isVisible": true,
  "sortOrder": 0,
  "faqCount": 4,
  "publishedCount": 3,
  "createdAt": "2026-10-24T09:00:00.000Z",
  "updatedAt": "2026-10-24T09:00:00.000Z"
}
```

`faqCount` and `publishedCount` come with the list only.

### The FAQ object

```json
{
  "id": "66f4…",
  "question": { "en": "Can I cancel my order?", "de": "Kann ich meine Bestellung stornieren?" },
  "answer": { "en": "Yes, until we start preparing it. Open the order in your account and choose *Cancel order*.", "de": "Ja, bis wir mit der Vorbereitung beginnen. …" },
  "groupId": "66f3…",
  "group": { "id": "66f3…", "name": { "en": "Orders", "de": "Bestellungen" } },
  "sortOrder": 0,
  "isPublished": true,
  "publishedAt": "2026-10-24T09:05:00.000Z",
  "createdAt": "2026-10-24T09:00:00.000Z",
  "updatedAt": "2026-10-24T09:05:00.000Z"
}
```

### Groups

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/admin/faq-groups` | | `{ items: [group…], ungrouped: { total, published } }` in display order |
| `POST /v1/admin/faq-groups` | `{ name: { en, de? }, isVisible? }` | `201 { group }`, last in the order |
| `GET /v1/admin/faq-groups/{id}` | | `{ group }` |
| `PATCH /v1/admin/faq-groups/{id}` | `{ name?, isVisible? }` | `{ group }` |
| `PUT /v1/admin/faq-groups/order` | `{ orderedIds: [every group exactly once] }` | `{ items }` in the new order |
| `DELETE /v1/admin/faq-groups/{id}` | | `204`; `409 FAQ_GROUP_HAS_FAQS` (`details.faqs`) while it has questions |

Errors: `404 FAQ_GROUP_NOT_FOUND`, `400 FAQ_GROUP_ORDER_INVALID` (`details.expected`: the ids the list must contain), `400 VALIDATION_FAILED`.

### Questions

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/admin/faqs` | query `groupId`, `ungrouped=true`, `isPublished` | `{ items: [faq…] }`: grouped questions first, groups in display order, then the ones without a group; within a group by position |
| `POST /v1/admin/faqs` | `{ question: { en, de? }, answer: { en, de? }, groupId?: id \| null, isPublished? }` | `201 { faq }`, last in its group |
| `GET /v1/admin/faqs/{id}` | | `{ faq }` |
| `PATCH /v1/admin/faqs/{id}` | any of the fields of the creation; `groupId: null` takes the question out of its group | `{ faq }`; a moved question goes last in the new group |
| `PUT /v1/admin/faqs/order` | `{ groupId?: id \| null, orderedIds: [ids of that group, partial allowed] }` | `{ items }`: the complete list of the group in its new order |
| `DELETE /v1/admin/faqs/{id}` | | `204` |

Publishing is the `isPublished` switch of `PATCH`. The first time it is switched on, `publishedAt` is set.

Errors: `404 FAQ_NOT_FOUND`, `404 FAQ_GROUP_NOT_FOUND` (unknown `groupId`), `400 FAQ_ORDER_INVALID` (`details.unknown`: ids that are not questions of that group, `details.expected`: the ids that are), `400 VALIDATION_FAILED` (English missing, text too long, more than 500 ids).

Example of a partial reorder: the group has A 0, B 1, C 2, D 3. `{ "groupId": "…", "orderedIds": ["C"] }` gives C 0, A 1, B 2, D 3.

## 3. Public API

### `GET /v1/store/faqs`

**Authentication:** none. `?locale=en|de` (else `Accept-Language`). `Cache-Control: public, max-age=300`.

```json
{
  "groups": [
    {
      "id": "66f3…",
      "name": "Bestellungen",
      "items": [
        { "id": "66f4…", "question": "Kann ich meine Bestellung stornieren?", "answer": "Ja, bis wir mit der Vorbereitung beginnen. …" },
        { "id": "66f5…", "question": "Kann ich meine Bestellung verfolgen?", "answer": "Ja: …" }
      ]
    },
    {
      "id": "66f6…",
      "name": "Lieferung",
      "items": [ { "id": "66f7…", "question": "Wie lange dauert die Lieferung?", "answer": "2 bis 4 Werktage." } ]
    },
    {
      "id": null,
      "name": null,
      "items": [ { "id": "66f8…", "question": "Habt ihr ein Geschäft in Frankfurt?", "answer": "Noch nicht." } ]
    }
  ]
}
```

- Only visible groups with at least one published question, in the admin's order; within a group the published questions in the admin's order.
- Published questions without a group come as a last entry whose `id` and `name` are `null`. There is at most one such entry; leave it out when there is none.
- `answer` is plain text or Markdown: render it with the renderer the shop uses for the legal texts.
- `groups: []` means nothing is published: the FAQ page shows nothing, or is left out of the navigation.

## 4. Panel workflow

- A page **FAQ** under the content or settings area (where the legal texts live), permission `content.read`; every write disabled without `content.manage`.
- The page lists the groups as sections in order, each with its questions in order, then "Without group". Each question shows its English question, a published badge, and the German question under it when present.
- Reordering with the drag handle pattern already used for categories and banners: the groups among themselves (send the complete list), the questions within a group (send the group's complete list to `PUT /v1/admin/faqs/order`).
- A form for a question: question and answer in two language tabs (English required), group select (with "No group"), published switch. Save with `POST` or `PATCH`; the answer carries the saved record.
- Groups: add, rename, hide or show, delete (disabled while `faqCount` > 0, with a hint).
- On `FAQ_ORDER_INVALID`, reload the list: the group changed in the meantime.

## 5. Shop workflow

- A page `/faq` (and `/de/faq` or however the shop routes languages) that reads `GET /v1/store/faqs?locale=…` and renders each group as a heading with its questions as an accordion or a list, in the order given. Ungrouped questions without a heading, or under a generic one.
- Anchors: `#faq-<id>` on every question, so a link can open one.
- SEO: the page emits `FAQPage` structured data (`mainEntity: Question[]` with `acceptedAnswer`) built from the same answer, the answers as plain text.
- Cache the answer as the shop caches the settings (the API allows five minutes); a change in the panel shows within that time.
- Render `answer` as Markdown with the existing renderer; no raw HTML.

## 6. Checklist

1. Admin: list with groups and questions in order; forms with English required; drag and drop for groups and for questions within a group; published switch; group delete disabled while in use; permissions `content.read` / `content.manage`.
2. Shop: `/faq` page from `GET /v1/store/faqs`, localized, Markdown answers, `FAQPage` structured data, nothing rendered when `groups` is empty.
3. Both: no change to theme, colours, fonts or typography.
