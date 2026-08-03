-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `legalName` VARCHAR(220) NOT NULL,
    `rif` VARCHAR(20) NOT NULL,
    `contactName` VARCHAR(160) NOT NULL,
    `contactEmail` VARCHAR(190) NOT NULL,
    `contactPhone` VARCHAR(40) NOT NULL,
    `standing` ENUM('ONBOARDING', 'SOLVENT', 'DUE_SOON', 'PAST_DUE', 'SUSPENDED') NOT NULL DEFAULT 'ONBOARDING',
    `onboardingProgress` INTEGER NOT NULL DEFAULT 0,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Client_rif_key`(`rif`),
    INDEX `Client_standing_idx`(`standing`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `License` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'GRACE', 'SUSPENDED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `autoRenewOnReconciliation` BOOLEAN NOT NULL DEFAULT true,
    `monthlyFee` DECIMAL(14, 2) NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NOT NULL DEFAULT 'USD',
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `graceUntil` DATETIME(3) NOT NULL,
    `lastReconciledAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `License_clientId_status_idx`(`clientId`, `status`),
    INDEX `License_periodEnd_idx`(`periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Community` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `activeLicenseId` VARCHAR(191) NULL,
    `name` VARCHAR(160) NOT NULL,
    `legalName` VARCHAR(220) NOT NULL,
    `rif` VARCHAR(20) NOT NULL,
    `phone` VARCHAR(40) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `postalCode` VARCHAR(20) NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'DRAFT',
    `administrationMode` ENUM('BOARD', 'INTERNAL', 'EXTERNAL') NOT NULL DEFAULT 'BOARD',
    `administratorName` VARCHAR(220) NULL,
    `administratorRif` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Community_clientId_key`(`clientId`),
    UNIQUE INDEX `Community_activeLicenseId_key`(`activeLicenseId`),
    UNIQUE INDEX `Community_rif_key`(`rif`),
    INDEX `Community_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Person` (
    `id` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(120) NOT NULL,
    `lastName` VARCHAR(120) NOT NULL,
    `documentType` ENUM('V', 'E', 'J', 'P') NOT NULL,
    `documentNumber` VARCHAR(40) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(190) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Person_email_idx`(`email`),
    UNIQUE INDEX `Person_documentType_documentNumber_key`(`documentType`, `documentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityPerson` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CommunityPerson_personId_idx`(`personId`),
    UNIQUE INDEX `CommunityPerson_communityId_personId_key`(`communityId`, `personId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyLocation` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `kind` ENUM('BUILDING', 'SHOPPING_CENTER') NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PropertyLocation_communityId_kind_idx`(`communityId`, `kind`),
    UNIQUE INDEX `PropertyLocation_communityId_code_key`(`communityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Property` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NULL,
    `kind` ENUM('APARTMENT', 'TOWNHOUSE', 'COMMERCIAL') NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `currentAliquot` DECIMAL(9, 6) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Property_communityId_kind_status_idx`(`communityId`, `kind`, `status`),
    INDEX `Property_locationId_idx`(`locationId`),
    UNIQUE INDEX `Property_communityId_code_key`(`communityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyAliquotPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `aliquot` DECIMAL(9, 6) NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PropertyAliquotPeriod_communityId_propertyId_status_idx`(`communityId`, `propertyId`, `status`),
    INDEX `PropertyAliquotPeriod_propertyId_startsOn_idx`(`propertyId`, `startsOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ownership` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `ownershipPercentage` DECIMAL(7, 4) NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NULL,
    `endReason` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ownership_communityId_propertyId_status_idx`(`communityId`, `propertyId`, `status`),
    INDEX `Ownership_communityId_personId_status_idx`(`communityId`, `personId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employment` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `position` VARCHAR(160) NOT NULL,
    `department` VARCHAR(160) NOT NULL,
    `engagementType` ENUM('EMPLOYEE', 'PROFESSIONAL_FEE', 'CONTRACTOR') NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NULL,
    `endReason` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Employment_communityId_personId_status_idx`(`communityId`, `personId`, `status`),
    INDEX `Employment_communityId_department_idx`(`communityId`, `department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BoardAppointment` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `position` VARCHAR(160) NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NULL,
    `endReason` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BoardAppointment_communityId_personId_status_idx`(`communityId`, `personId`, `status`),
    INDEX `BoardAppointment_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Concession` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `holderName` VARCHAR(220) NOT NULL,
    `holderDocument` VARCHAR(40) NOT NULL,
    `locationDescription` VARCHAR(500) NULL,
    `monthlyAmount` DECIMAL(14, 2) NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NULL,
    `endReason` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Concession_communityId_status_idx`(`communityId`, `status`),
    UNIQUE INDEX `Concession_communityId_code_key`(`communityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankAccount` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(160) NOT NULL,
    `holder` VARCHAR(220) NOT NULL,
    `holderRif` VARCHAR(20) NOT NULL,
    `accountNumber` VARCHAR(80) NOT NULL,
    `accountType` VARCHAR(40) NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BankAccount_communityId_status_idx`(`communityId`, `status`),
    UNIQUE INDEX `BankAccount_communityId_accountNumber_key`(`communityId`, `accountNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentMethod` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `type` ENUM('BANK_TRANSFER', 'MOBILE_PAYMENT', 'CASH') NOT NULL,
    `label` VARCHAR(160) NOT NULL,
    `currency` ENUM('VES', 'USD', 'EUR') NOT NULL,
    `mobilePhone` VARCHAR(40) NULL,
    `mobileDocument` VARCHAR(40) NULL,
    `instructions` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PaymentMethod_communityId_status_idx`(`communityId`, `status`),
    INDEX `PaymentMethod_bankAccountId_idx`(`bankAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnboardingCase` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'DISCOVERY', 'EXTRACTING', 'VALIDATING', 'CONFIGURING', 'READY', 'ACTIVATED', 'BLOCKED') NOT NULL DEFAULT 'DRAFT',
    `sourceSystem` VARCHAR(250) NULL,
    `sourceOwner` VARCHAR(160) NULL,
    `historicalFrom` DATETIME(3) NULL,
    `historicalTo` DATETIME(3) NULL,
    `cutoverDate` DATETIME(3) NULL,
    `coordinator` VARCHAR(160) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OnboardingCase_clientId_key`(`clientId`),
    UNIQUE INDEX `OnboardingCase_communityId_key`(`communityId`),
    INDEX `OnboardingCase_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppUser` (
    `id` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NULL,
    `email` VARCHAR(190) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `platformRole` ENUM('ROOT', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'AUDITOR') NULL,
    `status` ENUM('ACTIVE', 'INVITED', 'BLOCKED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `lastAccessAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppUser_personId_key`(`personId`),
    UNIQUE INDEX `AppUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityAccess` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `roleCode` VARCHAR(80) NOT NULL,
    `scopes` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'INVITED', 'BLOCKED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `startsOn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsOn` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CommunityAccess_communityId_status_idx`(`communityId`, `status`),
    UNIQUE INDEX `CommunityAccess_userId_communityId_roleCode_key`(`userId`, `communityId`, `roleCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NULL,
    `actorUserId` VARCHAR(191) NULL,
    `requestId` VARCHAR(80) NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(100) NULL,
    `detail` VARCHAR(500) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_communityId_createdAt_idx`(`communityId`, `createdAt`),
    INDEX `AuditEvent_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `AuditEvent_requestId_idx`(`requestId`),
    INDEX `AuditEvent_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `License` ADD CONSTRAINT `License_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community` ADD CONSTRAINT `Community_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community` ADD CONSTRAINT `Community_activeLicenseId_fkey` FOREIGN KEY (`activeLicenseId`) REFERENCES `License`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityPerson` ADD CONSTRAINT `CommunityPerson_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityPerson` ADD CONSTRAINT `CommunityPerson_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyLocation` ADD CONSTRAINT `PropertyLocation_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Property` ADD CONSTRAINT `Property_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Property` ADD CONSTRAINT `Property_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `PropertyLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyAliquotPeriod` ADD CONSTRAINT `PropertyAliquotPeriod_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyAliquotPeriod` ADD CONSTRAINT `PropertyAliquotPeriod_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ownership` ADD CONSTRAINT `Ownership_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ownership` ADD CONSTRAINT `Ownership_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ownership` ADD CONSTRAINT `Ownership_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employment` ADD CONSTRAINT `Employment_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employment` ADD CONSTRAINT `Employment_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardAppointment` ADD CONSTRAINT `BoardAppointment_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardAppointment` ADD CONSTRAINT `BoardAppointment_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardAppointment` ADD CONSTRAINT `BoardAppointment_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Concession` ADD CONSTRAINT `Concession_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankAccount` ADD CONSTRAINT `BankAccount_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentMethod` ADD CONSTRAINT `PaymentMethod_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentMethod` ADD CONSTRAINT `PaymentMethod_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnboardingCase` ADD CONSTRAINT `OnboardingCase_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnboardingCase` ADD CONSTRAINT `OnboardingCase_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppUser` ADD CONSTRAINT `AppUser_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityAccess` ADD CONSTRAINT `CommunityAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AppUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityAccess` ADD CONSTRAINT `CommunityAccess_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `AppUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
