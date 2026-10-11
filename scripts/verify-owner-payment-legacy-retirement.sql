-- Read-only gate for the final OwnerPayment legacy-column migration.
-- Every query must return 0 before a DROP COLUMN / DROP FOREIGN KEY migration is approved.

-- 1. No payment remains in a workflow that still needs reconciliation or application.
SELECT COUNT(*) AS pending_payments
FROM `OwnerPayment`
WHERE `status` IN ('REPORTED', 'RECONCILED');

-- 2. Historical monetary values were migrated to the immutable multicurrency model.
SELECT COUNT(*) AS payments_without_multicurrency_snapshot
FROM `OwnerPayment`
WHERE `originalAmount` IS NULL
   OR `originalCurrency` IS NULL
   OR `functionalAmount` IS NULL
   OR `functionalCurrency` IS NULL
   OR `exchangeRateSource` IS NULL
   OR `exchangeRateEffectiveAt` IS NULL;

-- 3. Each historical direct allocation has a replacement PaymentApplication.
SELECT COUNT(*) AS legacy_allocations_without_application
FROM `OwnerPayment` p
WHERE p.`chargeNoticeAllocationId` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `PaymentApplication` pa
    WHERE pa.`ownerPaymentId` = p.`id`
      AND pa.`chargeNoticeAllocationId` = p.`chargeNoticeAllocationId`
  );

-- 4. Posted accounting evidence survives independently of OwnerPayment's legacy FKs.
SELECT COUNT(*) AS posted_payments_without_journal_evidence
FROM `OwnerPayment` p
WHERE p.`status` = 'POSTED'
  AND NOT EXISTS (
    SELECT 1
    FROM `JournalEntry` je
    WHERE je.`communityId` = p.`communityId`
      AND je.`source` = 'PAYMENT'
      AND je.`sourceId` = p.`id`
      AND je.`status` IN ('POSTED', 'REVERSED')
  );

-- 5. There are no newly written legacy monetary values after the transition date.
-- Substitute the deployment timestamp before executing.
SELECT COUNT(*) AS new_legacy_writes
FROM `OwnerPayment`
WHERE `createdAt` >= 'YYYY-MM-DD HH:MM:SS'
  AND (
    `amount` IS NOT NULL
    OR `currency` IS NOT NULL
    OR `amountVes` IS NOT NULL
    OR `appliedToNoticeVes` <> 0
    OR `advanceVes` <> 0
    OR `chargeNoticeAllocationId` IS NOT NULL
    OR `receiptAccountId` IS NOT NULL
    OR `receivableAccountId` IS NOT NULL
    OR `advanceAccountId` IS NOT NULL
    OR `journalEntryId` IS NOT NULL
    OR `receiptNumber` IS NOT NULL
  );
