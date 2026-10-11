ALTER TABLE `ExpenseConcept`
  ADD COLUMN `defaultExpenseAccountId` VARCHAR(191) NULL;

CREATE INDEX `ExpenseConcept_defaultExpenseAccountId_idx`
  ON `ExpenseConcept`(`defaultExpenseAccountId`);

ALTER TABLE `ExpenseConcept`
  ADD CONSTRAINT `ExpenseConcept_defaultExpenseAccountId_fkey`
  FOREIGN KEY (`defaultExpenseAccountId`) REFERENCES `LedgerAccount`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
