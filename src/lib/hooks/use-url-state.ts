"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

// Lists live in the address: search, filters, sort and page are query
// parameters, so a filtered list can be bookmarked, shared and reached
// again with the back button. Whatever stands in the address is checked
// against what the API accepts before it is sent on.

export interface Param<T> {
  parse: (raw: string | null) => T;
  serialize: (value: T) => string | null;
}

const OBJECT_ID = /^[0-9a-f]{24}$/;

export const param = {
  /** One of the API's values, or `undefined`. */
  oneOf: <T extends string>(values: readonly T[]): Param<T | undefined> => ({
    parse: (raw) =>
      raw !== null && (values as readonly string[]).includes(raw)
        ? (raw as T)
        : undefined,
    serialize: (value) => value ?? null,
  }),
  /** One of the API's values, with a default that is left out of the address. */
  oneOfOr: <T extends string>(values: readonly T[], fallback: T): Param<T> => ({
    parse: (raw) =>
      raw !== null && (values as readonly string[]).includes(raw)
        ? (raw as T)
        : fallback,
    serialize: (value) => (value === fallback ? null : value),
  }),
  id: (): Param<string | undefined> => ({
    parse: (raw) => (raw !== null && OBJECT_ID.test(raw) ? raw : undefined),
    serialize: (value) => value ?? null,
  }),
  /** Free text, trimmed and cut to what the API accepts. */
  text: (maxLength = 80): Param<string> => ({
    parse: (raw) => (raw ?? "").trim().slice(0, maxLength),
    serialize: (value) => value.trim() || null,
  }),
  /** `true`, `false`, or not set. */
  flag: (): Param<boolean | undefined> => ({
    parse: (raw) =>
      raw === "true" ? true : raw === "false" ? false : undefined,
    serialize: (value) => (value === undefined ? null : String(value)),
  }),
  page: (): Param<number> => ({
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 1 && value <= 500 ? value : 1;
    },
    serialize: (value) => (value > 1 ? String(value) : null),
  }),
};

// A parameter both reads and writes its type, so a set of parameters of
// different types has no common supertype but `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, Param<any>>;

type Values<P extends Params> = {
  [K in keyof P]: P[K] extends Param<infer T> ? T : never;
};

/**
 * The state of a list, read from and written to the address. Changing a
 * filter goes back to page one; `page` itself can be set with it.
 */
export function useUrlState<P extends Params>(
  params: P,
): [Values<P>, (changes: Partial<Values<P>>) => void, () => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const values = useMemo(() => {
    const result: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(params)) {
      result[key] = definition.parse(search.get(key));
    }
    return result as Values<P>;
    // The definitions are constant; the address is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const set = useCallback(
    (changes: Partial<Values<P>>) => {
      const next = new URLSearchParams(search.toString());
      if (!("page" in changes)) next.delete("page");
      for (const [key, value] of Object.entries(changes)) {
        const definition = params[key];
        if (!definition) continue;
        const serialized = definition.serialize(value);
        if (serialized === null) next.delete(key);
        else next.set(key, serialized);
      }
      const query = next.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}` as Route, {
        scroll: false,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, search],
  );

  const clear = useCallback(() => {
    router.replace(pathname as Route, { scroll: false });
  }, [router, pathname]);

  return [values, set, clear];
}
