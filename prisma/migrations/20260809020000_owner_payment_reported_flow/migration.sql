-- New payment reports are independent, pending reconciliation records.
-- Legacy accounting/application fields are relaxed but retained for historical reads.
ALTER TABLE `OwnerPayment`
  MODIFY COLUMN `receiptAccountId` VARCHAR(191) NULL,
  MODIFY COLUMN `receivableAccountId` VARCHAR(191) NULL,
  MODIFY COLUMN `journalEntryId` VARCHAR(191) NULL,
  MODIFY COLUMN `receiptNumber` INTEGER NULL,
  MODIFY COLUMN `amount` DECIMAL(18,2) NULL,
  MODIFY COLUMN `currency` ENUM('VES', 'USD', 'EUR') NULL,
  MODIFY COLUMN `amountVes` DECIMAL(18,2) NULL,
  MODIFY COLUMN `status` ENUM('REPORTED', 'RECONCILED', 'POSTED', 'REVERSED') NOT NULL DEFAULT 'REPORTED';
