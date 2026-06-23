import { createContext, useContext } from 'react';

export const MESSAGE_FILE_CHIP_LIMIT = 12;

export type FileChipSlot = 'visible' | 'notice' | 'hidden';

export interface FileChipBudget {
  limit: number;
  nextSlot: number;
  noticeShown: boolean;
  slots: Map<symbol, FileChipSlot>;
}

export const FileChipBudgetContext = createContext<FileChipBudget | null>(null);

export function createFileChipBudget(
  limit = MESSAGE_FILE_CHIP_LIMIT,
): FileChipBudget {
  return {
    limit: Math.max(0, limit),
    nextSlot: 0,
    noticeShown: false,
    slots: new Map(),
  };
}

export function useFileChipBudget(): FileChipBudget | null {
  return useContext(FileChipBudgetContext);
}

export function claimFileChipSlot(budget: FileChipBudget | null): FileChipSlot {
  if (!budget) return 'visible';

  if (budget.nextSlot < budget.limit) {
    budget.nextSlot += 1;
    return 'visible';
  }

  if (!budget.noticeShown) {
    budget.noticeShown = true;
    return 'notice';
  }

  return 'hidden';
}
