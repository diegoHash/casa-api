CREATE TABLE `ServiceAuthorizationVehicle` (
  `id` VARCHAR(191) NOT NULL,
  `authorizationId` VARCHAR(191) NOT NULL,
  `brand` VARCHAR(100) NULL,
  `model` VARCHAR(100) NULL,
  `color` VARCHAR(80) NULL,
  `plate` VARCHAR(40) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ServiceAuthorizationVehicle_authorizationId_idx` (`authorizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ServiceAuthorizationVehicle`
  ADD CONSTRAINT `ServiceAuthorizationVehicle_authorizationId_fkey`
  FOREIGN KEY (`authorizationId`) REFERENCES `ServiceAuthorization`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `ServiceAuthorizationVehicle` (`id`, `authorizationId`, `brand`, `model`, `color`, `plate`)
SELECT CONCAT('legacy_vehicle_', `id`), `id`, `vehicleBrand`, `vehicleModel`, `vehicleColor`, `vehiclePlate`
FROM `ServiceAuthorization`
WHERE `vehicleBrand` IS NOT NULL
   OR `vehicleModel` IS NOT NULL
   OR `vehicleColor` IS NOT NULL
   OR `vehiclePlate` IS NOT NULL;
