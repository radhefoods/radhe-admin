import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

// Links open in a new tab: the preview never leaves the page being edited.
const components: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

/**
 * A legal text as customers read it: Markdown with tables and lists
 * (GitHub flavour). Raw HTML in the text is dropped (`skipHtml`), so
 * nothing that was pasted can ever run in the panel.
 */
export function MarkdownText({
  children,
  lang,
  className,
}: {
  children: string;
  lang?: string;
  className?: string;
}) {
  return (
    <div
      lang={lang}
      className={cn(
        "flex min-w-0 flex-col gap-3 text-sm leading-relaxed break-words text-ink",
        "[&_h1]:font-display [&_h1]:text-2xl [&_h1]:leading-tight",
        "[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_h4]:text-sm [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
        "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5",
        "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5",
        "[&_a]:font-medium [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted",
        "[&_code]:rounded-xs [&_code]:bg-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-13",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-sunken [&_pre]:p-3 [&_pre_code]:p-0",
        "[&_hr]:border-0 [&_hr]:border-t [&_hr]:border-line",
        "[&_table]:w-full [&_table]:border-collapse [&_table]:text-13",
        "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
        "[&_th]:border [&_th]:border-line [&_th]:bg-sunken [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
        "[&_img]:max-w-full [&_input]:mr-1.5",
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </Markdown>
    </div>
  );
}
