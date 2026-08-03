export const COMMUNITY_WORKSPACES = [
  'ADMINISTRATION',
  'ACCOUNTING',
  'PURCHASES',
  'OWNER_SERVICE',
  'COLLECTIONS',
  'CONTROL_PRINCIPAL',
  'WRISTBANDS',
  'BOARD',
  'TREASURY',
] as const;

export type CommunityWorkspaceCode = (typeof COMMUNITY_WORKSPACES)[number];

export const COMMUNITY_WORKSPACE_SET = new Set<string>(COMMUNITY_WORKSPACES);
