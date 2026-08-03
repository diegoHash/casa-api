-- A concept code identifies one concept per community, regardless of category.
DROP INDEX `ExpenseConcept_categoryId_code_key` ON `ExpenseConcept`;

CREATE UNIQUE INDEX `ExpenseConcept_communityId_code_key`
ON `ExpenseConcept`(`communityId`, `code`);
