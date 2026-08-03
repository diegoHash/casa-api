ALTER TABLE `CommunityAccountingSettings`
  ADD COLUMN `nextReceiptNumber` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `ChargeNotice`
  ADD COLUMN `receivableAccountId` VARCHAR(191) NULL,
  ADD COLUMN `billingIncomeAccountId` VARCHAR(191) NULL,
  ADD COLUMN `journalEntryId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `ChargeNotice_journalEntryId_key` ON `ChargeNotice`(`journalEntryId`);
CREATE INDEX `ChargeNotice_receivableAccountId_idx` ON `ChargeNotice`(`receivableAccountId`);
CREATE INDEX `ChargeNotice_billingIncomeAccountId_idx` ON `ChargeNotice`(`billingIncomeAccountId`);

ALTER TABLE `ChargeNotice`
  ADD CONSTRAINT `ChargeNotice_receivableAccountId_fkey`
    FOREIGN KEY (`receivableAccountId`) REFERENCES `LedgerAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ChargeNotice_billingIncomeAccountId_fkey`
    FOREIGN KEY (`billingIncomeAccountId`) REFERENCES `LedgerAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ChargeNotice_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `OwnerPayment` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `propertyId` VARCHAR(191) NOT NULL,
  `payerPersonId` VARCHAR(191) NULL,
  `chargeNoticeAllocationId` VARCHAR(191) NULL,
  `paymentMethodId` VARCHAR(191) NULL,
  `bankAccountId` VARCHAR(191) NULL,
  `receiptAccountId` VARCHAR(191) NOT NULL,
  `receivableAccountId` VARCHAR(191) NOT NULL,
  `advanceAccountId` VARCHAR(191) NULL,
  `journalEntryId` VARCHAR(191) NOT NULL,
  `receiptNumber` INTEGER NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
  `exchangeRate` DECIMAL(18,6) NOT NULL,
  `amountVes` DECIMAL(18,2) NOT NULL,
  `appliedToNoticeVes` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `advanceVes` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `reference` VARCHAR(160) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `status` ENUM('POSTED', 'REVERSED') NOT NULL DEFAULT 'POSTED',
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OwnerPayment_journalEntryId_key`(`journalEntryId`),
  UNIQUE INDEX `OwnerPayment_communityId_receiptNumber_key`(`communityId`, `receiptNumber`),
  INDEX `OwnerPayment_communityId_paidAt_status_idx`(`communityId`, `paidAt`, `status`),
  INDEX `OwnerPayment_propertyId_paidAt_idx`(`propertyId`, `paidAt`),
  INDEX `OwnerPayment_payerPersonId_idx`(`payerPersonId`),
  INDEX `OwnerPayment_chargeNoticeAllocationId_idx`(`chargeNoticeAllocationId`),
  INDEX `OwnerPayment_paymentMethodId_idx`(`paymentMethodId`),
  INDEX `OwnerPayment_bankAccountId_idx`(`bankAccountId`),
  INDEX `OwnerPayment_receiptAccountId_idx`(`receiptAccountId`),
  INDEX `OwnerPayment_receivableAccountId_idx`(`receivableAccountId`),
  INDEX `OwnerPayment_advanceAccountId_idx`(`advanceAccountId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OwnerPayment`
  ADD CONSTRAINT `OwnerPayment_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_payerPersonId_fkey`
    FOREIGN KEY (`payerPersonId`) REFERENCES `Person`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_chargeNoticeAllocationId_fkey`
    FOREIGN KEY (`chargeNoticeAllocationId`) REFERENCES `ChargeNoticeAllocation`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_paymentMethodId_fkey`
    FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_bankAccountId_fkey`
    FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_receiptAccountId_fkey`
    FOREIGN KEY (`receiptAccountId`) REFERENCES `LedgerAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_receivableAccountId_fkey`
    FOREIGN KEY (`receivableAccountId`) REFERENCES `LedgerAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_advanceAccountId_fkey`
    FOREIGN KEY (`advanceAccountId`) REFERENCES `LedgerAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `OwnerPayment_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
