import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { twMerge } from "@/utils";

import { Code } from "./Code";
import { ExternalLink, isLeavable } from "./ExternalLink";
import { Table } from "./Table";

interface MarkdownViewProps {
  text: string;
  /** The directory a relative image path is resolved against. */
  root: string | null;
  /** The base URL for relative links. Without it, a relative link renders as plain text. */
  linkBase?: string;
  className?: string;
}

/**
 * A Markdown document as it will be read, rather than as it is written.
 *
 * Raw HTML is not rendered, which is `react-markdown`'s own default and the
 * reason it is left alone: a readme arrives from a git import or a packaged
 * mod as readily as from the project's own author, and this webview runs with
 * the app's privileges.
 */
export function MarkdownView({ text, root, linkBase, className }: MarkdownViewProps) {
  const components = useMemo(() => renderers(root, linkBase), [root, linkBase]);

  return (
    <div className={twMerge("min-w-0 text-row text-surface-300", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

function renderers(root: string | null, linkBase: string | undefined): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mt-5 mb-2 text-lg font-medium text-surface-100 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-5 mb-2 text-base font-medium text-surface-100 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-4 mb-1.5 font-medium text-surface-200 first:mt-0">{children}</h3>
    ),
    p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="mb-2 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
    ol: ({ children }) => (
      <ol className="mb-2 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-surface-600 pl-3 text-surface-400">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-surface-700" />,
    table: ({ children }) => (
      <div className="mb-3 overflow-x-auto scrollbar-md">
        <Table.Root className="border-collapse text-meta">{children}</Table.Root>
      </div>
    ),
    thead: ({ children }) => <Table.Header>{children}</Table.Header>,
    tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
    tr: ({ children }) => <Table.Row>{children}</Table.Row>,
    th: ({ children }) => (
      <Table.Head className="border border-surface-700 bg-transparent px-2 py-1 text-left text-meta font-medium text-surface-200">
        {children}
      </Table.Head>
    ),
    td: ({ children }) => (
      <Table.Cell className="border border-surface-700 px-2 py-1 align-middle">
        {children}
      </Table.Cell>
    ),
    /* DS-CODE-CHIP for the inline case. A block is the row it is, so it keeps
       plain mono on an inset rather than a chip per line. */
    code: ({ children, className: language }) => {
      if (language) return <code className="font-mono text-code">{children}</code>;
      return <Code>{children}</Code>;
    },
    pre: ({ children }) => (
      <pre className="mb-3 overflow-x-auto rounded-lg bg-surface-950/40 p-3 scrollbar-md">
        {children}
      </pre>
    ),
    img: ({ src, alt }) => {
      const resolved = typeof src === "string" ? relativeImage(src, root) : null;
      if (!resolved) return <span className="text-meta text-surface-500">{alt ?? ""}</span>;
      return <img src={resolved} alt={alt ?? ""} className="mb-2 max-w-full rounded-md" />;
    },
    /* react-markdown keeps a relative href as written. Without `linkBase` it has no
       target, so only an href the system can open renders as a link. */
    a: ({ href, children }) => {
      const resolved = href && linkBase ? resolveLink(href, linkBase) : href;
      if (!resolved || !isLeavable(resolved)) return <span>{children}</span>;
      return <ExternalLink href={resolved}>{children}</ExternalLink>;
    },
  };
}

/**
 * `src` as something the webview can load, or null where it must not.
 *
 * Only a file under `root` loads. A remote URL would tell its host that the
 * document was opened, which is a request the reader never made, and a path
 * climbing out of the root is not the root's to show.
 */
function relativeImage(src: string, root: string | null): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  if (!root) return null;

  const parts = src.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) return null;

  return convertFileSrc(`${root}/${parts.join("/")}`);
}

/** `href` resolved against `base`, or `href` unchanged when the two form no valid URL. */
function resolveLink(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}
