DELETE concept
FROM `ExpenseConcept` AS concept
LEFT JOIN `PeriodExpense` AS expense
  ON expense.`conceptId` = concept.`id`
WHERE concept.`id` LIKE 'legacy\_%'
  AND concept.`code` = 'GENERAL'
  AND expense.`id` IS NULL;
