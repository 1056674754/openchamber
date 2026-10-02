import { describe, expect, test } from 'bun:test';

import { shouldAllowFileDraftSave, shouldScheduleFileAutosave } from './fileEditorAutosave';

const readyAutosave = {
  autoSaveEnabled: true,
  isDirty: true,
  canWrite: true,
  isSaving: false,
  fileLoading: false,
  selectedFilePath: '/repo/a.txt',
  loadedFilePath: '/repo/a.txt',
  isNonEditableBinary: false,
  wouldEmptyFile: false,
};

const readySave = {
  selectedFilePath: '/repo/a.txt',
  loadedFilePath: '/repo/a.txt',
  fileLoading: false,
  isDirty: true,
  isNonEditableBinary: false,
};

describe('file editor autosave gates', () => {
  test('schedules only after the selected text file is fully loaded', () => {
    expect(shouldScheduleFileAutosave(readyAutosave)).toBe(true);
    expect(shouldScheduleFileAutosave({ ...readyAutosave, fileLoading: true })).toBe(false);
    expect(shouldScheduleFileAutosave({ ...readyAutosave, loadedFilePath: null })).toBe(false);
    expect(shouldScheduleFileAutosave({ ...readyAutosave, loadedFilePath: '/repo/other.txt' })).toBe(false);
  });

  test('never schedules binary or non-writable files', () => {
    expect(shouldScheduleFileAutosave({ ...readyAutosave, isNonEditableBinary: true })).toBe(false);
    expect(shouldScheduleFileAutosave({ ...readyAutosave, canWrite: false })).toBe(false);
    expect(shouldScheduleFileAutosave({ ...readyAutosave, autoSaveEnabled: false })).toBe(false);
  });

  test('never empties a non-empty file on its own', () => {
    expect(shouldScheduleFileAutosave({ ...readyAutosave, wouldEmptyFile: true })).toBe(false);
  });

  test('allows only fully loaded dirty text drafts and treats clean drafts as success', () => {
    expect(shouldAllowFileDraftSave(readySave)).toBe(true);
    expect(shouldAllowFileDraftSave({ ...readySave, isDirty: false })).toBe(true);
    expect(shouldAllowFileDraftSave({ ...readySave, fileLoading: true })).toBe(false);
    expect(shouldAllowFileDraftSave({ ...readySave, loadedFilePath: null })).toBe(false);
    expect(shouldAllowFileDraftSave({ ...readySave, isNonEditableBinary: true })).toBe(false);
  });
});
