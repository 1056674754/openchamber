export { MultiRunLauncher } from './MultiRunLauncher';
// The composer parallel mode imports the rest directly:
// ModelMultiSelect/ModelEffortMenu (chips + thinking effort), BranchSelector
// (launch settings) — upstream removed the launcher and these barrel exports
// with it; the fork keeps the launcher mounted until its MainLayout surface
// batch lands.
export { ModelMultiSelect, generateInstanceId, type ModelSelectionWithId, type ModelMultiSelectProps } from './ModelMultiSelect';
export { BranchSelector, useBranchOptions, type BranchSelectorProps, type BranchSelectorState, type WorktreeBaseOption } from './BranchSelector';
export { AgentSelector, type AgentSelectorProps } from './AgentSelector';
