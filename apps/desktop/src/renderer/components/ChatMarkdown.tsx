import { type ReactNode } from 'react';

function renderInline(source: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let i = 0;
  let n = 0;
  const flush = () => {
    if (!buf) return;
    out.push(buf);
    buf = '';
  };

  while (i < source.length) {
    if (source.startsWith('`', i)) {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          <code key={`${key}-c-${n++}`} className="rounded bg-surface-3 px-1 font-mono text-[0.85em]">
            {source.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    if (source.startsWith('**', i) || source.startsWith('__', i)) {
      const mark = source.slice(i, i + 2);
      const end = source.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push(
          <strong key={`${key}-b-${n++}`} className="font-medium">
            {source.slice(i + 2, end)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }
    if (source[i] === '*' && source[i + 1] !== '*' && source[i + 1] !== ' ') {
      const end = source.indexOf(source[i], i + 1);
      if (end > i + 1) {
        flush();
        out.push(<em key={`${key}-i-${n++}`}>{source.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(source.slice(i));
    if (link) {
      flush();
      out.push(
        <span key={`${key}-a-${n++}`} className="text-accent" title={link[2]}>
          {link[1]}
        </span>
      );
      i += link[0].length;
      continue;
    }
    buf += source[i];
    i += 1;
  }
  flush();
  return out;
}

function renderPlain(chunk: string, key: string): ReactNode[] {
  const lines = chunk.replace(/^\n+|\n+$/g, '').split('\n');
  const nodes: ReactNode[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ');
    para = [];
    if (!text.trim()) return;
    const id = `${key}-p-${nodes.length}`;
    nodes.push(<p key={id}>{renderInline(text, id)}</p>);
  };
  const flushList = () => {
    if (!list) return;
    const current = list;
    list = null;
    const id = `${key}-l-${nodes.length}`;
    const items = current.items.map((item, index) => (
      <li key={index}>{renderInline(item, `${id}-${index}`)}</li>
    ));
    nodes.push(
      current.kind === 'ol'
        ? <ol key={id} className="list-decimal space-y-1 pl-4">{items}</ol>
        : <ul key={id} className="list-disc space-y-1 pl-4">{items}</ul>
    );
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      const id = `${key}-h-${nodes.length}`;
      nodes.push(<p key={id} className="font-medium">{renderInline(heading[2], id)}</p>);
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return nodes;
}

export function ChatMarkdown({ text, className = '' }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(fence)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(...renderPlain(text.slice(last, start), `m-${index}`));
    index += 1;
    nodes.push(
      <pre
        key={`code-${index}`}
        className="overflow-auto whitespace-pre rounded-lg border border-edge bg-surface-2 px-2 py-1.5 font-mono text-xs"
      >
        {match[1].replace(/\n$/, '')}
      </pre>
    );
    last = start + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...renderPlain(text.slice(last), `m-${index}`));
  if (nodes.length === 0) return null;
  return <div className={`space-y-2 text-sm leading-5 text-fg ${className}`}>{nodes}</div>;
}
