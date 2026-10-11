-- Chapter 1 / microphase: additive multicurrency foundation for OwnerPayment.
-- Legacy columns remain in place while readers and writers transition.
ALTER TABLE `OwnerPayment`
  MODIFY COLUMN `exchangeRate` DECIMAL(18,2) NOT NULL,
  ADD COLUMN `originalAmount` DECIMAL(18,2) NULL,
  ADD COLUMN `originalCurrency` CHAR(3) NULL,
  ADD COLUMN `functionalAmount` DECIMAL(18,2) NULL,
  ADD COLUMN `functionalCurrency` CHAR(3) NULL DEFAULT 'USD';
