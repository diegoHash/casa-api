CREATE TABLE `Vendor` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `legalName` VARCHAR(220) NOT NULL,
  `document` VARCHAR(40) NOT NULL,
  `address` VARCHAR(500) NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(190) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Vendor_communityId_document_key`(`communityId`, `document`),
  INDEX `Vendor_communityId_status_legalName_idx`(`communityId`, `status`, `legalName`),
  CONSTRAINT `Vendor_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
