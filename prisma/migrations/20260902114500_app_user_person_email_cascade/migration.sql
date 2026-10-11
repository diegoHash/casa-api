-- Keep AppUser.email synchronized when the email of its linked Person changes.
ALTER TABLE `AppUser` DROP FOREIGN KEY `AppUser_personId_email_fkey`;

ALTER TABLE `AppUser`
  ADD CONSTRAINT `AppUser_personId_email_fkey`
  FOREIGN KEY (`personId`, `email`) REFERENCES `Person`(`id`, `email`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
