ALTER TABLE `PeriodExpense`
  ADD COLUMN `invoiceNumber` VARCHAR(100) NULL,
  ADD COLUMN `beneficiaryName` VARCHAR(220) NULL,
  ADD COLUMN `beneficiaryDocument` VARCHAR(40) NULL,
  ADD COLUMN `beneficiaryPhone` VARCHAR(40) NULL,
  ADD COLUMN `paymentSource` ENUM('BANK_ACCOUNT', 'CASH', 'OTHER') NULL,
  ADD COLUMN `bankAccountId` VARCHAR(191) NULL,
  ADD COLUMN `paymentMethodId` VARCHAR(191) NULL,
  ADD COLUMN `paymentReference` VARCHAR(160) NULL,
  ADD COLUMN `paidAt` DATETIME(3) NULL,
  ADD COLUMN `expenseAccountId` VARCHAR(191) NULL,
  ADD COLUMN `paymentAccountId` VARCHAR(191) NULL,
  ADD COLUMN `journalEntryId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PeriodExpense_journalEntryId_key` ON `PeriodExpense`(`journalEntryId`);
CREATE INDEX `PeriodExpense_bankAccountId_idx` ON `PeriodExpense`(`bankAccountId`);
CREATE INDEX `PeriodExpense_paymentMethodId_idx` ON `PeriodExpense`(`paymentMethodId`);
CREATE INDEX `PeriodExpense_expenseAccountId_idx` ON `PeriodExpense`(`expenseAccountId`);
CREATE INDEX `PeriodExpense_paymentAccountId_idx` ON `PeriodExpense`(`paymentAccountId`);

ALTER TABLE `PeriodExpense`
  ADD CONSTRAINT `PeriodExpense_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PeriodExpense_paymentMethodId_fkey` FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PeriodExpense_expenseAccountId_fkey` FOREIGN KEY (`expenseAccountId`) REFERENCES `LedgerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PeriodExpense_paymentAccountId_fkey` FOREIGN KEY (`paymentAccountId`) REFERENCES `LedgerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PeriodExpense_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `ChargeNotice` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `billingPeriodId` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT', 'PREPARED', 'ISSUED', 'VOID') NOT NULL DEFAULT 'DRAFT',
  `totalExpensesVes` DECIMAL(18,2) NOT NULL,
  `totalComponentsVes` DECIMAL(18,2) NOT NULL,
  `totalCommunityVes` DECIMAL(18,2) NOT NULL,
  `totalCommunityUsd` DECIMAL(18,2) NOT NULL,
  `preparedAt` DATETIME(3) NULL,
  `issuedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ChargeNotice_billingPeriodId_key`(`billingPeriodId`),
  INDEX `ChargeNotice_communityId_status_idx`(`communityId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ChargeNotice_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ChargeNotice_billingPeriodId_fkey` FOREIGN KEY (`billingPeriodId`) REFERENCES `BillingPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChargeNoticeComponent` (
  `id` VARCHAR(191) NOT NULL,
  `chargeNoticeId` VARCHAR(191) NOT NULL,
  `type` ENUM('RESERVE_FUND', 'PROVISION', 'EXTRA_FEE', 'EMERGENCY_FEE') NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
  `amountVes` DECIMAL(18,2) NOT NULL,
  `allocationMethod` ENUM('ALIQUOT', 'FIXED') NOT NULL DEFAULT 'ALIQUOT',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ChargeNoticeComponent_chargeNoticeId_type_idx`(`chargeNoticeId`, `type`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ChargeNoticeComponent_chargeNoticeId_fkey` FOREIGN KEY (`chargeNoticeId`) REFERENCES `ChargeNotice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChargeNoticeAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `chargeNoticeId` VARCHAR(191) NOT NULL,
  `propertyId` VARCHAR(191) NOT NULL,
  `aliquotSnapshot` DECIMAL(9,6) NOT NULL,
  `expenseShareVes` DECIMAL(18,2) NOT NULL,
  `componentShareVes` DECIMAL(18,2) NOT NULL,
  `totalVes` DECIMAL(18,2) NOT NULL,
  `totalUsd` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ChargeNoticeAllocation_chargeNoticeId_propertyId_key`(`chargeNoticeId`, `propertyId`),
  INDEX `ChargeNoticeAllocation_propertyId_idx`(`propertyId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ChargeNoticeAllocation_chargeNoticeId_fkey` FOREIGN KEY (`chargeNoticeId`) REFERENCES `ChargeNotice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ChargeNoticeAllocation_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
