import { hasPermission } from '@socialhub/shared';
import { createContext, useContext, useMemo } from 'react';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ workspace, children }) {
  const value = useMemo(
    () => ({
      workspace,
      membership: workspace.membership,
      role: workspace.membership.role,
      /** UI gating only — the API enforces every permission independently. */
      can: (permission) => hasPermission(workspace.membership.role, permission),
    }),
    [workspace],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside a workspace route');
  return ctx;
}

export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}
