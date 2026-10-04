// The demo data of the mock: a shop in the middle of its week. Cargos in
// every stage, orders in every status, payments open, overdue and paid,
// returns, refunds, failed messages. Dates are relative to "now", so the
// data is always current; the same seed always gives the same shop.

import type {
  AdminImage,
  Customer,
  DeliveryMethod,
  OrderStatus,
  PackUnit,
  Role,
  StorageType,
} from "../src/lib/api/types/index.ts";
import type {
  AdminRecord,
  CargoRecord,
  CategoryRecord,
  Db,
  MockConfig,
  OrderRecord,
  ProductRecord,
} from "./db.ts";
import { emptyDb } from "./db.ts";
import {
  activatePayment,
  deliveryFeeFor,
  issueCreditNote,
  markPaid,
  packLabel,
  pushHistory,
  queueMessage,
  recomputeFinal,
  totalsOf,
  vatOf,
} from "./domain.ts";
import { newId } from "./http.ts";
import { DAY, HOUR, addDays, berlinDay, berlinMoment, iso } from "./time.ts";

export const ALL_PERMISSIONS = [
  "admin_users.read",
  "admin_users.manage",
  "roles.read",
  "roles.manage",
  "customers.read",
  "customers.manage",
  "catalog.read",
  "catalog.manage",
  "cargos.read",
  "cargos.manage",
  "orders.read",
  "orders.manage",
  "settings.read",
  "settings.manage",
  "legal.read",
  "legal.manage",
  "payments.read",
  "payments.manage",
  "notifications.read",
  "notifications.manage",
];

/** The sign-ins of the demo. Every admin also accepts the code 000000. */
export const DEMO_ADMINS = {
  owner: { email: "owner@radhefoods.de", password: "radhe-owner-2026" },
  orders: { email: "orders@radhefoods.de", password: "radhe-orders-2026" },
  viewer: { email: "viewer@radhefoods.de", password: "radhe-viewer-2026" },
  /** First sign-in: authenticator setup, then the forced password change. */
  newcomer: { email: "new@radhefoods.de", password: "temporary-pass-123" },
  disabled: { email: "former@radhefoods.de", password: "radhe-former-2026" },
} as const;

/** A small, fast, repeatable random source. */
function random(seed: number) {
  let state = seed;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(list: readonly T[]): T =>
      list[Math.floor(next() * list.length)] as T,
    chance: (probability: number) => next() < probability,
  };
}

export function placeholderImage(
  publicUrl: string,
  id: string,
  label: string,
  hue: number,
  uploadedAt: string,
  alt: { en?: string | null; de?: string | null },
): AdminImage {
  const url = (size: number) =>
    `${publicUrl}/media/placeholder/${hue}/${size}/${encodeURIComponent(label)}.svg`;
  return {
    id,
    alt,
    isPrimary: false,
    url: url(1600),
    sizes: {
      small: { url: url(320), width: 320, height: 320 },
      medium: { url: url(800), width: 800, height: 800 },
      large: { url: url(1600), width: 1600, height: 1600 },
    },
    bytes: 120_000 + hue * 300,
    uploadedAt,
  };
}

// name en, name de, [children: en, de]
const CATEGORY_TREE: [string, string, [string, string][]][] = [
  [
    "Rice & Grains",
    "Reis & Getreide",
    [
      ["Basmati Rice", "Basmati Reis"],
      ["Everyday Rice", "Reis für jeden Tag"],
    ],
  ],
  [
    "Flour",
    "Mehl",
    [
      ["Atta", "Atta"],
      ["Gram & Rice Flour", "Kichererbsen- & Reismehl"],
    ],
  ],
  ["Pulses", "Hülsenfrüchte", []],
  [
    "Spices",
    "Gewürze",
    [
      ["Whole Spices", "Ganze Gewürze"],
      ["Ground Spices", "Gemahlene Gewürze"],
    ],
  ],
  [
    "Snacks & Sweets",
    "Snacks & Süßes",
    [
      ["Namkeen", "Namkeen"],
      ["Sweets", "Süßigkeiten"],
    ],
  ],
  ["Fresh Fruit", "Frisches Obst", [["Mangoes", "Mangos"]]],
  ["Tea & Beverages", "Tee & Getränke", []],
  [
    "Pantry",
    "Vorrat",
    [
      ["Ghee & Oil", "Ghee & Öl"],
      ["Pickles & Papad", "Pickles & Papad"],
    ],
  ],
  ["Frozen", "Tiefkühlware", []],
];

interface ProductSeed {
  name: [string, string];
  brand: string | null;
  category: string;
  /** value, unit, regular price, sale price */
  packs: [number, PackUnit, number, number?][];
  hue: number;
  storage?: StorageType;
  status?: "draft" | "active" | "archived";
  available?: boolean;
  origin?: string;
  ingredients?: [string, string];
}

const PRODUCTS: ProductSeed[] = [
  {
    name: ["Basmati Rice", "Basmati Reis"],
    brand: "India Gate",
    category: "Basmati Rice",
    packs: [
      [1, "kg", 499],
      [5, "kg", 2499, 1999],
      [10, "kg", 4599],
    ],
    hue: 42,
    origin: "India",
    ingredients: ["Basmati rice", "Basmatireis"],
  },
  {
    name: ["Sona Masoori Rice", "Sona Masoori Reis"],
    brand: "Daawat",
    category: "Everyday Rice",
    packs: [
      [5, "kg", 1499],
      [10, "kg", 2799],
    ],
    hue: 48,
    origin: "India",
  },
  {
    name: ["Poha Thick", "Poha dick"],
    brand: "TRS",
    category: "Everyday Rice",
    packs: [[500, "g", 249]],
    hue: 55,
    origin: "India",
  },
  {
    name: ["Chakki Atta", "Chakki Atta"],
    brand: "Aashirvaad",
    category: "Atta",
    packs: [
      [5, "kg", 1299],
      [10, "kg", 2399, 2199],
    ],
    hue: 30,
    origin: "India",
    ingredients: ["Whole wheat flour", "Weizenvollkornmehl"],
  },
  {
    name: ["Besan Gram Flour", "Besan Kichererbsenmehl"],
    brand: "TRS",
    category: "Gram & Rice Flour",
    packs: [[1, "kg", 399]],
    hue: 50,
  },
  {
    name: ["Rice Flour", "Reismehl"],
    brand: "TRS",
    category: "Gram & Rice Flour",
    packs: [[1, "kg", 279]],
    hue: 60,
  },
  {
    name: ["Toor Dal", "Toor Dal"],
    brand: "TRS",
    category: "Pulses",
    packs: [
      [1, "kg", 449],
      [2, "kg", 849],
    ],
    hue: 38,
  },
  {
    name: ["Moong Dal", "Moong Dal"],
    brand: "TRS",
    category: "Pulses",
    packs: [[1, "kg", 479]],
    hue: 75,
  },
  {
    name: ["Chana Dal", "Chana Dal"],
    brand: "Heera",
    category: "Pulses",
    packs: [[1, "kg", 399]],
    hue: 45,
  },
  {
    name: ["Masoor Dal", "Masoor Dal"],
    brand: "Heera",
    category: "Pulses",
    packs: [[1, "kg", 379]],
    hue: 18,
  },
  {
    name: ["Cumin Seeds", "Kreuzkümmel ganz"],
    brand: "MDH",
    category: "Whole Spices",
    packs: [[200, "g", 349]],
    hue: 28,
  },
  {
    name: ["Turmeric Powder", "Kurkuma gemahlen"],
    brand: "MDH",
    category: "Ground Spices",
    packs: [[200, "g", 249]],
    hue: 40,
  },
  {
    name: ["Garam Masala", "Garam Masala"],
    brand: "MDH",
    category: "Ground Spices",
    packs: [[100, "g", 299]],
    hue: 20,
  },
  {
    name: ["Kashmiri Chilli Powder", "Kashmiri Chilipulver"],
    brand: "Everest",
    category: "Ground Spices",
    packs: [[200, "g", 379, 329]],
    hue: 8,
  },
  {
    name: ["Banana Chips", "Bananenchips"],
    brand: "A-1",
    category: "Namkeen",
    packs: [[200, "g", 399]],
    hue: 52,
  },
  {
    name: ["Bhujia Sev", "Bhujia Sev"],
    brand: "Haldiram's",
    category: "Namkeen",
    packs: [[400, "g", 449]],
    hue: 35,
  },
  {
    name: ["Methi Khakhra", "Methi Khakhra"],
    brand: "Induben",
    category: "Namkeen",
    packs: [[200, "g", 329]],
    hue: 95,
  },
  {
    name: ["Soan Papdi", "Soan Papdi"],
    brand: "Haldiram's",
    category: "Sweets",
    packs: [[250, "g", 399]],
    hue: 46,
  },
  {
    name: ["Kesar Mango Box", "Kesar Mango Kiste"],
    brand: null,
    category: "Mangoes",
    packs: [[3, "kg", 2499]],
    hue: 36,
    storage: "chilled",
    origin: "Gujarat, India",
  },
  {
    name: ["Alphonso Mango Box", "Alphonso Mango Kiste"],
    brand: null,
    category: "Mangoes",
    packs: [[3, "kg", 3299]],
    hue: 32,
    storage: "chilled",
    origin: "Maharashtra, India",
    available: false,
  },
  {
    name: ["Premium Leaf Tea", "Premium Blatt-Tee"],
    brand: "Wagh Bakri",
    category: "Tea & Beverages",
    packs: [
      [250, "g", 399],
      [500, "g", 749],
      [1, "kg", 1399, 1249],
    ],
    hue: 12,
  },
  {
    name: ["Masala Chai", "Masala Chai"],
    brand: "Wagh Bakri",
    category: "Tea & Beverages",
    packs: [[250, "g", 449]],
    hue: 22,
  },
  {
    name: ["Pure Cow Ghee", "Reines Kuh-Ghee"],
    brand: "Amul",
    category: "Ghee & Oil",
    packs: [
      [500, "ml", 899],
      [1, "l", 1699],
    ],
    hue: 49,
  },
  {
    name: ["Mango Pickle", "Mango Pickle"],
    brand: "Mother's Recipe",
    category: "Pickles & Papad",
    packs: [[400, "g", 349]],
    hue: 15,
  },
  {
    name: ["Urad Papad", "Urad Papad"],
    brand: "Lijjat",
    category: "Pickles & Papad",
    packs: [[200, "g", 229]],
    hue: 44,
  },
  {
    name: ["Paneer", "Paneer"],
    brand: "Amul",
    category: "Frozen",
    packs: [[400, "g", 549]],
    hue: 200,
    storage: "frozen",
    status: "draft",
  },
  {
    name: ["Jaggery Powder", "Jaggery Pulver"],
    brand: "24 Mantra",
    category: "Pantry",
    packs: [[500, "g", 399]],
    hue: 26,
    status: "archived",
  },
];

const FIRST = [
  "Priya",
  "Anna",
  "Jonas",
  "Meera",
  "Lukas",
  "Sara",
  "Rahul",
  "Lena",
  "Amit",
  "Sophie",
  "Neha",
  "Felix",
  "Kiran",
  "Marie",
  "Vikram",
  "Laura",
  "Anjali",
  "Paul",
  "Deepa",
  "Tim",
  "Pooja",
  "Leon",
  "Ritu",
  "Emma",
  "Sanjay",
  "Mia",
  "Divya",
  "Noah",
  "Kavita",
  "Elias",
  "Arjun",
  "Hannah",
];
const LAST = [
  "Shah",
  "Schmidt",
  "Weber",
  "Patel",
  "Becker",
  "Yilmaz",
  "Mehta",
  "Fischer",
  "Desai",
  "Wagner",
  "Joshi",
  "Hoffmann",
  "Trivedi",
  "Schulz",
  "Rao",
  "Koch",
  "Iyer",
  "Richter",
  "Nair",
  "Klein",
  "Vasoya",
  "Wolf",
  "Kapoor",
  "Neumann",
  "Bhatt",
  "Braun",
  "Reddy",
  "Krüger",
  "Parmar",
  "Hartmann",
];
const PLACES: [string, string][] = [
  ["60311", "Frankfurt am Main"],
  ["60486", "Frankfurt am Main"],
  ["60594", "Frankfurt am Main"],
  ["65929", "Frankfurt am Main"],
  ["63065", "Offenbach am Main"],
  ["63067", "Offenbach am Main"],
  ["61348", "Bad Homburg"],
  ["65185", "Wiesbaden"],
  ["55116", "Mainz"],
  ["64283", "Darmstadt"],
  ["65760", "Eschborn"],
  ["61118", "Bad Vilbel"],
  ["63450", "Hanau"],
  ["65824", "Schwalbach am Taunus"],
];
const STREETS = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Gartenstraße",
  "Schillerstraße",
  "Goethestraße",
  "Berliner Straße",
  "Mainzer Landstraße",
  "Kaiserstraße",
  "Lindenweg",
  "Am Römerhof",
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const LEGAL_EN = (title: string, version: number) =>
  `# ${title}\n\nVersion ${version}. These terms apply to every pre-order placed at Radhe Foods.\n\n## 1. Pre-order and price\n\nYou confirm your order with the full price shown at checkout. **No payment is collected when you order.**\n\n## 2. Delivery\n\nWe deliver within the delivery window shown for the cargo your order belongs to. If a cargo is delayed, we tell you.\n\n## 3. Payment after delivery\n\nAfter delivery we send an invoice and a payment link. Payment is due by the deadline on the invoice${version > 1 ? ", at the earliest five days after the invoice" : ""}.\n\n## 4. Returns\n\nYou can ask to return single products within 14 days of delivery.\n`;
const LEGAL_DE = (title: string, version: number) =>
  `# ${title}\n\nVersion ${version}. Diese Bedingungen gelten für jede Vorbestellung bei Radhe Foods.\n\n## 1. Vorbestellung und Preis\n\nSie bestätigen Ihre Bestellung mit dem vollständigen Preis, der an der Kasse angezeigt wird. **Bei der Bestellung wird keine Zahlung eingezogen.**\n\n## 2. Lieferung\n\nWir liefern innerhalb des Lieferzeitraums der Lieferung, zu der Ihre Bestellung gehört.\n\n## 3. Zahlung nach Lieferung\n\nNach der Lieferung senden wir eine Rechnung und einen Zahlungslink. Die Zahlung ist bis zur Frist auf der Rechnung fällig${version > 1 ? ", frühestens fünf Tage nach der Rechnung" : ""}.\n\n## 4. Rücksendungen\n\nEinzelne Produkte können Sie innerhalb von 14 Tagen nach Lieferung zurückgeben.\n`;

export interface SeedOptions extends MockConfig {
  now?: number;
}

export function seed(options: SeedOptions): Db {
  const now = options.now ?? Date.now();
  const rng = random(20260927);
  const db = emptyDb({
    stripe: options.stripe,
    whatsapp: options.whatsapp,
    publicUrl: options.publicUrl,
  });
  const today = berlinDay(now);
  const long = now - 120 * DAY;

  // --- Roles and admins -----------------------------------------------------
  const role = (
    key: string,
    name: string,
    description: string | null,
    permissions: string[],
    isSystem = false,
  ): Role => ({
    id: newId(long),
    key,
    name,
    description,
    permissions,
    isSystem,
    createdAt: iso(long),
    updatedAt: iso(long),
  });
  const superAdmin = role(
    "super_admin",
    "Super Admin",
    "Everything, including roles. Cannot be edited.",
    ["*"],
    true,
  );
  const orderManager = role(
    "order_manager",
    "Order manager",
    "Handles orders and returns; reads the rest.",
    [
      "orders.read",
      "orders.manage",
      "cargos.read",
      "payments.read",
      "customers.read",
      "catalog.read",
      "notifications.read",
    ],
  );
  const catalogueEditor = role(
    "catalogue_editor",
    "Catalogue editor",
    "Keeps products, categories and pictures.",
    ["catalog.read", "catalog.manage", "cargos.read"],
  );
  const viewer = role(
    "viewer",
    "Viewer",
    "Reads everything, changes nothing.",
    ALL_PERMISSIONS.filter((p) => p.endsWith(".read")),
  );
  db.roles.push(superAdmin, orderManager, catalogueEditor, viewer);

  const admin = (
    key: keyof typeof DEMO_ADMINS,
    name: string,
    roleId: string,
    extra: Partial<AdminRecord> = {},
  ): AdminRecord => ({
    id: newId(long + db.admins.length * 1000),
    email: DEMO_ADMINS[key].email,
    name,
    status: "active",
    roleId,
    password: DEMO_ADMINS[key].password,
    totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    pendingTotpSecret: null,
    lastTotpStep: null,
    mustChangePassword: false,
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: iso(now - 20 * HOUR),
    createdAt: iso(long),
    updatedAt: iso(long),
    ...extra,
  });
  const owner = admin("owner", "Vrushabh Vasoya", superAdmin.id);
  db.admins.push(
    owner,
    admin("orders", "Nisha Patel", orderManager.id, {
      lastLoginAt: iso(now - 3 * DAY),
    }),
    admin("viewer", "Tobias Keller", viewer.id, {
      lastLoginAt: iso(now - 9 * DAY),
    }),
    admin("newcomer", "Riya Sharma", catalogueEditor.id, {
      totpSecret: null,
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: iso(now - DAY),
      updatedAt: iso(now - DAY),
    }),
    admin("disabled", "Jan Former", orderManager.id, {
      status: "disabled",
      lastLoginAt: iso(now - 60 * DAY),
    }),
  );

  // --- Settings and legal texts ---------------------------------------------
  db.settings.deliveryFee.tiers = [
    { minOrderValue: 0, fee: 499 },
    { minOrderValue: 5000, fee: 0 },
  ];
  db.settings.company = {
    name: "Radhe Foods",
    addressLines: ["Hanauer Landstraße 120", "60314 Frankfurt am Main"],
    email: "billing@radhefoods.de",
    phone: "+49 69 1234567",
    website: "https://www.radhefoods.de",
    vatId: "DE123456789",
    invoiceFooter: "Thank you for shopping with Radhe Foods.",
    missingForInvoices: [],
  };
  const legal = (
    type: "terms" | "preorder_terms" | "privacy",
    version: number,
    published: number | null,
    en: string,
    de: string,
    note: string | null,
  ) => {
    const created = (published ?? now) - DAY;
    db.legal.push({
      id: newId(created),
      type,
      version,
      status: published ? "published" : "draft",
      title: { en, de },
      content: { en: LEGAL_EN(en, version), de: LEGAL_DE(de, version) },
      note,
      publishedAt: published ? iso(published) : null,
      createdAt: iso(created),
      updatedAt: iso(published ?? now - 2 * HOUR),
    });
  };
  legal(
    "terms",
    1,
    now - 110 * DAY,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "First version",
  );
  legal(
    "terms",
    2,
    now - 40 * DAY,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "Payment deadline clarified",
  );
  legal(
    "terms",
    3,
    null,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "Return window wording",
  );
  legal(
    "preorder_terms",
    1,
    now - 110 * DAY,
    "Pre-Order and Payment Terms",
    "Vorbestell- und Zahlungsbedingungen",
    null,
  );
  legal(
    "privacy",
    1,
    now - 110 * DAY,
    "Privacy Policy",
    "Datenschutzerklärung",
    null,
  );

  // --- Categories and products ----------------------------------------------
  const categoryByName = new Map<string, CategoryRecord>();
  const addCategory = (
    en: string,
    de: string,
    parentId: string | null,
    sortOrder: number,
    hue: number,
  ): CategoryRecord => {
    const at = long + categoryByName.size * 60_000;
    const record: CategoryRecord = {
      id: newId(at),
      name: { en, de },
      slug: { en: slugify(en), de: slugify(de) },
      tagline: parentId
        ? null
        : { en: `Everything ${en.toLowerCase()}`, de: null },
      description: null,
      parentId,
      sortOrder,
      isVisible: en !== "Frozen",
      image: parentId
        ? null
        : {
            ...placeholderImage(
              options.publicUrl,
              newId(at),
              en,
              hue,
              iso(at),
              { en, de },
            ),
            isPrimary: true,
          },
      seo: null,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.categories.push(record);
    categoryByName.set(en, record);
    return record;
  };
  CATEGORY_TREE.forEach(([en, de, children], index) => {
    const parent = addCategory(en, de, null, index, 20 + index * 37);
    children.forEach(([childEn, childDe], childIndex) =>
      addCategory(childEn, childDe, parent.id, childIndex, 0),
    );
  });

  for (const item of PRODUCTS) {
    const category = categoryByName.get(item.category);
    if (!category) continue;
    const groupId = item.packs.length > 1 ? newId(long) : null;
    item.packs.forEach(([value, unit, regularPrice, salePrice], index) => {
      db.counters.sku += 1;
      const at = long + db.counters.sku * 3600_000;
      const label = packLabel(value, unit);
      const status = item.status ?? "active";
      const id = newId(at);
      const images = Array.from(
        { length: index === 0 ? 2 : 1 },
        (_, imageIndex) => ({
          ...placeholderImage(
            options.publicUrl,
            newId(at + imageIndex + 1),
            item.name[0],
            item.hue + imageIndex * 14,
            iso(at),
            { en: item.name[0], de: imageIndex === 0 ? item.name[1] : null },
          ),
          isPrimary: imageIndex === 0,
        }),
      );
      const product: ProductRecord = {
        id,
        sku: `RF-${String(db.counters.sku).padStart(5, "0")}`,
        gtin: rng.chance(0.6)
          ? `890${String(1000000000 + db.counters.sku * 7919).slice(0, 10)}`
          : null,
        name: { en: item.name[0], de: item.name[1] },
        slug: {
          en: slugify(`${item.name[0]} ${label}`),
          de: slugify(`${item.name[1]} ${label}`),
        },
        brand: item.brand,
        packSize: { value, unit, label },
        regularPrice,
        salePrice: salePrice ?? null,
        vatRate: 700,
        status,
        isAvailable: item.available ?? true,
        isFeatured: rng.chance(0.15),
        sortOrder: 0,
        variantGroupId: groupId,
        isDefaultVariant: groupId
          ? index === Math.min(1, item.packs.length - 1)
          : true,
        subtitle: null,
        shortDescription: {
          en: `${item.name[0]} in a ${label} pack.`,
          de: `${item.name[1]} in der ${label}-Packung.`,
        },
        description: {
          en: `${item.name[0]}${item.brand ? ` by ${item.brand}` : ""}. A staple of the Indian kitchen, brought in fresh with every cargo.`,
          de: rng.chance(0.75)
            ? `${item.name[1]}${item.brand ? ` von ${item.brand}` : ""}. Ein Grundnahrungsmittel der indischen Küche.`
            : null,
        },
        highlights: {
          en: ["Authentic quality", "Imported with each cargo"],
          de: ["Authentische Qualität"],
        },
        uses: { en: [], de: [] },
        categoryId: category.id,
        minOrderQuantity: 1,
        maxOrderQuantity: item.storage === "chilled" ? 4 : null,
        storageType: item.storage ?? "ambient",
        food: {
          ingredients: item.ingredients
            ? { en: item.ingredients[0], de: item.ingredients[1] }
            : null,
          allergens: null,
          nutrition: null,
          storageInstructions: {
            en: "Store cool and dry.",
            de: "Kühl und trocken lagern.",
          },
          origin: item.origin ?? "India",
          manufacturer: null,
        },
        tags: salePrice ? ["offer"] : [],
        searchKeywords: [item.name[1]],
        seo: null,
        images,
        publishedAt: status === "draft" ? null : iso(at + HOUR),
        createdAt: iso(at),
        updatedAt: iso(at + HOUR),
      };
      db.products.push(product);
      const history = [
        {
          regularPrice,
          salePrice: null as number | null,
          price: regularPrice,
          vatRate: 700,
          changedBy: owner.id,
          changedAt: iso(at),
        },
      ];
      if (salePrice)
        history.unshift({
          regularPrice,
          salePrice,
          price: salePrice,
          vatRate: 700,
          changedBy: owner.id,
          changedAt: iso(now - 12 * DAY),
        });
      db.priceChanges.set(id, history);
    });
  }
  const orderable = db.products.filter(
    (product) => product.status === "active" && product.isAvailable,
  );

  // --- Customers ------------------------------------------------------------
  for (let index = 0; index < 68; index += 1) {
    const firstName = FIRST[index % FIRST.length] as string;
    const lastName = LAST[(index * 7 + 3) % LAST.length] as string;
    const [postalCode, city] = rng.pick(PLACES);
    const created = now - (110 - index) * DAY - rng.int(0, 20) * HOUR;
    const phone = `+49151${String(10000000 + index * 104729).slice(0, 8)}`;
    const whatsapp = rng.chance(0.4);
    const marketing = rng.chance(0.55);
    const email = `${slugify(firstName)}.${slugify(lastName)}${index > 29 ? index : ""}@example.com`;
    db.customers.push({
      id: newId(created),
      email,
      firstName,
      lastName,
      phone: rng.chance(0.8) ? phone : null,
      locale: rng.chance(0.55) ? "de" : "en",
      hasGoogleLogin: rng.chance(0.3),
      communication: {
        whatsappNumber: whatsapp ? phone : null,
        whatsappOptIn: whatsapp,
        whatsappOptInAt: whatsapp ? iso(created + DAY) : null,
        marketingOptIn: marketing,
        marketingOptInAt: marketing ? iso(created + DAY) : null,
        marketingOptOutAt: null,
      },
      createdAt: iso(created),
      status: "active",
      blockedReason: null,
      blockedAt: null,
      signupMethod: rng.chance(0.3) ? "google" : "email_otp",
      emailVerifiedAt: iso(created),
      lastLoginAt: iso(now - rng.int(1, 30) * DAY),
      updatedAt: iso(created + DAY),
      addresses: [
        {
          id: newId(created + 1000),
          firstName,
          lastName,
          company: null,
          street: rng.pick(STREETS),
          houseNumber: `${rng.int(1, 140)}${rng.chance(0.15) ? "a" : ""}`,
          additionalLine: rng.chance(0.12) ? "2. OG" : null,
          postalCode,
          city,
          countryCode: "DE",
          phone: null,
          isDefault: true,
        },
      ],
      orderingOverride: null,
      orderingHistory: [],
    });
  }
  const blocked = db.customers[7] as Customer;
  blocked.status = "blocked";
  blocked.blockedReason = "Three orders refused at the door.";
  blocked.blockedAt = iso(now - 30 * DAY);

  // --- Cargos ---------------------------------------------------------------
  interface CargoPlan {
    name: string;
    status: CargoRecord["status"];
    openDays: number;
    closeDays: number;
    deliveryDays: [number, number];
    path: CargoRecord["status"][];
  }
  const fullPath: CargoRecord["status"][] = [
    "draft",
    "scheduled",
    "taking_orders",
    "orders_closed",
    "in_transit",
    "arrived",
    "delivering",
    "delivered",
  ];
  const plans: CargoPlan[] = [
    {
      name: "August, last week",
      status: "cancelled",
      openDays: -62,
      closeDays: -58,
      deliveryDays: [-48, -46],
      path: ["draft", "scheduled", "cancelled"],
    },
    {
      name: "September, first week",
      status: "delivered",
      openDays: -52,
      closeDays: -48,
      deliveryDays: [-38, -36],
      path: fullPath,
    },
    {
      name: "September, third week",
      status: "delivered",
      openDays: -38,
      closeDays: -34,
      deliveryDays: [-24, -22],
      path: fullPath,
    },
    {
      name: "October, first week",
      status: "delivered",
      openDays: -24,
      closeDays: -20,
      deliveryDays: [-8, -6],
      path: fullPath,
    },
    {
      name: "October, second week",
      status: "delivering",
      openDays: -20,
      closeDays: -13,
      deliveryDays: [-1, 1],
      path: fullPath.slice(0, 7),
    },
    {
      name: "October, third week",
      status: "in_transit",
      openDays: -13,
      closeDays: -6,
      deliveryDays: [5, 7],
      path: fullPath.slice(0, 5),
    },
    {
      name: "October, fourth week",
      status: "taking_orders",
      openDays: -6,
      closeDays: 1,
      deliveryDays: [12, 14],
      path: fullPath.slice(0, 3),
    },
    {
      name: "November, first week",
      status: "scheduled",
      openDays: 2,
      closeDays: 9,
      deliveryDays: [19, 21],
      path: fullPath.slice(0, 2),
    },
    {
      name: "November, second week",
      status: "draft",
      openDays: 9,
      closeDays: 16,
      deliveryDays: [26, 28],
      path: ["draft"],
    },
  ];
  db.counters.cargo = 21;
  const cargos: CargoRecord[] = plans.map((plan) => {
    db.counters.cargo += 1;
    const openAt = berlinMoment(addDays(today, plan.openDays), 0, 0);
    // The open cargo closes tomorrow evening: a countdown worth looking at.
    const closeAt =
      plan.status === "taking_orders"
        ? berlinMoment(addDays(today, plan.closeDays), 23, 59)
        : berlinMoment(addDays(today, plan.closeDays - 1), 23, 59);
    const created = openAt - 6 * DAY;
    const stepTimes: Record<string, number> = {
      draft: created,
      scheduled: created + HOUR,
      taking_orders: openAt + 3000,
      orders_closed: closeAt + 60_000,
      in_transit: closeAt + 2 * DAY,
      arrived: berlinMoment(addDays(today, plan.deliveryDays[0] - 1), 15),
      delivering: berlinMoment(addDays(today, plan.deliveryDays[0]), 6),
      delivered: berlinMoment(addDays(today, plan.deliveryDays[1]), 19),
      cancelled: created + 2 * DAY,
    };
    const record: CargoRecord = {
      id: newId(created),
      number: db.counters.cargo,
      code: `RF-C${String(db.counters.cargo).padStart(3, "0")}`,
      internalName: plan.name,
      customerName: { en: `${plan.name.split(",")[0]} delivery`, de: null },
      customerMessage:
        plan.status === "taking_orders"
          ? {
              en: "Order by tomorrow night for delivery in two weeks.",
              de: "Bestellen Sie bis morgen Abend für die Lieferung in zwei Wochen.",
            }
          : null,
      internalNotes:
        plan.status === "in_transit"
          ? "Container MSCU 482913-7, ETA Hamburg on Thursday."
          : null,
      status: plan.status,
      orderOpenAt: iso(openAt),
      orderCloseAt: iso(closeAt),
      delivery: {
        start: addDays(today, plan.deliveryDays[0]),
        end: addDays(today, plan.deliveryDays[1]),
      },
      timezone: "Europe/Berlin",
      openedAt: plan.path.includes("taking_orders") ? iso(openAt + 3000) : null,
      closedAt: plan.path.includes("orders_closed")
        ? iso(closeAt + 60_000)
        : null,
      createdAt: iso(created),
      updatedAt: iso(stepTimes[plan.status] ?? created),
      statusHistory: plan.path.map((status, index) => ({
        from: index === 0 ? null : (plan.path[index - 1] ?? null),
        to: status,
        at: iso(stepTimes[status] ?? created),
        source:
          status === "taking_orders" || status === "orders_closed"
            ? "schedule"
            : "admin",
        by:
          status === "taking_orders" || status === "orders_closed"
            ? null
            : owner.id,
        note:
          status === "cancelled" ? "Supplier cancelled the shipment." : null,
      })),
    };
    db.cargos.push(record);
    if (plan.status !== "cancelled" && plan.status !== "draft") {
      for (const product of orderable) {
        const limited = product.storageType === "chilled";
        db.cargoProducts.push({
          cargoId: record.id,
          productId: product.id,
          isEnabled: true,
          maxQuantity: limited ? 60 : null,
          orderedQuantity: 0,
        });
      }
    }
    return record;
  });
  const cargo = (name: string) =>
    cargos.find((entry) => entry.internalName === name) as CargoRecord;

  // --- Orders ---------------------------------------------------------------
  db.counters.order = 1000;
  interface OrderPlan {
    status: OrderStatus;
    method?: DeliveryMethod;
  }
  const placeOrder = (
    target: CargoRecord,
    customer: Customer,
    placedAt: number,
    plan: OrderPlan,
  ): OrderRecord => {
    db.counters.order += 1;
    const lines = rng.int(1, 5);
    const chosen = new Set<ProductRecord>();
    while (chosen.size < lines) chosen.add(rng.pick(orderable));
    const items = [...chosen].map((product) => {
      const quantity =
        product.storageType === "chilled" ? rng.int(1, 2) : rng.int(1, 3);
      const unitPrice = product.salePrice ?? product.regularPrice;
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        packSize: product.packSize,
        imageUrl: product.images[0]?.sizes.small.url ?? null,
        quantity,
        unitPrice,
        regularUnitPrice: product.regularPrice,
        lineTotal: quantity * unitPrice,
        vatRate: product.vatRate,
        vatPercent: product.vatRate / 100,
        vatAmount: vatOf(quantity * unitPrice, product.vatRate),
        deliveredQuantity: quantity,
        returnedQuantity: 0,
        finalLineTotal: quantity * unitPrice,
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const totals = totalsOf(
      items.map((item) => ({ gross: item.lineTotal, vatRate: item.vatRate })),
      deliveryFeeFor(db, subtotal),
    );
    const address = customer.addresses[0];
    const method =
      plan.method ??
      rng.pick<DeliveryMethod>([
        "radhe_delivery",
        "radhe_delivery",
        "radhe_delivery",
        "dhl",
        "hermes",
      ]);
    const order: OrderRecord = {
      id: newId(placedAt),
      orderNumber: `RF-${db.counters.order}`,
      type: "preorder",
      status: "confirmed",
      paymentStatus: "not_enabled",
      placedAt: iso(placedAt),
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName ?? undefined,
        lastName: customer.lastName ?? undefined,
        ...(customer.phone ? { phone: customer.phone } : {}),
      },
      cargo: { id: target.id, code: target.code },
      currency: "EUR",
      delivery: {
        method,
        trackingNumber: null,
        trackingUrl: null,
        dispatchedAt: null,
        deliveredAt: null,
        promisedStart: target.delivery.start,
        promisedEnd: target.delivery.end,
        cargo: target.code,
      },
      language: customer.locale,
      items,
      totals,
      finalTotals: totals,
      adjustments: [],
      deliveryAddress: {
        firstName: address?.firstName ?? "",
        lastName: address?.lastName ?? "",
        street: address?.street ?? "",
        houseNumber: address?.houseNumber ?? "",
        ...(address?.additionalLine
          ? { additionalLine: address.additionalLine }
          : {}),
        postalCode: address?.postalCode ?? "",
        city: address?.city ?? "",
        countryCode: "DE",
        ...(customer.phone ? { phone: customer.phone } : {}),
      },
      note: rng.chance(0.12)
        ? rng.pick([
            "Please ring twice.",
            "Leave with the neighbour if I am out.",
            "Bitte nach 17 Uhr liefern.",
          ])
        : null,
      payment: null,
      cancellation: null,
      consent: {
        acceptedAt: iso(placedAt),
        documents: [
          {
            type: "terms",
            version: placedAt > now - 40 * DAY ? 2 : 1,
            documentId: (db.legal.find(
              (doc) =>
                doc.type === "terms" &&
                doc.version === (placedAt > now - 40 * DAY ? 2 : 1),
            ) ?? db.legal[0])!.id,
          },
          {
            type: "privacy",
            version: 1,
            documentId: db.legal.find((doc) => doc.type === "privacy")!.id,
          },
        ],
        ip: `203.0.113.${rng.int(2, 250)}`,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
      },
      statusHistory: [
        {
          field: "order",
          from: null,
          to: "confirmed",
          at: iso(placedAt),
          by: "customer",
          adminId: null,
          note: null,
        },
      ],
      updatedAt: iso(placedAt),
    };
    for (const item of items) {
      const setting = db.cargoProducts.find(
        (entry) =>
          entry.cargoId === target.id && entry.productId === item.productId,
      );
      if (setting) setting.orderedQuantity += item.quantity;
    }
    db.orders.push(order);
    queueMessage(
      db,
      { type: "order_confirmed", customer, order },
      placedAt + 2000,
    );

    const dispatchAt =
      berlinMoment(target.delivery.start, 7) + rng.int(0, 90) * 60_000;
    const deliverAt = dispatchAt + rng.int(3, 30) * HOUR;
    const step = (to: OrderStatus, at: number, note: string | null = null) => {
      pushHistory(
        order,
        {
          field: "order",
          from: order.status,
          to,
          by: "admin",
          adminId: owner.id,
          note,
        },
        at,
      );
      order.status = to;
    };
    const dispatch = () => {
      step("dispatched", dispatchAt);
      order.delivery.dispatchedAt = iso(dispatchAt);
      if (method !== "radhe_delivery")
        order.delivery.trackingNumber =
          method === "dhl"
            ? `0034043416109${4000000 + db.counters.order}`
            : `H100${4800000 + db.counters.order}`;
      queueMessage(
        db,
        { type: "order_dispatched", customer, order },
        dispatchAt + 3000,
      );
    };
    if (plan.status === "preparing")
      step("preparing", Date.parse(target.orderCloseAt) + 3 * DAY);
    if (
      plan.status === "dispatched" ||
      plan.status === "delivered" ||
      plan.status === "delivery_failed"
    )
      dispatch();
    if (plan.status === "delivered") {
      step("delivered", deliverAt);
      order.delivery.deliveredAt = iso(deliverAt);
      queueMessage(
        db,
        { type: "order_delivered", customer, order },
        deliverAt + 3000,
      );
    }
    if (plan.status === "delivery_failed") {
      step("delivery_failed", deliverAt, "Nobody at home, no neighbour.");
      queueMessage(
        db,
        { type: "delivery_failed", customer, order },
        deliverAt + 3000,
      );
    }
    if (plan.status === "cancelled") {
      const at = placedAt + rng.int(2, 30) * HOUR;
      step("cancelled", at);
      order.statusHistory[order.statusHistory.length - 1]!.by = "customer";
      order.statusHistory[order.statusHistory.length - 1]!.adminId = null;
      order.cancellation = {
        reason: "changed_mind",
        text: null,
        by: "customer",
        adminId: null,
        at: iso(at),
      };
      for (const item of items) {
        const setting = db.cargoProducts.find(
          (entry) =>
            entry.cargoId === target.id && entry.productId === item.productId,
        );
        if (setting) setting.orderedQuantity -= item.quantity;
      }
      queueMessage(db, { type: "order_cancelled", customer, order }, at + 3000);
    }
    return order;
  };

  const buyers = db.customers.filter(
    (customer) => customer.status === "active",
  );
  const fill = (
    target: CargoRecord,
    count: number,
    statusOf: (index: number) => OrderStatus,
  ) => {
    const open = Date.parse(target.orderOpenAt);
    const close = Math.min(Date.parse(target.orderCloseAt), now - 20 * 60_000);
    const created: OrderRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      const placedAt =
        open + Math.floor(((close - open) * (index + rng.next())) / count);
      created.push(
        placeOrder(target, rng.pick(buyers), placedAt, {
          status: statusOf(index),
        }),
      );
    }
    return created;
  };

  const collect = (
    orders: OrderRecord[],
    activatedAt: number,
    deadlineDays: number,
    outcome: (
      index: number,
      order: OrderRecord,
    ) => "paid" | "due" | "overdue" | "waived" | "none",
  ) => {
    orders.forEach((order, index) => {
      if (order.status !== "delivered") return;
      const result = outcome(index, order);
      if (result === "none") return;
      const customer = db.customers.find(
        (entry) => entry.id === order.customer.id,
      ) as Customer;
      const invoice = activatePayment(
        db,
        order,
        deadlineDays,
        owner.id,
        activatedAt + index * 400,
      );
      const payment = order.payment!;
      // The deadline counts from the activation, not from today.
      payment.deadline = iso(
        berlinMoment(addDays(berlinDay(activatedAt), deadlineDays), 23, 59, 59),
      );
      invoice.dueAt = payment.deadline;
      queueMessage(
        db,
        {
          type: "payment_request",
          customer,
          order,
          attachInvoiceId: invoice.id,
          data: {
            amountDue: invoice.total,
            deadline: payment.deadline,
            payUrl: `https://www.radhefoods.de/pay/demo-${order.orderNumber}`,
          },
        },
        activatedAt + index * 400 + 3000,
      );
      const deadline = Date.parse(payment.deadline);
      if (result === "paid") {
        const paidAt = Math.min(
          now - HOUR,
          activatedAt + rng.int(4, deadlineDays * 22) * HOUR,
        );
        const byStripe = options.stripe && rng.chance(0.55);
        markPaid(
          db,
          order,
          byStripe ? "stripe" : "cash",
          paidAt,
          byStripe ? "customer" : "admin",
          byStripe ? null : owner.id,
        );
        if (byStripe)
          payment.stripe = {
            paymentIntentId: `pi_3Demo${order.orderNumber.slice(3)}`,
            chargeId: `ch_3Demo${order.orderNumber.slice(3)}`,
            paymentType: rng.chance(0.7) ? "card" : "paypal",
            receiptUrl: "https://pay.stripe.com/receipts/demo",
            checkoutOpenUntil: null,
          };
        else
          payment.cash = {
            collectedAt: iso(paidAt),
            recordedBy: owner.id,
            note: rng.chance(0.3) ? "Paid to the driver." : null,
          };
        queueMessage(
          db,
          { type: "payment_received", customer, order },
          paidAt + 3000,
        );
        return;
      }
      if (result === "waived") {
        const at = activatedAt + 6 * DAY;
        pushHistory(
          order,
          {
            field: "payment",
            from: "due",
            to: "waived",
            adminId: owner.id,
            note: "Goodwill after a damaged delivery.",
          },
          at,
        );
        order.paymentStatus = "waived";
        payment.waivedReason = "Goodwill after a damaged delivery.";
        payment.amountDue = 0;
        payment.reminders.nextAt = null;
        return;
      }
      // Still owing: one reminder per day since the day after activation.
      const reminders = Math.max(
        0,
        Math.min(14, Math.floor((now - activatedAt) / DAY)),
      );
      for (let day = 1; day <= reminders; day += 1) {
        const at = berlinMoment(addDays(berlinDay(activatedAt), day), 9);
        if (at > now) break;
        const fails =
          result === "overdue" && day === reminders && index % 2 === 0;
        queueMessage(
          db,
          {
            type: "payment_reminder",
            customer,
            order,
            outcome: fails ? "failed" : "sent",
            error: fails
              ? "554 Message rejected: mailbox unavailable"
              : undefined,
            data: { amountDue: payment.amountDue, deadline: payment.deadline },
          },
          at,
        );
        payment.reminders.sentCount += 1;
        payment.reminders.lastSentAt = iso(at);
        pushHistory(
          order,
          {
            field: "payment",
            from: order.paymentStatus,
            to: "reminder_sent",
            by: "system",
          },
          at,
        );
      }
      if (result === "overdue" || deadline < now) {
        pushHistory(
          order,
          { field: "payment", from: "due", to: "overdue", by: "system" },
          Math.min(now - HOUR, deadline + 1000),
        );
        order.paymentStatus = "overdue";
      }
    });
  };

  // September, first week: finished and fully paid.
  const c23 = fill(cargo("September, first week"), 24, () => "delivered");
  collect(c23, berlinMoment(addDays(today, -35), 20), 5, () => "paid");

  // September, third week: collected, with the leftovers of real life.
  const c24 = fill(cargo("September, third week"), 30, (index) =>
    index === 11 ? "cancelled" : "delivered",
  );
  collect(c24, berlinMoment(addDays(today, -21), 20), 5, (index) =>
    index === 4 || index === 17 ? "overdue" : index === 9 ? "waived" : "paid",
  );

  // October, first week: delivered last week, payment half way.
  const c25 = fill(cargo("October, first week"), 40, (index) =>
    index === 6 ? "delivery_failed" : index === 21 ? "cancelled" : "delivered",
  );
  collect(c25, berlinMoment(addDays(today, -4), 20), 5, (index) =>
    index >= 30 ? "none" : index % 3 === 0 ? "paid" : "due",
  );

  // October, second week: being delivered right now.
  fill(cargo("October, second week"), 35, (index) =>
    index < 14
      ? "delivered"
      : index < 29
        ? "dispatched"
        : index === 29
          ? "delivery_failed"
          : index === 30
            ? "cancelled"
            : "preparing",
  );

  // October, third week: on the ship.
  fill(cargo("October, third week"), 30, (index) =>
    index % 4 === 0 ? "preparing" : "confirmed",
  );

  // October, fourth week: taking orders.
  fill(cargo("October, fourth week"), 47, (index) =>
    index === 13 ? "cancelled" : "confirmed",
  );

  // --- A correction, returns and refunds ------------------------------------
  const paidOrders = c24.filter(
    (order) =>
      order.paymentStatus === "paid" &&
      order.items.some((item) => item.quantity > 1),
  );

  // A crushed box, found after the invoice was paid: credit note, refund to do.
  const corrected = paidOrders[0];
  if (corrected) {
    const item = corrected.items.find((entry) => entry.quantity > 1)!;
    const at = berlinMoment(addDays(today, -15), 11);
    corrected.adjustments.push({
      productId: item.productId,
      sku: item.sku,
      from: item.quantity,
      to: item.quantity - 1,
      reason: "damaged",
      note: "Box crushed in transit.",
      adminId: owner.id,
      at: iso(at),
    });
    item.deliveredQuantity -= 1;
    recomputeFinal(corrected);
    issueCreditNote(db, corrected, item.unitPrice, "adjustment", at);
    const refundAt = at + HOUR;
    db.refunds.push({
      id: newId(refundAt),
      refundNumber: `${corrected.orderNumber}-RF1`,
      orderId: corrected.id,
      orderNumber: corrected.orderNumber,
      invoiceNumber: corrected.payment!.invoice.number,
      amount: item.unitPrice,
      reason: "adjustment",
      method: "manual",
      status: "pending",
      manual: { way: "bank_transfer", reference: null, paidAt: null },
      stripe: null,
      note: "Customer sent the IBAN by email.",
      createdBy: owner.id,
      createdAt: iso(refundAt),
      completedAt: null,
      statusHistory: [
        {
          from: null,
          to: "pending",
          at: iso(refundAt),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
    });
  }

  // A completed return with its refund sent.
  const returned = paidOrders[1];
  if (returned) {
    const item = returned.items[0]!;
    const customer = db.customers.find(
      (entry) => entry.id === returned.customer.id,
    )!;
    const requested = berlinMoment(addDays(today, -18), 14);
    const completed = requested + 4 * DAY;
    item.returnedQuantity = 1;
    recomputeFinal(returned);
    issueCreditNote(
      db,
      returned,
      item.unitPrice,
      "return",
      completed,
      `${returned.orderNumber}-R1`,
    );
    db.returns.push({
      id: newId(requested),
      returnNumber: `${returned.orderNumber}-R1`,
      orderId: returned.id,
      orderNumber: returned.orderNumber,
      customerId: returned.customer.id,
      cargoId: returned.cargo.id,
      status: "completed",
      requestedAt: iso(requested),
      decidedAt: iso(requested + DAY),
      completedAt: iso(completed),
      items: [
        {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          packSize: item.packSize,
          quantity: 1,
          approvedQuantity: 1,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          reason: "quality",
          comment: "Tasted stale.",
        },
      ],
      requestedAmount: item.unitPrice,
      customerComment: null,
      decisionNote: "We collect it with the next delivery.",
      internalNote: null,
      creditAmount: item.unitPrice,
      statusHistory: [
        {
          from: null,
          to: "requested",
          at: iso(requested),
          by: "customer",
          adminId: null,
          note: null,
        },
        {
          from: "requested",
          to: "approved",
          at: iso(requested + DAY),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
        {
          from: "approved",
          to: "completed",
          at: iso(completed),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
      updatedAt: iso(completed),
    });
    const refundAt = completed + 2 * HOUR;
    const refundId = newId(refundAt);
    db.refunds.push({
      id: refundId,
      refundNumber: `${returned.orderNumber}-RF1`,
      orderId: returned.id,
      orderNumber: returned.orderNumber,
      invoiceNumber: returned.payment!.invoice.number,
      amount: item.unitPrice,
      reason: "return",
      method: "manual",
      status: "completed",
      manual: {
        way: "bank_transfer",
        reference: "SEPA 2026-10-0412",
        paidAt: iso(refundAt + DAY),
      },
      stripe: null,
      note: null,
      createdBy: owner.id,
      createdAt: iso(refundAt),
      completedAt: iso(refundAt + DAY),
      statusHistory: [
        {
          from: null,
          to: "pending",
          at: iso(refundAt),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
        {
          from: "pending",
          to: "completed",
          at: iso(refundAt + DAY),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
    });
    returned.payment!.refundedAmount = item.unitPrice;
    queueMessage(
      db,
      {
        type: "return_completed",
        customer,
        order: returned,
        returnId: db.returns[db.returns.length - 1]!.id,
      },
      completed + 3000,
    );
    queueMessage(
      db,
      { type: "refund_completed", customer, order: returned, refundId },
      refundAt + DAY + 3000,
    );
  }

  // Three return requests wait for a decision; one is approved and on its way back.
  const askers = c25
    .filter((order) => order.status === "delivered")
    .slice(2, 6);
  askers.forEach((order, index) => {
    const item = order.items[0]!;
    const customer = db.customers.find(
      (entry) => entry.id === order.customer.id,
    )!;
    const requested = now - (index + 1) * 9 * HOUR;
    const approved = index === 3;
    db.returns.push({
      id: newId(requested),
      returnNumber: `${order.orderNumber}-R1`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer.id,
      cargoId: order.cargo.id,
      status: approved ? "approved" : "requested",
      requestedAt: iso(requested),
      decidedAt: approved ? iso(requested + 2 * HOUR) : null,
      completedAt: null,
      items: [
        {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          packSize: item.packSize,
          quantity: 1,
          approvedQuantity: approved ? 1 : null,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          reason:
            (["damaged", "wrong_item", "changed_mind", "quality"] as const)[
              index
            ] ?? "other",
          comment:
            [
              "The bag was torn.",
              "I ordered the 5 kg pack.",
              null,
              "Smells off.",
            ][index] ?? null,
        },
      ],
      requestedAmount: item.unitPrice,
      customerComment: index === 0 ? "Please pick it up on Monday." : null,
      decisionNote: approved
        ? "Hand it to the driver with your next delivery."
        : null,
      internalNote: null,
      creditAmount: null,
      statusHistory: [
        {
          from: null,
          to: "requested",
          at: iso(requested),
          by: "customer",
          adminId: null,
          note: null,
        },
        ...(approved
          ? [
              {
                from: "requested" as const,
                to: "approved" as const,
                at: iso(requested + 2 * HOUR),
                by: "admin" as const,
                adminId: owner.id,
                note: null,
              },
            ]
          : []),
      ],
      updatedAt: iso(requested),
    });
    queueMessage(
      db,
      {
        type: "return_requested",
        customer,
        order,
        returnId: db.returns[db.returns.length - 1]!.id,
      },
      requested + 3000,
    );
  });

  // A customer who promised to pay may order although a payment is overdue.
  const late = c24.find((order) => order.paymentStatus === "overdue");
  const promiser = late
    ? db.customers.find((entry) => entry.id === late.customer.id)
    : undefined;
  if (promiser) {
    const at = now - 2 * DAY;
    promiser.orderingOverride = {
      mode: "allowed",
      reason: "Promised to pay on Friday.",
      adminId: owner.id,
      at: iso(at),
      until: iso(at + 7 * DAY),
    };
    promiser.orderingHistory.push({
      action: "allow",
      reason: "Promised to pay on Friday.",
      adminId: owner.id,
      at: iso(at),
      until: iso(at + 7 * DAY),
    });
  }

  // --- Announcements --------------------------------------------------------
  const mango = db.products.find(
    (product) => product.name.en === "Kesar Mango Box",
  );
  const announce = (
    at: number,
    subject: [string, string],
    message: [string, string],
    productId: string | null,
    cargoId: string | null,
  ) => {
    const id = newId(at);
    const recipients = db.customers.filter(
      (customer) =>
        customer.communication.marketingOptIn &&
        customer.status === "active" &&
        Date.parse(customer.createdAt) < at,
    );
    const before = db.notifications.length;
    for (const customer of recipients) {
      queueMessage(
        db,
        {
          type: "announcement",
          customer,
          announcementId: id,
          productId: productId ?? undefined,
          channels: ["email", "whatsapp"],
          subject: { en: subject[0], de: subject[1] },
          data: { link: "https://www.radhefoods.de" },
        },
        at + 5000,
      );
    }
    const target = cargoId
      ? db.cargos.find((entry) => entry.id === cargoId)
      : undefined;
    db.announcements.push({
      id,
      subject: { en: subject[0], de: subject[1] },
      message: { en: message[0], de: message[1] },
      link: "https://www.radhefoods.de",
      linkLabel: null,
      productId,
      productName: productId
        ? (db.products.find((product) => product.id === productId)?.name.en ??
          null)
        : null,
      cargoId,
      cargoCode: target?.code ?? null,
      channels: ["email", "whatsapp"],
      recipients: recipients.length,
      queued: db.notifications.length - before,
      createdBy: owner.id,
      cancelledAt: null,
      createdAt: iso(at),
    });
  };
  announce(
    now - 30 * DAY,
    ["Kesar mangoes are back", "Kesar Mangos sind wieder da"],
    [
      "The first Kesar mangoes of the season arrive with the next cargo. Order early: the boxes are limited.",
      "Die ersten Kesar Mangos der Saison kommen mit der nächsten Lieferung. Bestellen Sie früh: die Kisten sind begrenzt.",
    ],
    mango?.id ?? null,
    null,
  );
  announce(
    now - 5 * DAY,
    [
      "Ordering is open for the last October delivery",
      "Jetzt für die letzte Oktober-Lieferung bestellen",
    ],
    [
      "You can order until tomorrow night. Delivery in two weeks, payment after delivery as always.",
      "Sie können bis morgen Abend bestellen. Lieferung in zwei Wochen, Zahlung wie immer nach der Lieferung.",
    ],
    null,
    cargo("October, fourth week").id,
  );

  // One message is still waiting in the queue.
  const lastOrder = db.orders[db.orders.length - 1];
  const lastCustomer = lastOrder
    ? db.customers.find((entry) => entry.id === lastOrder.customer.id)
    : undefined;
  if (lastOrder && lastCustomer) {
    queueMessage(
      db,
      {
        type: "order_confirmed",
        customer: lastCustomer,
        order: lastOrder,
        outcome: "queued",
      },
      now - 60_000,
    );
  }

  return db;
}
