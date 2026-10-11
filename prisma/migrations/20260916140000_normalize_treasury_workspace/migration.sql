-- Tesorería dejó de ser un espacio independiente y ahora pertenece a Contabilidad.
UPDATE `CommunityWorkspaceAssignment`
SET `workspaceCode` = 'ACCOUNTING'
WHERE `workspaceCode` = 'TREASURY';
