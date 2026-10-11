-- Stage 2.1: add the rejected terminal state without rewriting historical rows.
-- POSTED and REVERSED remain readable legacy values and have no active transitions.
ALTER TABLE `OwnerPayment`
  MODIFY COLUMN `status` ENUM('REPORTED', 'RECONCILED', 'REJECTED', 'POSTED', 'REVERSED') NOT NULL DEFAULT 'REPORTED';
