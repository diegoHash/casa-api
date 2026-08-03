CREATE TABLE `CommunityWorkspaceAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `accessId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `workspaceCode` VARCHAR(80) NOT NULL,
    `startsOn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsOn` DATETIME(3) NULL,
    `endReason` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CWA_access_status_idx`(`accessId`, `status`),
    INDEX `CWA_community_workspace_status_idx`(`communityId`, `workspaceCode`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CommunityWorkspaceAssignment`
ADD CONSTRAINT `CommunityWorkspaceAssignment_accessId_fkey`
FOREIGN KEY (`accessId`) REFERENCES `CommunityAccess`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CommunityWorkspaceAssignment`
ADD CONSTRAINT `CommunityWorkspaceAssignment_communityId_fkey`
FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `CommunityWorkspaceAssignment` (
    `id`,
    `accessId`,
    `communityId`,
    `workspaceCode`,
    `startsOn`,
    `status`,
    `createdAt`,
    `updatedAt`
)
SELECT
    CONCAT('cwa_', REPLACE(UUID(), '-', '')),
    `id`,
    `communityId`,
    CASE
        WHEN `roleCode` = 'TESORERIA' THEN 'TREASURY'
        WHEN `roleCode` = 'JUNTA' THEN 'BOARD'
        WHEN `roleCode` = 'ATENCION' THEN 'OWNER_SERVICE'
        WHEN `roleCode` = 'BRAZALETES' THEN 'WRISTBANDS'
        WHEN `roleCode` = 'OS_CONTROL_PRINCIPAL' THEN 'CONTROL_PRINCIPAL'
        ELSE 'ADMINISTRATION'
    END,
    `startsOn`,
    'ACTIVE',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `CommunityAccess`
WHERE `status` = 'ACTIVE';
