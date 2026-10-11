export const COMMUNITY_WORKSPACES = [
  "ADMINISTRATION",
  "ACCOUNTING",
  "PURCHASES",
  "OWNER_SERVICE",
  "COLLECTIONS",
  "CONTROL_PRINCIPAL",
  "WRISTBANDS",
  "BOARD",
] as const;

export type CommunityWorkspaceCode = (typeof COMMUNITY_WORKSPACES)[number];

export const COMMUNITY_WORKSPACE_SET = new Set<string>(COMMUNITY_WORKSPACES);

/**
 * TREASURY was the former workspace name. Treasury remains a permissioned
 * module, but it now belongs to the ACCOUNTING workspace.
 */
export const LEGACY_WORKSPACE_ALIASES: Record<string, CommunityWorkspaceCode> =
  {
    TREASURY: "ACCOUNTING",
  };

export function normalizeCommunityWorkspaceCode(value: string) {
  const code = value.trim().toUpperCase();
  return LEGACY_WORKSPACE_ALIASES[code] ?? code;
}

/**
 * Returns the currently assigned workspace codes in a stable, normalized
 * form. Assignment status and validity dates are intentionally evaluated by
 * the Prisma query that loads the access; this helper only interprets the
 * assignment records and is independent of the worker's role.
 */
export function normalizeAssignedWorkspaceCodes(
  assignments: Array<{ workspaceCode: string }>,
) {
  return Array.from(
    new Set(
      assignments
        .map((assignment) =>
          normalizeCommunityWorkspaceCode(assignment.workspaceCode),
        )
        .filter((code) => COMMUNITY_WORKSPACE_SET.has(code)),
    ),
  );
}

/**
 * A community-wide grant is authoritative for every workspace in that same
 * community, including historical accesses created before individual
 * workspace assignments were tracked. This is based on granted capability,
 * never on a role name.
 */
export function resolveCommunityWorkspaceCodes(
  assignments: Array<{ workspaceCode: string }>,
  scopes: string[],
) {
  if (scopes.includes("*") || scopes.includes("community.full_access")) {
    return [...COMMUNITY_WORKSPACES];
  }
  return normalizeAssignedWorkspaceCodes(assignments);
}
