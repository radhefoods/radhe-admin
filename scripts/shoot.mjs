// Takes a screenshot of the running panel, for looking at a page while
// building it. Needs the dev server (npm run dev) and the mock API
// (npm run dev:mock).
//
//   node scripts/shoot.mjs <name> <path> [options]
//
//   <path>            the address without the leading slash; "root" for the start page
//   --full            the whole page, not only the window
//   --dark            the dark theme
//   --phone           390 px wide
//   --user <who>      owner (default), orders, viewer, or none (stay signed out)
//   --wait <ms>       wait before the picture (a route's first load compiles: use 8000)
//   --click "<name>"  click a button, link, menu item or tab by its name; repeatable
//   --fill "<label>=<text>"  type into a field by its label; repeatable, runs in order with --click
//
// The picture lands in test-results/shots/<name>.png.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const USERS = {
  owner: ["owner@radhefoods.de", "radhe-owner-2026"],
  orders: ["orders@radhefoods.de", "radhe-orders-2026"],
  viewer: ["viewer@radhefoods.de", "radhe-viewer-2026"],
};

const args = process.argv.slice(2);
const [name, rawPath = "root"] = args;
if (!name) {
  console.error("Usage: node scripts/shoot.mjs <name> <path> [options]");
  process.exit(1);
}
const flag = (key) => args.includes(key);
const value = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const target = rawPath === "root" ? "/" : `/${rawPath.replace(/^\/+/, "")}`;
const directory = path.join(process.cwd(), "test-results", "shots");
mkdirSync(directory, { recursive: true });
const out = path.join(directory, `${name}.png`);
const base = process.env.PANEL_URL ?? "http://localhost:3002";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: flag("--phone")
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    deviceScaleFactor: flag("--phone") ? 2 : 1,
    colorScheme: flag("--dark") ? "dark" : "light",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) =>
    errors.push(`PAGEERROR ${String(error).slice(0, 300)}`),
  );

  const user = value("--user", "owner");
  if (user !== "none") {
    const [email, password] = USERS[user];
    await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Authenticator code").fill("000000");
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 20000,
    });
  }
  await page.goto(`${base}${target}`, { waitUntil: "networkidle" });

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--click") {
      const text = args[index + 1];
      const byRole = page
        .getByRole("button", { name: text })
        .or(page.getByRole("link", { name: text }))
        .or(page.getByRole("menuitem", { name: text }))
        .or(page.getByRole("tab", { name: text }));
      const found =
        (await byRole.count()) > 0
          ? byRole.first()
          : page.getByText(text).first();
      await found.click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(500);
    }
    if (args[index] === "--fill") {
      const [label, ...rest] = args[index + 1].split("=");
      await page.getByLabel(label).first().fill(rest.join("="));
      await page.waitForTimeout(200);
    }
  }

  await page.waitForTimeout(Number(value("--wait", "500")));
  await page.screenshot({ path: out, fullPage: flag("--full") });
  // A 401 on the first `me` call is the signed-out state, not a fault.
  const real = [...new Set(errors)].filter((text) => !text.includes("401"));
  if (real.length > 0) console.log(`CONSOLE ERRORS:\n${real.join("\n")}`);
  console.log("saved", out, "| url", page.url());
} finally {
  await browser.close();
}
