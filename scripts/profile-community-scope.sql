USE movedb;

SET SESSION group_concat_max_len = 1000000;

SELECT GROUP_CONCAT(
  CONCAT(
    'SELECT ''', TABLE_NAME, ''' AS table_name, ''',
    COLUMN_NAME, ''' AS column_name, CAST(`',
    REPLACE(COLUMN_NAME, '`', '``'),
    '` AS CHAR) AS community_code, COUNT(*) AS occurrences FROM `',
    REPLACE(TABLE_NAME, '`', '``'),
    '` GROUP BY `',
    REPLACE(COLUMN_NAME, '`', '``'),
    '`'
  )
  SEPARATOR ' UNION ALL '
) INTO @community_scope_sql
FROM information_schema.columns
WHERE table_schema = 'movedb'
  AND LOWER(column_name) IN ('codigo_cond', 'cod_cond');

SET @community_scope_sql = CONCAT(
  'SELECT * FROM (',
  @community_scope_sql,
  ') scope ORDER BY table_name, community_code'
);

PREPARE community_scope_statement FROM @community_scope_sql;
EXECUTE community_scope_statement;
DEALLOCATE PREPARE community_scope_statement;
