-- Person.email is the canonical login address for every person-backed user.
-- The composite foreign key makes a divergent AppUser.email impossible.
ALTER TABLE `Person`
  ADD UNIQUE INDEX `Person_id_email_key`(`id`, `email`);

ALTER TABLE `AppUser`
  ADD UNIQUE INDEX `AppUser_personId_email_key`(`personId`, `email`);

ALTER TABLE `AppUser`
  DROP FOREIGN KEY `AppUser_personId_fkey`;

ALTER TABLE `AppUser`
  ADD CONSTRAINT `AppUser_personId_email_fkey`
  FOREIGN KEY (`personId`, `email`)
  REFERENCES `Person`(`id`, `email`)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
