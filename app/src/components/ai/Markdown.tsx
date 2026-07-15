import {
  memo,
  useMemo,
  useRef,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { HL_LANGUAGES, HL_ALIASES } from './lib/highlight';
import { repairMarkdown, repairFences } from './lib/repairMarkdown';
import { normalizeMath } from './lib/normalizeMath';
import { protectWindowsPaths } from './lib/protectWindowsPaths';
import { convertInlineHtml } from './lib/htmlInline';
import { scanFileRefs } from './lib/fileScan';
import { parseToolLine } from './lib/toolLine';
import CodeBlock from './CodeBlock';
import InlineCode from './InlineCode';
import SmartLink from './SmartLink';
import ToolLine from './ToolLine';
import Callout from './Callout';
import { detectCallout, stripCalloutMarker } from './lib/callout';
import {
  FileChipLimitNotice,
  VisibleFileChip,
  type OpenFileFn,
} from './FileChip';
import { claimFileChipSlot, useFileChipBudget } from './lib/fileChipBudget';
import { isModelUrl } from './lib/modelLink';
import { createImagePreviewRef } from './lib/imagePreview';
import {
  highlightSearchMarks,
  type SearchHighlightState,
} from './lib/searchHighlight';

function markdownUrlTransform(url: string, key: string): string | null | undefined {
  if (
    key === 'src' &&
    /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)
  ) {
    return url;
  }
  if (
    key === 'href' &&
    /^data:audio\/(?:mpeg|mp3|wav|x-wav|aac|mp4|ogg|webm|flac);base64,/i.test(url)
  ) {
    return url;
  }
  if (
    key === 'href' &&
    /^data:video\/(?:mp4|mpeg|quicktime|webm|x-matroska|avi);base64,/i.test(url)
  ) {
    return url;
  }
  if (key === 'href' && isModelUrl(url)) return url;
  if (key === 'href' && /^data:text\/plain;base64,/i.test(url)) return url;
  return defaultUrlTransform(url);
}

/**
 * Renders one answer chunk of markdown with GFM (tables, strikethrough, task
 * lists), single-newline line breaks (remark-breaks), and syntax-highlighted
 * fenced code. Component overrides:
 *   - `pre`   -> CodeBlock chrome (language label, copy, wrap toggle)
 *   - `code`  -> inline spans become InlineCode / FileChip; block bodies pass
 *               through highlighted (react-markdown v9 wraps block code in <pre>)
 *   - `a`     -> SmartLink (external new-tab vs local file chip)
 *   - `p`     -> tool-call lines get a compact ToolLine; otherwise prose with
 *               bare file references linkified into FileChips
 *   - `li`/`td`/`th` -> bare file references linkified
 *
 * While `streaming`, the text is repaired (dangling fences/ticks closed on a
 * copy) so a half-typed token doesn't flip the whole subtree to a code block.
 * Memoized on (text, streaming) so backlog bubbles never re-parse.
 */
function MarkdownImpl({
  text,
  streaming = false,
  onOpenFile,
  cwd,
  searchState = null,
}: {
  text: string;
  streaming?: boolean;
  onOpenFile?: OpenFileFn;
  cwd?: string;
  searchState?: SearchHighlightState | null;
}) {
  const normalized = useMemo(
    () => protectWindowsPaths(convertInlineHtml(normalizeMath(text))),
    [text],
  );
  // An unbalanced ``` fence must be closed even on the final render: otherwise
  // the open fence swallows the rest of the message into one code block, which
  // `rehype-highlight` then paints as a garbled multicolor wall. While
  // streaming we additionally repair dangling inline backticks so a half-typed
  // token doesn't briefly flip the subtree to a code span.
  const src = useMemo(
    () => (streaming ? repairMarkdown(normalized) : repairFences(normalized)),
    [normalized, streaming],
  );
  const defaultModelAnimations = useMemo(
    () => extractDefaultModelAnimations(src),
    [src],
  );
  const rehypePlugins = useMemo<PluggableList>(
    () =>
      streaming
        ? [rehypeKatex]
        : [
            [
              rehypeHighlight,
              // `detect: false` (default): an info-less fence (bare ``` with no
              // language tag) must render as plain text. `hljs.highlightAuto`'s
              // heuristics are unreliable on prose/ASCII-art blocks — it has
              // mislabeled diagram fences as `python`/`yaml`, which then shows
              // a wrong language badge in CodeBlock's header. Explicit fence
              // tags (```ts, ```mermaid, ...) are unaffected by this flag.
              { languages: HL_LANGUAGES, aliases: HL_ALIASES },
            ],
            rehypeKatex,
          ],
    [streaming],
  );
  const fileChipBudget = useFileChipBudget();

  // Keep the mutable per-render inputs in a ref so the `components` object below
  // can be built once (stable identity) yet always read the latest values.
  // react-markdown uses `components[tag]` as the element *type*; if that type
  // changes identity on every streamed token, React unmounts and remounts the
  // whole subtree each token — which visibly flickers code blocks, image chips,
  // and paragraphs during streaming. Freezing the component map fixes that.
  const ctxRef = useRef({
    onOpenFile,
    cwd,
    searchState,
    fileChipBudget,
    defaultModelAnimations,
  });
  ctxRef.current = {
    onOpenFile,
    cwd,
    searchState,
    fileChipBudget,
    defaultModelAnimations,
  };

  const components = useMemo<Components>(() => {
  const isLineBreak = (child: ReactNode): boolean =>
    isValidElement(child) && child.type === 'br';

  const renderFileRef = (refData: ReturnType<typeof scanFileRefs>[number], key: number) => {
    const { onOpenFile, cwd, fileChipBudget } = ctxRef.current;
    if (typeof refData === 'string') return { node: refData, hidden: false };
    const slot = claimFileChipSlot(fileChipBudget);
    if (slot === 'notice') {
      return { node: <FileChipLimitNotice key={key} />, hidden: false };
    }
    if (slot === 'hidden') return { node: null, hidden: true };
    return {
      node: (
        <VisibleFileChip
          key={key}
          refData={refData}
          onOpenFile={onOpenFile}
          cwd={cwd}
        />
      ),
      hidden: false,
    };
  };

  const linkifyText = (
    text: string,
    key?: number,
  ): { node: ReactNode; hiddenOnly: boolean } => {
    const { searchState } = ctxRef.current;
    const parts = scanFileRefs(text);
    if (parts.length === 1 && typeof parts[0] === 'string') {
      // No file refs — apply search highlight if active, else return raw string.
      const highlighted = highlightSearchMarks(
        parts[0],
        searchState,
        key == null ? undefined : String(key),
      );
      return { node: highlighted, hiddenOnly: false };
    }

    let hasVisibleText = false;
    let hasVisibleRef = false;
    let hasHiddenRef = false;
    const nodes = parts.map((part, i) => {
      if (typeof part === 'string') {
        if (part.trim()) hasVisibleText = true;
        const highlighted = highlightSearchMarks(part, searchState, `${key}-${i}`);
        return highlighted === part
          ? part
            ? <span key={i}>{part}</span>
            : null
          : <span key={i}>{highlighted}</span>;
      }
      const rendered = renderFileRef(part, i);
      if (rendered.hidden) {
        hasHiddenRef = true;
      } else if (rendered.node) {
        hasVisibleRef = true;
      }
      return rendered.node;
    });

    const hiddenOnly = hasHiddenRef && !hasVisibleText && !hasVisibleRef;
    return {
      node: hiddenOnly ? null : key == null ? nodes : <span key={key}>{nodes}</span>,
      hiddenOnly,
    };
  };

  // Recursively walk rendered children, replacing bare file references inside
  // plain-text leaves with clickable chips. Elements (e.g. <strong>, <code>,
  // chips) pass through untouched so we never double-linkify code or links.
  const linkify = (children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      return linkifyText(children).node;
    }
    if (Array.isArray(children)) {
      const out: ReactNode[] = [];
      let skipNextBreak = false;
      children.forEach((child, i) => {
        if (skipNextBreak) {
          skipNextBreak = false;
          if (isLineBreak(child)) return;
        }
        const result = linkifyKeyed(child, i);
        if (result.hiddenOnly) {
          const last = out[out.length - 1];
          if (isLineBreak(last)) out.pop();
          skipNextBreak = true;
        }
        out.push(result.node);
      });
      return out;
    }
    return children;
  };
  const linkifyKeyed = (
    child: ReactNode,
    key: number,
  ): { node: ReactNode; hiddenOnly: boolean } => {
    if (typeof child === 'string') {
      return linkifyText(child, key);
    }
    return { node: child, hiddenOnly: false };
  };

  // Extract the plain-text content of a paragraph's children to test whether the
  // whole line is a tool-call progress line.
  const plainText = (children: ReactNode): string => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(plainText).join('');
    if (isValidElement(children)) {
      return plainText((children.props as { children?: ReactNode }).children);
    }
    return '';
  };

  // Remove the leading `[!KIND]` marker from the first text leaf of a callout's
  // children, leaving the rest of the tree intact. Stops after the first strip.
  const stripCalloutFromTree = (children: ReactNode): ReactNode => {
    const state = { done: false };
    const walk = (node: ReactNode): ReactNode => {
      if (state.done) return node;
      if (typeof node === 'string') {
        const stripped = stripCalloutMarker(node);
        if (stripped !== node) state.done = true;
        return stripped;
      }
      if (Array.isArray(node)) {
        return node.map((c, i) => {
          const out = walk(c);
          return isValidElement(out) ? out : <span key={i}>{out}</span>;
        });
      }
      if (isValidElement(node)) {
        const el = node as ReactElement<{ children?: ReactNode }>;
        return cloneElement(el, undefined, walk(el.props.children));
      }
      return node;
    };
    return walk(children);
  };

  return {
    pre: ({ node, children }) => (
      <CodeBlock node={node as never}>{children}</CodeBlock>
    ),
    code: ({ className, children, ...props }) => {
      // Block code lives inside a <pre> (handled above). rehype-highlight tags
      // it with `language-*`/`hljs`; an indented or info-less fence has neither,
      // so also treat multi-line content as a block to avoid inline pills.
      const cls = typeof className === 'string' ? className : '';
      const text = plainText(children);
      const isBlock =
        cls.includes('language-') || cls.includes('hljs') || text.includes('\n');
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <InlineCode onOpenFile={ctxRef.current.onOpenFile} cwd={ctxRef.current.cwd}>
          {children}
        </InlineCode>
      );
    },
    a: ({ href, children }) => (
      <SmartLink
        href={href}
        onOpenFile={ctxRef.current.onOpenFile}
        cwd={ctxRef.current.cwd}
        defaultModelAnimations={ctxRef.current.defaultModelAnimations}
      >
        {children as ReactNode}
      </SmartLink>
    ),
    p: ({ children }) => {
      const tool = parseToolLine(plainText(children));
      if (tool) {
        return (
          <ToolLine
            name={tool.name}
            detail={tool.detail}
            onOpenFile={ctxRef.current.onOpenFile}
            cwd={ctxRef.current.cwd}
          />
        );
      }
      return <p>{linkify(children)}</p>;
    },
    li: ({ children }) => <li>{linkify(children)}</li>,
    td: ({ children }) => <td>{linkify(children)}</td>,
    th: ({ children }) => <th>{linkify(children)}</th>,
    table: ({ children }) => (
      <div className="ai-table-wrap my-2 overflow-x-auto rounded-lg border border-border">
        <table className="ai-table w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    blockquote: ({ children }) => {
      const kind = detectCallout(plainText(children));
      if (kind) {
        return <Callout kind={kind}>{stripCalloutFromTree(children)}</Callout>;
      }
      return <blockquote>{children}</blockquote>;
    },
    img: ({ src, alt }) => {
      const image = (
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          className="ai-generated-image"
        />
      );
      const source = typeof src === 'string' ? src : '';
      const openImage = ctxRef.current.onOpenFile;
      if (!source || !openImage) return image;

      return (
        <button
          type="button"
          className="ai-generated-image-trigger"
          title="在右侧预览"
          onClick={() => void openImage(createImagePreviewRef(source, alt ?? undefined))}
        >
          {image}
        </button>
      );
    },
  };
  // Empty deps: the map reads all mutable inputs via ctxRef, so it stays a
  // stable identity across streamed tokens and never remounts subtrees.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ai-markdown ai-stream-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}

const Markdown = memo(MarkdownImpl);
export default Markdown;

function extractDefaultModelAnimations(text: string): string[] {
  if (!text.includes('骨骼')) return [];
  const match = /骨骼：[^。\n]*?请求骨骼绑定和\s+(.+?)\s+预览动画/u.exec(text);
  if (!match) return [];
  return match[1]
    .split(/[、,，/]+/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 6);
}
