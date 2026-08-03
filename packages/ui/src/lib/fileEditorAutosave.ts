export type FileEditorAutosaveGate = {
  readonly autoSaveEnabled: boolean;
  readonly isDirty: boolean;
  readonly canWrite: boolean;
  readonly isSaving: boolean;
  readonly fileLoading: boolean;
  readonly selectedFilePath: string | null | undefined;
  readonly loadedFilePath: string | null;
  readonly isNonEditableBinary: boolean;
};

export const shouldScheduleFileAutosave = (gate: FileEditorAutosaveGate): boolean => {
  if (!gate.autoSaveEnabled || !gate.isDirty || !gate.canWrite || gate.isSaving) {
    return false;
  }
  if (gate.fileLoading || gate.isNonEditableBinary) {
    return false;
  }
  return Boolean(gate.selectedFilePath && gate.loadedFilePath === gate.selectedFilePath);
};

export type FileEditorSaveDraftGate = {
  readonly selectedFilePath: string | null | undefined;
  readonly loadedFilePath: string | null;
  readonly fileLoading: boolean;
  readonly isDirty: boolean;
  readonly isNonEditableBinary: boolean;
};

export const shouldAllowFileDraftSave = (gate: FileEditorSaveDraftGate): boolean => {
  if (!gate.selectedFilePath) {
    return false;
  }
  if (!gate.isDirty) {
    return true;
  }
  return !gate.fileLoading
    && gate.loadedFilePath === gate.selectedFilePath
    && !gate.isNonEditableBinary;
};
