import { scanFileRefs } from './lib/fileScan';
import FileChip, { type OpenFileFn } from './FileChip';
import {
  highlightSearchMarks,
  type SearchHighlightState,
} from './lib/searchHighlight';

export default function FileText({
  text,
  onOpenFile,
  cwd,
  searchState = null,
}: {
  text: string;
  onOpenFile?: OpenFileFn;
  cwd?: string;
  searchState?: SearchHighlightState | null;
}) {
  // Reset the per-message hit counter so user-message matches start at index 0.
  if (searchState) searchState.hitCounter.current = 0;

  const parts = scanFileRefs(text);
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return highlightSearchMarks(parts[0], searchState);
  }

  return parts.map((part, index) =>
    typeof part === 'string' ? (
      <span key={index}>{highlightSearchMarks(part, searchState, String(index))}</span>
    ) : (
      <FileChip key={index} refData={part} onOpenFile={onOpenFile} cwd={cwd} />
    ),
  );
}
