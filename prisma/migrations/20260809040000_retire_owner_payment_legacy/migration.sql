-- Stage 8: retire the legacy single-row payment application and posting model.
-- Approved for the empty development database only. Run the read-only
-- scripts/verify-owner-payment-legacy-retirement.sql gate before applying in
-- any environment that may contain OwnerPayment history.

ALTER TABLE `OwnerPayment`
  DROP FOREIGN KEY `OwnerPayment_chargeNoticeAllocationId_fkey`,
  DROP FOREIGN KEY `OwnerPayment_receiptAccountId_fkey`,
  DROP FOREIGN KEY `OwnerPayment_receivableAccountId_fkey`,
  DROP FOREIGN KEY `OwnerPayment_advanceAccountId_fkey`,
  DROP FOREIGN KEY `OwnerPayment_journalEntryId_fkey`;

DROP INDEX `OwnerPayment_communityId_receiptNumber_key` ON `OwnerPayment`;
DROP INDEX `OwnerPayment_journalEntryId_key` ON `OwnerPayment`;
DROP INDEX `OwnerPayment_chargeNoticeAllocationId_idx` ON `OwnerPayment`;
DROP INDEX `OwnerPayment_receiptAccountId_idx` ON `OwnerPayment`;
DROP INDEX `OwnerPayment_receivableAccountId_idx` ON `OwnerPayment`;
DROP INDEX `OwnerPayment_advanceAccountId_idx` ON `OwnerPayment`;

ALTER TABLE `OwnerPayment`
  DROP COLUMN `chargeNoticeAllocationId`,
  DROP COLUMN `receiptAccountId`,
  DROP COLUMN `receivableAccountId`,
  DROP COLUMN `advanceAccountId`,
  DROP COLUMN `journalEntryId`,
  DROP COLUMN `receiptNumber`,
  DROP COLUMN `amount`,
  DROP COLUMN `currency`,
  DROP COLUMN `amountVes`,
  DROP COLUMN `appliedToNoticeVes`,
  DROP COLUMN `advanceVes`;
