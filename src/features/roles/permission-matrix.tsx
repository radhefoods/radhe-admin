"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Alert } from "@/components/ui/surface";
import { WILDCARD } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/status";
import {
  MATRIX_ACTIONS,
  cellState,
  expandWildcard,
  manageWithoutRead,
  setColumn,
  setPermission,
  type Catalogue,
  type MatrixAction,
  type MatrixState,
} from "./matrix";

const COLUMN_LABEL: Record<MatrixAction, string> = {
  read: "Read",
  manage: "Manage",
};

/**
 * The permissions of a role as a matrix: one row per resource, a column
 * for reading and one for changing. The two are independent, and a
 * wildcard the role contains is shown as what it is.
 */
export function PermissionMatrix({
  state,
  catalogue,
  onChange,
  readOnly = false,
}: {
  state: MatrixState;
  catalogue: Catalogue;
  onChange: (state: MatrixState) => void;
  /** The system role, or an admin who may not manage roles. */
  readOnly?: boolean;
}) {
  const id = useId();
  const blind = manageWithoutRead(state, catalogue);

  function columnState(action: MatrixAction): boolean | "indeterminate" {
    const cells = catalogue.rows
      .map((row) => row[action])
      .filter((permission): permission is string => permission !== null)
      .map((permission) => cellState(state, permission).checked);
    if (cells.length > 0 && cells.every(Boolean)) return true;
    return cells.some(Boolean) ? "indeterminate" : false;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.all ? (
        <Alert
          tone="info"
          title="This role contains the wildcard *"
          actions={
            readOnly ? null : (
              <Button
                size="sm"
                onClick={() =>
                  onChange(expandWildcard(state, catalogue, WILDCARD))
                }
              >
                Replace * with single permissions
              </Button>
            )
          }
        >
          It grants everything, including permissions the API adds later.
          {readOnly ? "" : " The wildcard is kept when the role is saved."}
        </Alert>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Permissions of the role, by resource
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-line bg-sunken px-3.5 py-2 text-left text-xs font-semibold text-ink-muted"
              >
                Area
              </th>
              {MATRIX_ACTIONS.map((action) => (
                <th
                  key={action}
                  scope="col"
                  className="w-24 border-b border-line bg-sunken px-3.5 py-2 text-xs font-semibold text-ink-muted"
                >
                  <span className="flex items-center justify-center gap-2">
                    {readOnly ? null : (
                      <Checkbox
                        aria-label={`${COLUMN_LABEL[action]} for every area`}
                        checked={columnState(action)}
                        disabled={state.all}
                        onCheckedChange={(checked) =>
                          onChange(
                            setColumn(
                              state,
                              catalogue,
                              action,
                              checked === true,
                            ),
                          )
                        }
                      />
                    )}
                    {COLUMN_LABEL[action]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalogue.rows.map((row) => {
              const wildcard = state.wildcards.includes(row.resource)
                ? `${row.resource}.*`
                : null;
              const isBlind = blind.includes(row);
              return (
                <tr key={row.resource} className="[&:last-child>*]:border-b-0">
                  <th
                    scope="row"
                    className="border-b border-line px-3.5 py-2.5 text-left font-normal"
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        id={`${id}-${row.resource}`}
                        className="font-medium text-ink"
                      >
                        {row.label}
                      </span>
                      {wildcard ? (
                        <Badge tone="planned" dot={false} className="font-mono">
                          {wildcard}
                        </Badge>
                      ) : null}
                      {isBlind ? (
                        <Badge tone="attention">Manage without read</Badge>
                      ) : null}
                    </span>
                    {row.covers ? (
                      <span className="block text-13 text-ink-muted">
                        {row.covers}
                      </span>
                    ) : (
                      <span className="block font-mono text-xs text-ink-subtle">
                        {row.resource}
                      </span>
                    )}
                    {wildcard ? (
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-13 text-ink-muted">
                        Everything in this area, also what is added later.
                        {readOnly ? null : (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() =>
                              onChange(
                                expandWildcard(state, catalogue, wildcard),
                              )
                            }
                          >
                            Replace with single permissions
                          </Button>
                        )}
                      </span>
                    ) : null}
                    {isBlind ? (
                      <span className="mt-1 block text-13 text-attention-fg">
                        The pages of this area need read: with manage alone they
                        do not open.
                      </span>
                    ) : null}
                  </th>
                  {MATRIX_ACTIONS.map((action) => {
                    const permission = row[action];
                    if (!permission) {
                      return (
                        <td
                          key={action}
                          className="border-b border-line px-3.5 py-2.5 text-center text-ink-subtle"
                        >
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">
                            Not offered by the API
                          </span>
                        </td>
                      );
                    }
                    const cell = cellState(state, permission);
                    return (
                      <td
                        key={action}
                        className="border-b border-line px-3.5 py-2.5 text-center"
                      >
                        <span className="flex justify-center">
                          <Checkbox
                            aria-label={`${row.label}: ${action}`}
                            aria-describedby={`${id}-${row.resource}`}
                            checked={cell.checked}
                            disabled={readOnly || cell.lockedBy !== null}
                            title={
                              cell.lockedBy
                                ? `Granted by ${cell.lockedBy}`
                                : undefined
                            }
                            onCheckedChange={(checked) =>
                              onChange(
                                setPermission(
                                  state,
                                  permission,
                                  checked === true,
                                ),
                              )
                            }
                            className={cn(readOnly && "disabled:opacity-100")}
                          />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {catalogue.other.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="float-left text-13 font-medium text-ink">
            More permissions
          </legend>
          {catalogue.other.map((permission) => {
            const cell = cellState(state, permission);
            const checkboxId = `${id}-other-${permission}`;
            return (
              <div key={permission} className="flex items-center gap-2.5">
                <Checkbox
                  id={checkboxId}
                  checked={cell.checked}
                  disabled={readOnly || cell.lockedBy !== null}
                  onCheckedChange={(checked) =>
                    onChange(setPermission(state, permission, checked === true))
                  }
                />
                <label htmlFor={checkboxId} className="text-sm text-ink">
                  {humanize(permission.replace(".", ": "))}{" "}
                  <span className="font-mono text-xs text-ink-subtle">
                    {permission}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {state.unknown.length > 0 ? (
        <Alert tone="info" title="Permissions the API does not list">
          <span className="font-mono text-13">{state.unknown.join(", ")}</span>.
          They are kept as they are when the role is saved.
        </Alert>
      ) : null}

      {blind.length > 0 ? (
        <Alert tone="warning" title="Manage without read">
          {blind.map((row) => row.label).join(", ")}: read and manage are
          separate permissions. An admin with this role could change things
          there, but the pages need read to open. Tick read as well.
        </Alert>
      ) : null}
    </div>
  );
}
