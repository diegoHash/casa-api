-- CreateTable
CREATE TABLE `CommunityAccountingSettings` (
    `communityId` VARCHAR(191) NOT NULL,
    `functionalCurrency` ENUM('VES', 'USD', 'EUR') NOT NULL DEFAULT 'VES',
    `nextJournalNumber` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`communityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerAccount` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `description` VARCHAR(500) NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE') NOT NULL,
    `normalBalance` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NULL,
    `acceptsEntries` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LedgerAccount_bankAccountId_key`(`bankAccountId`),
    INDEX `LedgerAccount_communityId_type_status_idx`(`communityId`, `type`, `status`),
    INDEX `LedgerAccount_parentId_idx`(`parentId`),
    UNIQUE INDEX `LedgerAccount_communityId_code_key`(`communityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(7) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AccountingPeriod_communityId_status_startsOn_idx`(`communityId`, `status`, `startsOn`),
    UNIQUE INDEX `AccountingPeriod_communityId_periodKey_key`(`communityId`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalEntry` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `accountingPeriodId` VARCHAR(191) NOT NULL,
    `entryNumber` INTEGER NULL,
    `entryDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `source` ENUM('MANUAL', 'OPENING', 'BILLING', 'PAYMENT', 'BANK_RECONCILIATION', 'EXPENSE', 'PURCHASE', 'FUND', 'ADVANCE') NOT NULL DEFAULT 'MANUAL',
    `sourceId` VARCHAR(100) NULL,
    `status` ENUM('DRAFT', 'POSTED', 'REVERSED') NOT NULL DEFAULT 'DRAFT',
    `postedAt` DATETIME(3) NULL,
    `postedById` VARCHAR(191) NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversedById` VARCHAR(191) NULL,
    `reversalOfId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JournalEntry_reversalOfId_key`(`reversalOfId`),
    INDEX `JournalEntry_communityId_entryDate_status_idx`(`communityId`, `entryDate`, `status`),
    INDEX `JournalEntry_accountingPeriodId_status_idx`(`accountingPeriodId`, `status`),
    INDEX `JournalEntry_source_sourceId_idx`(`source`, `sourceId`),
    UNIQUE INDEX `JournalEntry_communityId_entryNumber_key`(`communityId`, `entryNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `description` VARCHAR(500) NULL,
    `debit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `transactionAmount` DECIMAL(18, 2) NULL,
    `transactionCurrency` ENUM('VES', 'USD', 'EUR') NULL,
    `exchangeRate` DECIMAL(18, 6) NULL,
    `referenceType` VARCHAR(80) NULL,
    `referenceId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JournalLine_communityId_accountId_idx`(`communityId`, `accountId`),
    INDEX `JournalLine_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
    UNIQUE INDEX `JournalLine_journalEntryId_lineNumber_key`(`journalEntryId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CommunityAccountingSettings` ADD CONSTRAINT `CommunityAccountingSettings_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerAccount` ADD CONSTRAINT `LedgerAccount_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerAccount` ADD CONSTRAINT `LedgerAccount_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `LedgerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerAccount` ADD CONSTRAINT `LedgerAccount_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingPeriod` ADD CONSTRAINT `AccountingPeriod_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_accountingPeriodId_fkey` FOREIGN KEY (`accountingPeriodId`) REFERENCES `AccountingPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `LedgerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `BillingPeriod` RENAME INDEX `BillingPeriod_community_status_start_idx` TO `BillingPeriod_communityId_status_startsOn_idx`;

-- RenameIndex
ALTER TABLE `PeriodExpense` RENAME INDEX `PeriodExpense_community_period_status_idx` TO `PeriodExpense_communityId_billingPeriodId_status_idx`;
