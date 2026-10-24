"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  useWatch,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { Field, fieldMessage, useControlProps } from "@/components/form/form";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { MarkdownText } from "@/features/legal/markdown";
import { Segmented } from "@/features/legal/segmented";

/** Puts a text at the cursor of the editor; set by the editor while it is mounted. */
export type Inserter = (text: string) => void;

function Wired({
  children,
}: {
  children: (props: ReturnType<typeof useControlProps>) => ReactNode;
}) {
  return <>{children(useControlProps())}</>;
}

/**
 * The text of an article in one language: a Markdown textarea with a
 * preview rendered as the shop renders it (the renderer of the legal
 * texts). Pictures are put in at the cursor through `insertRef`.
 */
export function MarkdownEditor<T extends FieldValues>({
  form,
  name,
  label,
  lang,
  hint,
  required,
  optional,
  rows = 22,
  insertRef,
  disabled,
}: {
  form: UseFormReturn<T, unknown, FieldValues>;
  name: FieldPath<T>;
  label: ReactNode;
  lang: string;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  rows?: number;
  insertRef?: MutableRefObject<Inserter | null>;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const text = useWatch({ control: form.control, name }) as string | undefined;
  const registered = form.register(name);

  // The inserter is handed out after the render, as a ref should be.
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (snippet) => {
      const node = textarea.current;
      const current = (form.getValues(name) as string | undefined) ?? "";
      const start = node?.selectionStart ?? current.length;
      const end = node?.selectionEnd ?? current.length;
      // On a line of its own, as a picture in Markdown should be.
      const before = current.slice(0, start);
      const after = current.slice(end);
      const lead =
        before === "" || before.endsWith("\n\n")
          ? ""
          : before.endsWith("\n")
            ? "\n"
            : "\n\n";
      const trail = after === "" || after.startsWith("\n") ? "\n" : "\n\n";
      const next = `${before}${lead}${snippet}${trail}${after}`;
      form.setValue(name, next as never, {
        shouldDirty: true,
        shouldTouch: true,
      });
      setMode("write");
      requestAnimationFrame(() => {
        const at = before.length + lead.length + snippet.length;
        node?.focus();
        node?.setSelectionRange(at, at);
      });
    };
    return () => {
      insertRef.current = null;
    };
  }, [insertRef, form, name]);

  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      error={fieldMessage(form, name)}
      aside={
        <Segmented
          label="Write or preview"
          value={mode}
          options={[
            { value: "write", label: "Write" },
            { value: "preview", label: "Preview" },
          ]}
          onChange={setMode}
        />
      }
    >
      <Wired>
        {(control) => (
          <>
            <Textarea
              {...control}
              {...registered}
              ref={(node) => {
                registered.ref(node);
                textarea.current = node;
              }}
              lang={lang}
              rows={rows}
              disabled={disabled}
              spellCheck
              className={cn(
                "font-mono text-13",
                mode === "preview" && "hidden",
              )}
            />
            {mode === "preview" ? (
              <div className="min-h-40 rounded-md border border-line bg-surface px-4 py-3">
                {text?.trim() ? (
                  <MarkdownText lang={lang}>{text}</MarkdownText>
                ) : (
                  <p className="py-6 text-center text-13 text-ink-subtle">
                    Nothing written yet.
                  </p>
                )}
              </div>
            ) : null}
          </>
        )}
      </Wired>
    </Field>
  );
}
