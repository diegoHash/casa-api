-- Persisted authorization QR credentials and security access events.
ALTER TABLE `ServiceAuthorization`
  ADD COLUMN `qrTokenHash` CHAR(64) NULL,
  ADD COLUMN `qrIssuedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `ServiceAuthorization_qrTokenHash_key`
  ON `ServiceAuthorization`(`qrTokenHash`);

CREATE TABLE `AccessEvent` (
  `id` VARCHAR(191) NOT NULL,
  `communityId` VARCHAR(191) NOT NULL,
  `authorizationId` VARCHAR(191) NULL,
  `propertyId` VARCHAR(191) NULL,
  `direction` ENUM('ENTRY', 'EXIT') NOT NULL,
  `subject` VARCHAR(220) NOT NULL,
  `documentNumber` VARCHAR(40) NULL,
  `source` VARCHAR(30) NOT NULL,
  `qrValidated` BOOLEAN NOT NULL DEFAULT false,
  `registeredById` VARCHAR(191) NULL,
  `notes` VARCHAR(500) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AccessEvent_communityId_occurredAt_idx` (`communityId`, `occurredAt`),
  INDEX `AccessEvent_communityId_authorizationId_idx` (`communityId`, `authorizationId`),
  INDEX `AccessEvent_communityId_propertyId_idx` (`communityId`, `propertyId`),
  CONSTRAINT `AccessEvent_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AccessEvent_authorizationId_fkey` FOREIGN KEY (`authorizationId`) REFERENCES `ServiceAuthorization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AccessEvent_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AccessEvent_registeredById_fkey` FOREIGN KEY (`registeredById`) REFERENCES `AppUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
