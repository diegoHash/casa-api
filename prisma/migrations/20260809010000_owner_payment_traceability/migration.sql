-- Chapter 1 / traceability foundation. This migration is intentionally additive.
-- Existing payment, accounting, notice-application, and VES columns remain untouched.
ALTER TABLE `OwnerPayment`
  ADD COLUMN `exchangeRateSource` VARCHAR(40) NULL,
  ADD COLUMN `exchangeRateEffectiveAt` DATETIME(3) NULL,
  ADD COLUMN `exchangeRateReference` VARCHAR(160) NULL,
  ADD COLUMN `reportedAt` DATETIME(3) NULL,
  ADD COLUMN `reportedById` VARCHAR(191) NULL,
  ADD COLUMN `reconciledAt` DATETIME(3) NULL,
  ADD COLUMN `reconciledById` VARCHAR(191) NULL;

CREATE INDEX `OwnerPayment_communityId_status_reportedAt_idx`
  ON `OwnerPayment`(`communityId`, `status`, `reportedAt`);
CREATE INDEX `OwnerPayment_communityId_originalCurrency_idx`
  ON `OwnerPayment`(`communityId`, `originalCurrency`);
CREATE INDEX `OwnerPayment_reportedById_idx`
  ON `OwnerPayment`(`reportedById`);
CREATE INDEX `OwnerPayment_reconciledById_idx`
  ON `OwnerPayment`(`reconciledById`);

ALTER TABLE `OwnerPayment`
  ADD CONSTRAINT `OwnerPayment_reportedById_fkey`
    FOREIGN KEY (`reportedById`) REFERENCES `AppUser`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_reconciledById_fkey`
    FOREIGN KEY (`reconciledById`) REFERENCES `AppUser`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
