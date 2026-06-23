import type { FileRef } from '@/components/ai/lib/filePath';

export const OPEN_PROJECT_RIGHT_PANEL_FILE_PREVIEW_EVENT =
  'ugs:project-right-panel-open-file-preview';

export interface OpenProjectRightPanelFilePreviewEventDetail {
  ref: FileRef;
  cwd?: string;
}

export function requestProjectRightPanelFilePreview(
  detail: OpenProjectRightPanelFilePreviewEventDetail,
): boolean {
  if (typeof window === 'undefined') return false;

  const event =
    new CustomEvent<OpenProjectRightPanelFilePreviewEventDetail>(
      OPEN_PROJECT_RIGHT_PANEL_FILE_PREVIEW_EVENT,
      { cancelable: true, detail },
    );
  return !window.dispatchEvent(event);
}
