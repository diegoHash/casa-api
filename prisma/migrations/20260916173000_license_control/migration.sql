ALTER TABLE `License`
  ADD COLUMN `graceDays` INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN `isTrial` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `trialFrom` DATETIME(3) NULL,
  ADD COLUMN `trialUntil` DATETIME(3) NULL;

CREATE TABLE `LicensePayment` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `licenseId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `exchangeRate` DECIMAL(18,6) NOT NULL,
  `currency` ENUM('VES', 'USD', 'EUR') NOT NULL DEFAULT 'USD',
  `paymentMethod` ENUM('BANK_TRANSFER', 'MOBILE_PAYMENT', 'CASH', 'OTHER') NOT NULL,
  `reference` VARCHAR(160) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `notes` VARCHAR(500) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `LicensePayment_communityId_paidAt_idx` (`communityId`, `paidAt`),
  INDEX `LicensePayment_clientId_paidAt_idx` (`clientId`, `paidAt`),
  INDEX `LicensePayment_licenseId_paidAt_idx` (`licenseId`, `paidAt`),
  INDEX `LicensePayment_reference_idx` (`reference`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LicensePayment`
  ADD CONSTRAINT `LicensePayment_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LicensePayment_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LicensePayment_licenseId_fkey` FOREIGN KEY (`licenseId`) REFERENCES `License`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LicensePayment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AppUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
