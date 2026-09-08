import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChangelogContentProps {
  body: string | undefined;
}

const components: Components = {
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-sm font-semibold tracking-wide text-accent-300 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-medium text-surface-300 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="mb-3 flex flex-col gap-0.5 pl-1">{children}</ul>,
  li: ({ children }) => (
    <li className="flex gap-2 text-sm text-surface-300">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500/50" />
      <span>{children}</span>
    </li>
  ),
  p: ({ children }) => <p className="mb-2 text-sm text-surface-400">{children}</p>,
};

export function ChangelogContent({ body }: ChangelogContentProps) {
  if (!body?.trim()) {
    return <p className="py-4 text-center text-sm text-surface-500">No release notes available.</p>;
  }

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {body}
    </Markdown>
  );
}
