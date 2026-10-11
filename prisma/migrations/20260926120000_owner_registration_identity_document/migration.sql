ALTER TABLE `OwnerRegistrationRequest`
  ADD COLUMN `identityDocumentKey` VARCHAR(1024) NULL,
  ADD COLUMN `identityDocumentVersionId` VARCHAR(1024) NULL,
  ADD COLUMN `identityDocumentExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `identityDocumentSizeBytes` INTEGER NULL,
  ADD INDEX `OwnerRegistrationRequest_identityDocumentExpiresAt_idx` (`identityDocumentExpiresAt`);
