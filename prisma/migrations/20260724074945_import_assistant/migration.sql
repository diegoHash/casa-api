-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` VARCHAR(191) NOT NULL,
    `onboardingId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `sourceType` ENUM('MDB', 'CSV') NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `storagePath` VARCHAR(700) NOT NULL,
    `mimeType` VARCHAR(160) NOT NULL,
    `byteSize` BIGINT NOT NULL,
    `checksumSha256` CHAR(64) NOT NULL,
    `status` ENUM('SCANNING', 'SCANNED', 'MAPPING', 'MAPPED', 'VALIDATING', 'READY', 'IMPORTING', 'IMPORTED', 'FAILED') NOT NULL DEFAULT 'SCANNING',
    `tableCount` INTEGER NOT NULL DEFAULT 0,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` VARCHAR(1000) NULL,
    `scannedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportBatch_clientId_createdAt_idx`(`clientId`, `createdAt`),
    INDEX `ImportBatch_communityId_status_idx`(`communityId`, `status`),
    INDEX `ImportBatch_onboardingId_idx`(`onboardingId`),
    INDEX `ImportBatch_checksumSha256_idx`(`checksumSha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportTable` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `sourceName` VARCHAR(255) NOT NULL,
    `rowCount` INTEGER NOT NULL,
    `columns` JSON NOT NULL,
    `sampleRows` JSON NOT NULL,
    `mappingStatus` ENUM('UNMAPPED', 'DRAFT', 'COMPLETE', 'IGNORED') NOT NULL DEFAULT 'UNMAPPED',
    `targetEntity` VARCHAR(100) NULL,
    `notes` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportTable_batchId_mappingStatus_idx`(`batchId`, `mappingStatus`),
    UNIQUE INDEX `ImportTable_batchId_sourceName_key`(`batchId`, `sourceName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportColumnMapping` (
    `id` VARCHAR(191) NOT NULL,
    `importTableId` VARCHAR(191) NOT NULL,
    `sourceColumn` VARCHAR(255) NOT NULL,
    `targetField` VARCHAR(160) NOT NULL,
    `transform` VARCHAR(100) NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportColumnMapping_importTableId_targetField_idx`(`importTableId`, `targetField`),
    UNIQUE INDEX `ImportColumnMapping_importTableId_sourceColumn_key`(`importTableId`, `sourceColumn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImportBatch` ADD CONSTRAINT `ImportBatch_onboardingId_fkey` FOREIGN KEY (`onboardingId`) REFERENCES `OnboardingCase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportTable` ADD CONSTRAINT `ImportTable_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ImportBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportColumnMapping` ADD CONSTRAINT `ImportColumnMapping_importTableId_fkey` FOREIGN KEY (`importTableId`) REFERENCES `ImportTable`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
