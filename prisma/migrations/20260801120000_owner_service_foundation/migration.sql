-- CreateTable
CREATE TABLE `ServiceIncident` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `reporterPersonId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(220) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('RECEIVED', 'IN_REVIEW', 'WORKER_ASSIGNED', 'IN_EXECUTION', 'RESOLVED') NOT NULL DEFAULT 'RECEIVED',
    `reportedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedEmploymentId` VARCHAR(191) NULL,
    `assignedName` VARCHAR(220) NULL,
    `assignedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceIncident_communityId_status_reportedAt_idx`(`communityId`, `status`, `reportedAt`),
    INDEX `ServiceIncident_communityId_propertyId_idx`(`communityId`, `propertyId`),
    INDEX `ServiceIncident_assignedEmploymentId_idx`(`assignedEmploymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceIncidentHistory` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'IN_REVIEW', 'WORKER_ASSIGNED', 'IN_EXECUTION', 'RESOLVED') NOT NULL,
    `note` VARCHAR(1000) NOT NULL,
    `assignedName` VARCHAR(220) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ServiceIncidentHistory_communityId_incidentId_occurredAt_idx`(`communityId`, `incidentId`, `occurredAt`),
    INDEX `ServiceIncidentHistory_actorUserId_idx`(`actorUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceAuthorization` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `ownerPersonId` VARCHAR(191) NOT NULL,
    `type` ENUM('ACCESS', 'WORK', 'EXIT') NOT NULL,
    `subject` VARCHAR(220) NOT NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('RECEIVED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'RECEIVED',
    `vehicleBrand` VARCHAR(100) NULL,
    `vehicleModel` VARCHAR(100) NULL,
    `vehicleColor` VARCHAR(80) NULL,
    `vehiclePlate` VARCHAR(40) NULL,
    `workDescription` TEXT NULL,
    `exitPurpose` VARCHAR(40) NULL,
    `exitItems` TEXT NULL,
    `rejectionReason` VARCHAR(1000) NULL,
    `decidedByUserId` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceAuthorization_communityId_status_issuedAt_idx`(`communityId`, `status`, `issuedAt`),
    INDEX `ServiceAuthorization_communityId_propertyId_idx`(`communityId`, `propertyId`),
    INDEX `ServiceAuthorization_decidedByUserId_idx`(`decidedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceAuthorizationPerson` (
    `id` VARCHAR(191) NOT NULL,
    `authorizationId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(120) NOT NULL,
    `lastName` VARCHAR(120) NOT NULL,
    `documentNumber` VARCHAR(40) NOT NULL,

    INDEX `ServiceAuthorizationPerson_authorizationId_idx`(`authorizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityCommunication` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(220) NOT NULL,
    `body` TEXT NOT NULL,
    `audienceType` ENUM('ALL', 'SECTOR', 'GROUP', 'OWNER') NOT NULL,
    `audienceLabel` VARCHAR(500) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `publishedByUserId` VARCHAR(191) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CommunityCommunication_communityId_status_publishedAt_idx`(`communityId`, `status`, `publishedAt`),
    INDEX `CommunityCommunication_publishedByUserId_idx`(`publishedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunicationRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `communicationId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `personId` VARCHAR(191) NOT NULL,
    `status` ENUM('RECEIVED', 'READ') NOT NULL DEFAULT 'RECEIVED',
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CommunicationRecipient_communityId_status_idx`(`communityId`, `status`),
    INDEX `CommunicationRecipient_propertyId_communicationId_idx`(`propertyId`, `communicationId`),
    INDEX `CommunicationRecipient_personId_communicationId_idx`(`personId`, `communicationId`),
    UNIQUE INDEX `CommunicationRecipient_communicationId_propertyId_personId_key`(`communicationId`, `propertyId`, `personId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ServiceIncident` ADD CONSTRAINT `ServiceIncident_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncident` ADD CONSTRAINT `ServiceIncident_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncident` ADD CONSTRAINT `ServiceIncident_reporterPersonId_fkey` FOREIGN KEY (`reporterPersonId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncident` ADD CONSTRAINT `ServiceIncident_assignedEmploymentId_fkey` FOREIGN KEY (`assignedEmploymentId`) REFERENCES `Employment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncidentHistory` ADD CONSTRAINT `ServiceIncidentHistory_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncidentHistory` ADD CONSTRAINT `ServiceIncidentHistory_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `ServiceIncident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceIncidentHistory` ADD CONSTRAINT `ServiceIncidentHistory_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `AppUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceAuthorization` ADD CONSTRAINT `ServiceAuthorization_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceAuthorization` ADD CONSTRAINT `ServiceAuthorization_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceAuthorization` ADD CONSTRAINT `ServiceAuthorization_ownerPersonId_fkey` FOREIGN KEY (`ownerPersonId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceAuthorization` ADD CONSTRAINT `ServiceAuthorization_decidedByUserId_fkey` FOREIGN KEY (`decidedByUserId`) REFERENCES `AppUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceAuthorizationPerson` ADD CONSTRAINT `ServiceAuthorizationPerson_authorizationId_fkey` FOREIGN KEY (`authorizationId`) REFERENCES `ServiceAuthorization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityCommunication` ADD CONSTRAINT `CommunityCommunication_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityCommunication` ADD CONSTRAINT `CommunityCommunication_publishedByUserId_fkey` FOREIGN KEY (`publishedByUserId`) REFERENCES `AppUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationRecipient` ADD CONSTRAINT `CommunicationRecipient_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationRecipient` ADD CONSTRAINT `CommunicationRecipient_communicationId_fkey` FOREIGN KEY (`communicationId`) REFERENCES `CommunityCommunication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationRecipient` ADD CONSTRAINT `CommunicationRecipient_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationRecipient` ADD CONSTRAINT `CommunicationRecipient_personId_fkey` FOREIGN KEY (`personId`) REFERENCES `Person`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
