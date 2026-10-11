ALTER TABLE `CommunityAccountingSettings`
  MODIFY `functionalCurrency` ENUM('VES', 'USD', 'EUR') NOT NULL DEFAULT 'USD';

UPDATE `CommunityAccountingSettings`
  SET `functionalCurrency` = 'USD'
  WHERE `functionalCurrency` = 'VES';
