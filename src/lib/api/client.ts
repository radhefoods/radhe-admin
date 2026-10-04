import { env } from "@/config/env";
import { createAdminApi } from "./admin-api";
import { createSessionTransport } from "./session";

/** The one session of this browser tab. */
export const session = createSessionTransport({ baseUrl: env.apiUrl });

/** Every endpoint of the admin API, typed. */
export const api = createAdminApi(session);
