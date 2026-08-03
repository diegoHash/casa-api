-- AlterTable
ALTER TABLE `Property` ADD COLUMN `braceletQuota` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `maximumOccupancy` INTEGER NULL;

-- CreateTable
CREATE TABLE `PersonContact` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `type` ENUM('PHONE', 'EMAIL', 'WHATSAPP', 'OTHER') NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `value` VARCHAR(190) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PersonContact_communityId_personId_idx`(`communityId`, `personId`),
    UNIQUE INDEX `PersonContact_communityId_personId_type_value_key`(`communityId`, `personId`, `type`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PersonContact` ADD CONSTRAINT `PersonContact_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PersonContact` ADD CONSTRAINT `PersonContact_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
