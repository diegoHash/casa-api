USE movedb;

SELECT 'tables.actual' AS metric, COUNT(*) AS value
FROM information_schema.tables WHERE table_schema = 'movedb'
UNION ALL
SELECT 'rows.information_schema_estimate', SUM(table_rows)
FROM information_schema.tables WHERE table_schema = 'movedb'
UNION ALL
SELECT 'proprietario.total', COUNT(*) FROM PROPIETARIO
UNION ALL
SELECT 'proprietario.deleted', COUNT(*) FROM PROPIETARIO WHERE COALESCE(DelReg, 0) <> 0
UNION ALL
SELECT 'proprietario.document_missing', COUNT(*) FROM PROPIETARIO WHERE CEDULA IS NULL OR TRIM(CEDULA) = ''
UNION ALL
SELECT 'proprietario.email_missing', COUNT(*) FROM PROPIETARIO WHERE E_MAIL IS NULL OR TRIM(E_MAIL) = ''
UNION ALL
SELECT 'proprietario.phone_missing', COUNT(*) FROM PROPIETARIO WHERE TELEFONO IS NULL OR TRIM(TELEFONO) = ''
UNION ALL
SELECT 'proprietario.property_code_missing', COUNT(*) FROM PROPIETARIO WHERE APTO IS NULL OR TRIM(APTO) = ''
UNION ALL
SELECT 'proprietario.multi_name_suspected', COUNT(*) FROM PROPIETARIO
WHERE REPRESENTANTE REGEXP '[/;]|[[:space:]]Y[[:space:]]'
UNION ALL
SELECT 'proprietario.duplicate_property_groups', COUNT(*) FROM (
  SELECT CODIGO_COND, UPPER(TRIM(APTO))
  FROM PROPIETARIO
  WHERE COALESCE(DelReg, 0) = 0
  GROUP BY CODIGO_COND, UPPER(TRIM(APTO))
  HAVING COUNT(*) > 1
) d
UNION ALL
SELECT 'proprietario.duplicate_document_groups', COUNT(*) FROM (
  SELECT REPLACE(REPLACE(REPLACE(UPPER(TRIM(CEDULA)), '.', ''), '-', ''), ' ', '')
  FROM PROPIETARIO
  WHERE CEDULA IS NOT NULL AND TRIM(CEDULA) <> '' AND COALESCE(DelReg, 0) = 0
  GROUP BY REPLACE(REPLACE(REPLACE(UPPER(TRIM(CEDULA)), '.', ''), '-', ''), ' ', '')
  HAVING COUNT(*) > 1
) d
UNION ALL
SELECT 'security.users_with_plaintext_password', COUNT(*) FROM USUARIO
WHERE CLAVE IS NOT NULL AND TRIM(CLAVE) <> ''
UNION ALL
SELECT 'security.active_users', COUNT(*) FROM USUARIO
WHERE UPPER(TRIM(CONDICION)) = 'ACTIVO' AND COALESCE(DelReg, 0) = 0
UNION ALL
SELECT 'audit.rows', COUNT(*) FROM AuditoriaU
UNION ALL
SELECT 'audit.access_time_sentinel_rows', COUNT(*) FROM AuditoriaU
WHERE DATE(AHora) = '1899-12-30';

SELECT CONCAT('community.', CODIGO_COND, '.properties') AS metric, COUNT(*) AS value
FROM PROPIETARIO GROUP BY CODIGO_COND
UNION ALL
SELECT CONCAT('community.', CODIGO_COND, '.aliquot_total_general'), ROUND(SUM(ALICUOTAT), 8)
FROM PROPIETARIO WHERE COALESCE(DelReg, 0) = 0 GROUP BY CODIGO_COND
UNION ALL
SELECT CONCAT('community.', CODIGO_COND, '.aliquot_total_commercial'), ROUND(SUM(ALICUOTAC), 8)
FROM PROPIETARIO WHERE COALESCE(DelReg, 0) = 0 GROUP BY CODIGO_COND
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.receivables'), COUNT(*)
FROM CargaDocs GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.receivable_open_balance'), ROUND(SUM(CASE WHEN DebCre = 'D' THEN COALESCE(SaldoDoc,0) ELSE -COALESCE(SaldoDoc,0) END), 4)
FROM CargaDocs WHERE COALESCE(DelReg, 0) = 0 GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.receipts'), COUNT(*)
FROM Recibos GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.receipt_amount'), ROUND(SUM(COALESCE(MontoRec,0)), 4)
FROM Recibos WHERE COALESCE(DelReg, 0) = 0 GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.bank_transactions'), COUNT(*)
FROM Transaccion_Bancaria GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', Codigo_Cond, '.fx_transactions'), COUNT(*)
FROM Transaccion_Divisas GROUP BY Codigo_Cond
UNION ALL
SELECT CONCAT('community.', CODIGO_COND, '.disbursements'), COUNT(*)
FROM EmisionCheque GROUP BY CODIGO_COND
UNION ALL
SELECT CONCAT('community.', CODIGO_COND, '.journal_entries'), COUNT(*)
FROM Comprobante GROUP BY CODIGO_COND;

SELECT 'dates.receivable.min' AS metric, MIN(FechaEmi) AS value FROM CargaDocs
UNION ALL SELECT 'dates.receivable.max', MAX(FechaEmi) FROM CargaDocs
UNION ALL SELECT 'dates.receipt.min', MIN(FechaPago) FROM Recibos
UNION ALL SELECT 'dates.receipt.max', MAX(FechaPago) FROM Recibos
UNION ALL SELECT 'dates.bank_transaction.min', MIN(FechaTB) FROM Transaccion_Bancaria
UNION ALL SELECT 'dates.bank_transaction.max', MAX(FechaTB) FROM Transaccion_Bancaria
UNION ALL SELECT 'dates.fx_transaction.min', MIN(FechaTB) FROM Transaccion_Divisas
UNION ALL SELECT 'dates.fx_transaction.max', MAX(FechaTB) FROM Transaccion_Divisas
UNION ALL SELECT 'dates.disbursement.min', MIN(FechaE) FROM EmisionCheque
UNION ALL SELECT 'dates.disbursement.max', MAX(FechaE) FROM EmisionCheque
UNION ALL SELECT 'dates.journal.min', MIN(FECHA_COMP) FROM Comprobante
UNION ALL SELECT 'dates.journal.max', MAX(FECHA_COMP) FROM Comprobante
UNION ALL SELECT 'dates.billing_notice.min', MIN(FECHA_EMISION) FROM Aviso
UNION ALL SELECT 'dates.billing_notice.max', MAX(FECHA_EMISION) FROM Aviso
UNION ALL SELECT 'dates.exchange_rate.min', MIN(FECHA) FROM Tasas
UNION ALL SELECT 'dates.exchange_rate.max', MAX(FECHA) FROM Tasas;

SELECT 'orphans.property.community' AS metric, COUNT(*) AS value
FROM PROPIETARIO p LEFT JOIN CONDOMINIO c ON c.CODIGO_COND = p.CODIGO_COND
WHERE c.CODIGO_COND IS NULL
UNION ALL
SELECT 'orphans.notice.community', COUNT(*)
FROM Aviso a LEFT JOIN CONDOMINIO c ON c.CODIGO_COND = a.CODIGO_COND
WHERE c.CODIGO_COND IS NULL
UNION ALL
SELECT 'orphans.notice_line.notice', COUNT(*)
FROM Detalle_Aviso d LEFT JOIN Aviso a ON a.ID_AVI = d.ID_AVI
WHERE a.ID_AVI IS NULL
UNION ALL
SELECT 'orphans.notice_line.concept', COUNT(*)
FROM Detalle_Aviso d LEFT JOIN CONCEPTO_FACT c ON c.ID_CON = d.ID_CON
WHERE c.ID_CON IS NULL
UNION ALL
SELECT 'orphans.receivable.property', COUNT(*)
FROM CargaDocs d LEFT JOIN PROPIETARIO p
  ON p.CODIGO_COND = d.Codigo_Cond AND p.CODIGO_PRO = d.CodPropt
WHERE p.ID_PRO IS NULL
UNION ALL
SELECT 'orphans.receivable.type', COUNT(*)
FROM CargaDocs d LEFT JOIN Doc_De_Cobro t
  ON t.CODIGO_COND = d.Codigo_Cond AND t.COD_DocC = d.TipoDoc
WHERE t.ID_DocC IS NULL
UNION ALL
SELECT 'orphans.receivable_application.receivable', COUNT(*)
FROM CargaDocsDetalle x LEFT JOIN CargaDocs d
  ON d.Codigo_Cond = x.Codigo_Cond
 AND d.CodPropt = x.CodProptD
 AND d.NroDoc = x.NroDocD
WHERE d.NroDoc IS NULL
UNION ALL
SELECT 'orphans.receipt.property', COUNT(*)
FROM Recibos r LEFT JOIN PROPIETARIO p
  ON p.CODIGO_COND = r.Codigo_Cond AND p.CODIGO_PRO = r.CodProptRec
WHERE r.CodProptRec IS NOT NULL AND TRIM(r.CodProptRec) <> '' AND p.ID_PRO IS NULL
UNION ALL
SELECT 'orphans.receipt_detail.receipt', COUNT(*)
FROM RecibosDetalle d LEFT JOIN Recibos r
  ON r.Codigo_Cond = d.Codigo_Cond AND r.NroRec = d.NroRecD
WHERE r.NroRec IS NULL
UNION ALL
SELECT 'orphans.bank_account.bank', COUNT(*)
FROM CUENTA_BANC a LEFT JOIN BANCO b ON b.CODIGO_BAN = a.CODIGO_BAN
WHERE b.ID_BAN IS NULL
UNION ALL
SELECT 'orphans.bank_transaction.account', COUNT(*)
FROM Transaccion_Bancaria t LEFT JOIN CUENTA_BANC a
  ON a.CODIGO_COND = t.Codigo_Cond AND a.CODIGO_CUEB = t.Codigo_Cueb
WHERE a.ID_CUEB IS NULL
UNION ALL
SELECT 'orphans.fx_transaction.account', COUNT(*)
FROM Transaccion_Divisas t LEFT JOIN CUENTA_BANC a
  ON a.CODIGO_COND = t.Codigo_Cond AND a.CODIGO_CUEB = t.Codigo_Cueb
WHERE a.ID_CUEB IS NULL
UNION ALL
SELECT 'orphans.disbursement_line.header', COUNT(*)
FROM EmisionChequeDeta d LEFT JOIN EmisionCheque h
  ON h.CODIGO_COND = d.CODIGO_COND AND h.Codigo_Emi = d.Codigo_Emi
WHERE h.ID_Emi IS NULL
UNION ALL
SELECT 'orphans.journal_line.header', COUNT(*)
FROM Comprobante_Detalle d LEFT JOIN Comprobante h ON h.ID_COMP = d.ID_COMP
WHERE h.ID_COMP IS NULL
UNION ALL
SELECT 'orphans.journal_line.account', COUNT(*)
FROM Comprobante_Detalle d LEFT JOIN PLAN p ON p.ID_CUE = d.ID_CUE
WHERE p.ID_CUE IS NULL;

SELECT 'integrity.receipt_number_ambiguous_groups' AS metric, COUNT(*) AS value
FROM (
  SELECT Codigo_Cond, NroRec
  FROM Recibos
  GROUP BY Codigo_Cond, NroRec
  HAVING COUNT(*) > 1
) d
UNION ALL
SELECT 'integrity.unbalanced_journal_entries_base', COUNT(*)
FROM (
  SELECT ID_COMP
  FROM Comprobante_Detalle
  GROUP BY ID_COMP
  HAVING ABS(SUM(COALESCE(DEBE, 0)) - SUM(COALESCE(HABER, 0))) > 0.01
) j
UNION ALL
SELECT 'integrity.unbalanced_journal_entries_fx', COUNT(*)
FROM (
  SELECT ID_COMP
  FROM Comprobante_Detalle
  GROUP BY ID_COMP
  HAVING ABS(SUM(COALESCE(DEBEDolar, 0)) - SUM(COALESCE(HABERDolar, 0))) > 0.01
) j
UNION ALL
SELECT 'integrity.receipt_header_detail_difference_groups', COUNT(*)
FROM (
  SELECT r.Codigo_Cond, r.NroRec, r.MesRec, r.AnhoRec
  FROM Recibos r
  LEFT JOIN RecibosDetalle d
    ON d.Codigo_Cond = r.Codigo_Cond AND d.NroRecD = r.NroRec
  WHERE COALESCE(r.DelReg, 0) = 0
  GROUP BY r.Codigo_Cond, r.NroRec, r.MesRec, r.AnhoRec, r.MontoRec
  HAVING ABS(COALESCE(r.MontoRec, 0) - COALESCE(SUM(CASE WHEN d.DebCred = 'C' THEN d.MontoPagado ELSE -d.MontoPagado END), 0)) > 0.01
) x
UNION ALL
SELECT 'integrity.current_owner_rows_not_in_old', COUNT(*)
FROM PROPIETARIO p LEFT JOIN PROPIETARIO_OLD o ON o.ID_PRO = p.ID_PRO
WHERE o.ID_PRO IS NULL
UNION ALL
SELECT 'integrity.old_owner_rows_not_in_current', COUNT(*)
FROM PROPIETARIO_OLD o LEFT JOIN PROPIETARIO p ON p.ID_PRO = o.ID_PRO
WHERE p.ID_PRO IS NULL
UNION ALL
SELECT 'integrity.current_vendor_rows_not_in_old', COUNT(*)
FROM BENEFICIARIO b LEFT JOIN BENEFICIARIO_OLD o ON o.ID_BEN = b.ID_BEN
WHERE o.ID_BEN IS NULL
UNION ALL
SELECT 'integrity.old_vendor_rows_not_in_current', COUNT(*)
FROM BENEFICIARIO_OLD o LEFT JOIN BENEFICIARIO b ON b.ID_BEN = o.ID_BEN
WHERE b.ID_BEN IS NULL;

SELECT 'currencies.bank_account' AS domain_name, CAST(MONEDA AS CHAR) AS domain_value, COUNT(*) AS occurrences
FROM CUENTA_BANC GROUP BY MONEDA
UNION ALL
SELECT 'currencies.disbursement', CAST(MONEDA AS CHAR), COUNT(*)
FROM EmisionCheque GROUP BY MONEDA
UNION ALL
SELECT 'currencies.fx_transaction', CAST(MONEDA AS CHAR), COUNT(*)
FROM Transaccion_Divisas GROUP BY MONEDA
UNION ALL
SELECT 'domains.receipt_type', TipoDept, COUNT(*)
FROM Recibos GROUP BY TipoDept
UNION ALL
SELECT 'domains.receivable_direction', DebCre, COUNT(*)
FROM CargaDocs GROUP BY DebCre
UNION ALL
SELECT 'domains.bank_reconciled', CAST(CONCILIADA AS CHAR), COUNT(*)
FROM Transaccion_Bancaria GROUP BY CONCILIADA
UNION ALL
SELECT 'domains.soft_delete.property', CAST(DelReg AS CHAR), COUNT(*)
FROM PROPIETARIO GROUP BY DelReg;
