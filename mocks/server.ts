// A stand-in for the Radhe Foods API (radhe-api), for development and tests.
// It answers the admin endpoints in the shapes and with the error codes of
// doc/ADMIN_API_DOCUMENTATION.md, from demo data kept in memory.
//
//   npm run dev:mock        starts it on http://localhost:3000
//
// Sign in with owner@radhefoods.de / radhe-owner-2026 and the code 000000
// (a real authenticator code works as well). More sign-ins: mocks/seed.ts.
//
// Environment:
//   MOCK_API_PORT   the port (default 3000)
//   MOCK_DELAY_MS   how long every answer waits, to see loading states (default 150)
//   MOCK_STRIPE     "on": Stripe counts as connected (default off, as in section 19)
//   MOCK_WHATSAPP   "on": WhatsApp counts as configured (default off)
//
// Run with Node 24 or newer (it reads TypeScript directly); no build step.

import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { createMockApi } from "./app.ts";
import { DEMO_ADMINS } from "./seed.ts";

const port = Number(process.env.MOCK_API_PORT ?? 3000);
const delay = Number(process.env.MOCK_DELAY_MS ?? 150);
const publicUrl = `http://localhost:${port}`;

const api = createMockApi({
  publicUrl,
  stripe: process.env.MOCK_STRIPE === "on",
  whatsapp: process.env.MOCK_WHATSAPP === "on",
});

function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value))
      for (const entry of value) headers.append(name, entry);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(`${publicUrl}${incoming.url ?? "/"}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(incoming) as ReadableStream) : undefined,
    // Node needs this to stream a request body.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

const server = createServer(async (incoming, outgoing) => {
  const started = Date.now();
  const response = await api.handle(toRequest(incoming));
  const isApi = (incoming.url ?? "").startsWith("/v1/");
  if (isApi && delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
  if (isApi && incoming.method !== "OPTIONS") {
    console.log(
      `${incoming.method} ${incoming.url} ${response.status} ${Date.now() - started}ms`,
    );
  }
});

// The scheduled jobs of the API: the checkout cleanup (section 16).
setInterval(() => api.runJobs(), 10 * 60_000).unref();

server.listen(port, () => {
  console.log(`Radhe Foods mock admin API on ${publicUrl}`);
  console.log(
    `Sign in: ${DEMO_ADMINS.owner.email} / ${DEMO_ADMINS.owner.password}, code 000000`,
  );
});
