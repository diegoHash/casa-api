CREATE TABLE `ExpenseConcept` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `categoryId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ExpenseConcept_categoryId_code_key`(`categoryId`, `code`),
  INDEX `ExpenseConcept_communityId_status_idx`(`communityId`, `status`),
  INDEX `ExpenseConcept_categoryId_status_idx`(`categoryId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExpenseConcept`
  ADD CONSTRAINT `ExpenseConcept_communityId_fkey`
    FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ExpenseConcept_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `ExpenseCategory`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing expenses without inventing a different classification:
-- every existing category receives a visible "General (migrado)" concept.
INSERT INTO `ExpenseConcept` (
  `id`,
  `communityId`,
  `categoryId`,
  `code`,
  `name`,
  `description`,
  `status`,
  `createdAt`,
  `updatedAt`
)
SELECT
  CONCAT('legacy_', `id`),
  `communityId`,
  `id`,
  'GENERAL',
  'General (migrado)',
  'Concepto creado automáticamente para conservar gastos anteriores.',
  'ACTIVE',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `ExpenseCategory`;

ALTER TABLE `PeriodExpense`
  ADD COLUMN `conceptId` VARCHAR(191) NULL;

UPDATE `PeriodExpense` AS expense
INNER JOIN `ExpenseCategory` AS category
  ON category.`id` = expense.`categoryId`
SET expense.`conceptId` = CONCAT('legacy_', category.`id`);

ALTER TABLE `PeriodExpense`
  MODIFY `conceptId` VARCHAR(191) NOT NULL;

CREATE INDEX `PeriodExpense_conceptId_idx`
  ON `PeriodExpense`(`conceptId`);

ALTER TABLE `PeriodExpense`
  ADD CONSTRAINT `PeriodExpense_conceptId_fkey`
    FOREIGN KEY (`conceptId`) REFERENCES `ExpenseConcept`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PeriodExpense`
  DROP FOREIGN KEY `PeriodExpense_categoryId_fkey`;

DROP INDEX `PeriodExpense_categoryId_idx` ON `PeriodExpense`;

ALTER TABLE `PeriodExpense`
  DROP COLUMN `categoryId`;
