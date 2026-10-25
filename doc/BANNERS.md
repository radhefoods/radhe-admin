# Homepage banners (hero carousel)

For the Admin Panel agent and the Customer Web agent. The promotional slides of the homepage as the Radhe Foods API keeps them as of 2026-10-19: one finished picture per slide, an optional link, a switch, an order and an optional period. Section 20 of `doc/ADMIN_API_DOCUMENTATION.md` and section 17 of `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` are the short forms.

**Strict rule for both frontends:** do not change the visual design. Build the banner page inside the panel's existing layouts and components, and the carousel inside the shop's existing homepage.

## 1. The model

A banner is a picture the admin designed elsewhere, with every text and offer already on it. The API adds nothing to the picture: no titles, subtitles or buttons. Per banner:

| Field | Meaning |
| --- | --- |
| `image` | The picture, converted to WebP in three widths (section 2) |
| `name` | A label for the admin's list only, optional |
| `linkUrl` | Where a click leads: a path of the shop (`/products/basmati-rice-1kg`) or an `https://` address, optional |
| `isActive` | The switch |
| `sortOrder` | The place in the carousel, 0 first |
| `startsAt`, `endsAt` | Optional period (ISO 8601 instants, compared in UTC); outside it the banner is not shown |
| `status` | Computed for the admin: `live`, `inactive`, `scheduled` (start in the future), `expired` (end in the past) |
| `image.alt` | Description for screen readers, `en` and `de`, optional |

The shop shows the banners that are `live`, in `sortOrder`. At most 20 banners can be kept.

## 2. The picture: one upload, three widths

The admin uploads **one** picture per banner (JPEG, PNG or WebP, at most 10 MB). The API converts it to WebP and stores it in three widths, never enlarged: `small` 768 px, `medium` 1536 px, `large` 2560 px (or the upload's own width when smaller). The ratio of the upload is kept; nothing is cropped. The picture must be **wider than tall** and **at least 1200 × 300 px**; the API refuses anything else with `400 IMAGE_DIMENSIONS_INVALID`.

**Recommended upload: 2400 × 1000 px (ratio 12:5)**, PNG or high-quality JPEG. This ratio reads well from phone to desktop when the shop keeps it (section 4). Because the same picture is shown on every screen, keep text and the main motif inside the middle 70 % of the width and 15 % away from the top and bottom edges, in a font that is still legible at a third of the size.

A separate picture for phones is not supported. If the owner later wants tall, phone-shaped banners, that needs a second upload per banner; say so instead of cropping.

## 3. Admin API

All under `/v1/admin/banners`, admin session required. Reading needs `catalog.read`, writing `catalog.manage`.

### The banner object

```json
{
  "id": "66f3…",
  "name": "Diwali offer",
  "image": {
    "id": "66f4…",
    "alt": { "en": "Diwali offer", "de": "Diwali-Angebot" },
    "isPrimary": false,
    "url": "https://cdn.radhefoods.de/catalog/banners/66f3…/a1b2…/large.webp",
    "sizes": {
      "small": { "url": "…/small.webp", "width": 768, "height": 320 },
      "medium": { "url": "…/medium.webp", "width": 1536, "height": 640 },
      "large": { "url": "…/large.webp", "width": 2400, "height": 1000 }
    },
    "bytes": 412000,
    "uploadedAt": "2026-10-19T09:00:00.000Z"
  },
  "linkUrl": "/products/basmati-rice-1kg",
  "isActive": true,
  "status": "live",
  "sortOrder": 0,
  "startsAt": null,
  "endsAt": "2026-11-05T23:00:00.000Z",
  "createdAt": "2026-10-19T09:00:00.000Z",
  "updatedAt": "2026-10-19T09:05:00.000Z"
}
```

### `GET /v1/admin/banners`

All banners in display order: `{ "items": [ …banner objects… ] }`.

### `POST /v1/admin/banners`

Create a banner from its picture. `multipart/form-data` with one field `file`. The banner starts **switched off** and last in the order; set its link, period and switch with `PATCH`.

**Success:** `201 { "banner": { … } }`. **Errors:** `400 IMAGE_REQUIRED`, `400 IMAGE_FORMAT_NOT_ALLOWED`, `400 IMAGE_DIMENSIONS_INVALID` (`details: { width, height, minimum: 1200, minimumHeight: 300 }` or `{ width, height, landscape: true }`), `400 IMAGE_INVALID`, `400 BANNER_LIMIT_REACHED` (`details: { maximum: 20 }`), `413 FILE_TOO_LARGE`, `503 STORAGE_UNAVAILABLE`.

### `GET /v1/admin/banners/{id}`

`{ "banner": { … } }`. **Errors:** `404 BANNER_NOT_FOUND`.

### `PATCH /v1/admin/banners/{id}`

Any of these fields; the others stay:

```json
{
  "name": "Diwali offer",
  "linkUrl": "/products/basmati-rice-1kg",
  "isActive": true,
  "startsAt": "2026-10-20T00:00:00.000Z",
  "endsAt": "2026-11-05T23:00:00.000Z",
  "alt": { "en": "Diwali offer", "de": "Diwali-Angebot" }
}
```

| Field | Rules |
| --- | --- |
| `name` | at most 80 characters; `""` removes it |
| `linkUrl` | a path starting with one `/` (`/products/…`, `/categories/…`), or an `https://` address; no spaces; at most 2000 characters; `null` removes it. `http://`, `javascript:` and `//host` are refused |
| `isActive` | boolean |
| `startsAt`, `endsAt` | ISO 8601 instants; `null` removes one; the end must come after the start |
| `alt` | `{ en?, de? }`, each at most 300 characters |

**Success:** `200 { "banner": { … } }`. **Errors:** `400 VALIDATION_FAILED`, `400 BANNER_SCHEDULE_INVALID`, `404 BANNER_NOT_FOUND`.

### `PUT /v1/admin/banners/{id}/image`

Replace the picture: multipart with one field `file`, same rules as the creation. The old files are deleted; the description stays. **Success:** `200 { "banner": { … } }`.

### `PUT /v1/admin/banners/order`

`{ "orderedIds": ["66f3…", "66f5…", …] }`: **every** banner exactly once, in the new order. **Success:** `204`. **Errors:** `400 BANNER_ORDER_INVALID` (`details: { expected: [ids] }`).

### `DELETE /v1/admin/banners/{id}`

Deletes the banner and its files. **Success:** `204`. **Errors:** `404 BANNER_NOT_FOUND`.

### Panel workflow

1. Banner page: the list from `GET`, each row with the `small` picture, `name`, `status` as a badge (`live` green, `scheduled` blue, `expired` grey, `inactive` grey), the link, the period, a switch for `isActive`, drag-and-drop ordering that sends `PUT …/order` with all ids after a drop, and delete with confirmation.
2. "New banner": a file picker that posts to `POST /v1/admin/banners`, then opens the edit form of the created banner. Show the upload rules next to the picker (2400 × 1000 px recommended, wider than tall, at least 1200 × 300, JPEG/PNG/WebP, 10 MB).
3. Edit form: picture preview with "Replace picture" (`PUT …/image`), name, link, alt text in both languages, the switch, start and end as date-time pickers in the admin's local time converted to ISO before sending, saved with one `PATCH`. Show `BANNER_SCHEDULE_INVALID` at the end field.
4. Do not set the `Content-Type` header on the multipart calls; the browser sets the boundary. Send `credentials: 'include'`.

## 4. Public API and the carousel

### `GET /v1/store/banners`

No authentication. `?locale=en|de` for the descriptions, else `Accept-Language`. Answers only banners that are switched on and inside their period, in display order; cached for 60 seconds (`Cache-Control: public, max-age=60`).

```json
{
  "banners": [
    {
      "id": "66f3…",
      "image": {
        "id": "66f4…",
        "alt": "Diwali offer",
        "url": "https://cdn.radhefoods.de/…/large.webp",
        "sizes": {
          "small": { "url": "…/small.webp", "width": 768, "height": 320 },
          "medium": { "url": "…/medium.webp", "width": 1536, "height": 640 },
          "large": { "url": "…/large.webp", "width": 2400, "height": 1000 }
        },
        "width": 2400,
        "height": 1000
      },
      "linkUrl": "/products/basmati-rice-1kg",
      "isExternal": false
    }
  ]
}
```

`image.width` and `image.height` are those of the largest size; every size has the same ratio. `isExternal` is `true` for an `https://` address.

### Shop workflow

- Fetch once on the homepage (server-side if the page is server-rendered; the answer is cacheable). An empty `banners` array means: render no carousel at all, no placeholder.
- One slide per banner, in the order given. The slide is an `<img>` with `srcset` from `sizes` (`768w`, `1536w`, `2400w`), `sizes="100vw"`, `alt` from `image.alt` (empty string when `null`), the first slide `loading="eager"` and `fetchpriority="high"`, the others `loading="lazy"`.
- **Keep the picture's ratio on every screen**: set `aspect-ratio: width / height` from the API on the slide container and `object-fit: contain` (or simply let the image size the container). Never crop with `object-fit: cover` and never set a fixed height: the picture carries text, and cropping cuts it off on phones.
- With `linkUrl`: wrap the slide in a link. `isExternal: false` → the app's internal navigation (Next.js `Link`); `isExternal: true` → `<a href target="_blank" rel="noopener noreferrer">`. Without `linkUrl`: no link.
- Controls, with the shop's existing look: previous and next arrows (hidden when there is one slide), pagination dots, swipe on touch, optional autoplay every 6 seconds that pauses on hover, focus and when `prefers-reduced-motion` is set. Keyboard: the arrows are buttons, the slides are reachable by tab when linked.
- No wishlist, cart or account state is needed; the carousel is the same for every visitor.

## 5. Checklist

**Admin Panel**
- [ ] List in display order with picture, name, status badge, link, period, switch, drag-and-drop order (`PUT …/order`), delete.
- [ ] Create by upload (`POST`), then the edit form; replace picture (`PUT …/image`).
- [ ] Edit form with name, link, alt in both languages, switch, start and end; `PATCH` with only the changed fields; `null` to clear link or dates.
- [ ] Upload rules shown; `IMAGE_DIMENSIONS_INVALID`, `BANNER_LIMIT_REACHED`, `BANNER_SCHEDULE_INVALID`, `BANNER_ORDER_INVALID` handled with their messages.

**Customer Web**
- [ ] `GET /v1/store/banners` on the homepage; nothing rendered when empty.
- [ ] Slides keep the picture's ratio on all screens; `srcset` from `sizes`; first slide eager.
- [ ] Links internal or external as `isExternal` says.
- [ ] Arrows, dots, swipe, autoplay with pause, reduced-motion respected.
