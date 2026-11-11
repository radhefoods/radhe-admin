// The rows of a table inside a form (the pack sizes of a product, the SKUs
// of a wholesale product) when the record changes underneath: another
// admin or an import adds or removes a row, a stock count moves.

/** A row as text, whatever the order of its keys; `undefined` is left out. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : entry,
  );
}

/**
 * The rows the form shows after its record changed underneath.
 *
 * A row is matched by its id, never by its place: the list may have grown
 * or shrunk meanwhile, and a price typed for one pack size must not land on
 * the one that now stands where it stood. A row that was changed here stays
 * as it was typed; a row nobody touched takes the record's new values; a
 * row that is not saved yet (no id) stays at the end; a row the record no
 * longer has is gone.
 */
export function followRows<R>(input: {
  /** The rows as they stand in the form. */
  typed: readonly R[];
  /** The rows as the record showed them before the change. */
  previous: readonly R[];
  /** The rows of the record as it is now. */
  next: readonly R[];
  /** The id of a row; `""` for one that is not saved yet. */
  idOf: (row: R) => string;
}): R[] {
  const { typed, previous, next, idOf } = input;
  const shown = new Map(previous.map((row) => [idOf(row), stable(row)]));
  const changed = new Map<string, R>();
  const unsaved: R[] = [];
  for (const row of typed) {
    const id = idOf(row);
    if (id === "") unsaved.push(row);
    else if (shown.has(id) && shown.get(id) !== stable(row)) {
      changed.set(id, row);
    }
  }
  return [...next.map((row) => changed.get(idOf(row)) ?? row), ...unsaved];
}
