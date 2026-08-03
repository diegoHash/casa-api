CREATE TABLE `ExpenseCategory` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpenseCategory_communityId_code_key`(`communityId`, `code`),
    INDEX `ExpenseCategory_communityId_status_idx`(`communityId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(7) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NOT NULL,
    `bcvRate` DECIMAL(18, 6) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'CLOSED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `issuedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BillingPeriod_communityId_periodKey_key`(`communityId`, `periodKey`),
    INDEX `BillingPeriod_community_status_start_idx`(`communityId`, `status`, `startsOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PeriodExpense` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `billingPeriodId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
    `allocationMethod` ENUM('ALIQUOT', 'FIXED') NOT NULL DEFAULT 'ALIQUOT',
    `notes` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PeriodExpense_community_period_status_idx`(`communityId`, `billingPeriodId`, `status`),
    INDEX `PeriodExpense_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExpenseCategory`
ADD CONSTRAINT `ExpenseCategory_communityId_fkey`
FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BillingPeriod`
ADD CONSTRAINT `BillingPeriod_communityId_fkey`
FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PeriodExpense`
ADD CONSTRAINT `PeriodExpense_communityId_fkey`
FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PeriodExpense`
ADD CONSTRAINT `PeriodExpense_billingPeriodId_fkey`
FOREIGN KEY (`billingPeriodId`) REFERENCES `BillingPeriod`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PeriodExpense`
ADD CONSTRAINT `PeriodExpense_categoryId_fkey`
FOREIGN KEY (`categoryId`) REFERENCES `ExpenseCategory`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;
