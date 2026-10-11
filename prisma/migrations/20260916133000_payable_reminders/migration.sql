CREATE TABLE `PayableReminder` (
  `id` varchar(191) NOT NULL,
  `communityId` varchar(191) NOT NULL,
  `payableId` varchar(191) NOT NULL,
  `createdById` varchar(191) NOT NULL,
  `remindAt` datetime(3) NOT NULL,
  `message` varchar(300) NULL,
  `status` enum('ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `completedAt` datetime(3) NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `PayableReminder_communityId_status_remindAt_idx` (`communityId`, `status`, `remindAt`),
  INDEX `PayableReminder_communityId_payableId_status_idx` (`communityId`, `payableId`, `status`),
  INDEX `PayableReminder_createdById_status_remindAt_idx` (`createdById`, `status`, `remindAt`),
  CONSTRAINT `PayableReminder_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayableReminder_payableId_fkey` FOREIGN KEY (`payableId`) REFERENCES `VendorPayable`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PayableReminder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AppUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
