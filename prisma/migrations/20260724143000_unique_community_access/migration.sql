CREATE UNIQUE INDEX `CommunityAccess_userId_communityId_key`
ON `CommunityAccess`(`userId`, `communityId`);

DROP INDEX `CommunityAccess_userId_communityId_roleCode_key` ON `CommunityAccess`;
