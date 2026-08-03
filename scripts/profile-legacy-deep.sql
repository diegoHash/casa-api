USE movedb;

SELECT CODIGO_COND, UPPER(TRIM(APTO)) AS property_code, COUNT(*) AS rows_in_group
FROM PROPIETARIO
WHERE COALESCE(DelReg, 0) = 0
GROUP BY CODIGO_COND, UPPER(TRIM(APTO))
HAVING COUNT(*) > 1;

SELECT CODIGO_COND,
       COUNT(*) AS rows_total,
       SUM(ALICUOTAT > 1) AS aliquot_above_one,
       MIN(ALICUOTAT) AS minimum_aliquot,
       MAX(ALICUOTAT) AS maximum_aliquot,
       SUM(ALICUOTAT) AS total_aliquot
FROM PROPIETARIO
WHERE COALESCE(DelReg, 0) = 0
GROUP BY CODIGO_COND;

SELECT inferred_kind, COUNT(*) AS rows_count
FROM (
  SELECT CASE
    WHEN UPPER(APTO) LIKE '%TH%' THEN 'TOWNHOUSE'
    WHEN UPPER(APTO) LIKE 'CC%' THEN 'COMMERCIAL'
    WHEN UPPER(APTO) IN ('HOTEL', 'EDIFADM') THEN 'SPECIAL_REVIEW'
    ELSE 'APARTMENT'
  END AS inferred_kind
  FROM PROPIETARIO
  WHERE CODIGO_COND = '001' AND COALESCE(DelReg, 0) = 0
) classified
GROUP BY inferred_kind
ORDER BY inferred_kind;

SELECT Codigo_Cond, CodProptD, NroDocD, COUNT(*) AS movements,
       SUM(MontoDocD) AS amount
FROM CargaDocsDetalle x
WHERE NOT EXISTS (
  SELECT 1
  FROM CargaDocs d
  WHERE d.Codigo_Cond = x.Codigo_Cond
    AND d.CodPropt = x.CodProptD
    AND d.NroDoc = x.NroDocD
)
GROUP BY Codigo_Cond, CodProptD, NroDocD;

SELECT Codigo_Cond, NroRecD, COUNT(*) AS detail_rows,
       SUM(MontoPagado) AS amount
FROM RecibosDetalle d
WHERE NOT EXISTS (
  SELECT 1 FROM Recibos r
  WHERE r.Codigo_Cond = d.Codigo_Cond AND r.NroRec = d.NroRecD
)
GROUP BY Codigo_Cond, NroRecD;

WITH receipt_totals AS (
  SELECT r.Codigo_Cond, r.NroRec, r.MesRec, r.AnhoRec,
         COALESCE(r.MontoRec, 0) AS received,
         COALESCE(r.MAjuste, 0) AS adjustment,
         COALESCE(r.Monto_OI, 0) AS other_income,
         COALESCE(SUM(CASE
           WHEN COALESCE(d.DelReg, 0) = 0 AND d.DebCred = 'C' THEN d.MontoPagado
           WHEN COALESCE(d.DelReg, 0) = 0 THEN -d.MontoPagado
           ELSE 0
         END), 0) AS applied
  FROM Recibos r
  LEFT JOIN RecibosDetalle d
    ON d.Codigo_Cond = r.Codigo_Cond AND d.NroRecD = r.NroRec
  WHERE COALESCE(r.DelReg, 0) = 0
  GROUP BY r.Codigo_Cond, r.NroRec, r.MesRec, r.AnhoRec,
           r.MontoRec, r.MAjuste, r.Monto_OI
)
SELECT
  SUM(ABS(received - applied) > 0.01) AS formula_received,
  SUM(ABS((received - other_income) - applied) > 0.01) AS formula_less_other_income,
  SUM(ABS((received + adjustment - other_income) - applied) > 0.01) AS formula_plus_adjustment_less_income,
  SUM(ABS((received - adjustment - other_income) - applied) > 0.01) AS formula_less_adjustment_less_income,
  MAX(ABS(received - applied)) AS maximum_simple_difference
FROM receipt_totals;

SELECT COUNT(*) AS journal_headers_with_total_mismatch
FROM Comprobante h
JOIN (
  SELECT ID_COMP, SUM(COALESCE(DEBE, 0)) AS debit, SUM(COALESCE(HABER, 0)) AS credit
  FROM Comprobante_Detalle
  GROUP BY ID_COMP
) d ON d.ID_COMP = h.ID_COMP
WHERE ABS(COALESCE(h.MONTO_DEBE, 0) - d.debit) > 0.01
   OR ABS(COALESCE(h.MONTO_HABER, 0) - d.credit) > 0.01;

SELECT
  COUNT(*) AS missing_account_lines,
  SUM(old.ID_CUE IS NOT NULL) AS resolved_in_plan_old,
  COUNT(DISTINCT d.ID_CUE) AS distinct_missing_accounts
FROM Comprobante_Detalle d
LEFT JOIN PLAN current_plan ON current_plan.ID_CUE = d.ID_CUE
LEFT JOIN PLAN_old old ON old.ID_CUE = d.ID_CUE
WHERE current_plan.ID_CUE IS NULL;

SELECT d.ID_CUE, d.CODIGO_CUE, COUNT(*) AS line_count,
       SUM(COALESCE(d.DEBE,0)) AS debit,
       SUM(COALESCE(d.HABER,0)) AS credit,
       MAX(old.ID_CUE IS NOT NULL) AS exists_in_old_plan
FROM Comprobante_Detalle d
LEFT JOIN PLAN current_plan ON current_plan.ID_CUE = d.ID_CUE
LEFT JOIN PLAN_old old ON old.ID_CUE = d.ID_CUE
WHERE current_plan.ID_CUE IS NULL
GROUP BY d.ID_CUE, d.CODIGO_CUE
ORDER BY line_count DESC
LIMIT 20;

SELECT
  COUNT(*) AS future_fx_transactions,
  MIN(FechaTB) AS first_future_date,
  MAX(FechaTB) AS last_future_date,
  SUM(MontoTB) AS future_amount
FROM Transaccion_Divisas
WHERE FechaTB > '2026-07-24 23:59:59';

SELECT
  COUNT(*) AS ledger_rows_before_2020,
  MIN(Fecha) AS minimum_date,
  MAX(Fecha) AS maximum_date
FROM Libro_Mayor
WHERE Fecha < '2020-01-01';

SELECT YEAR(Fecha) AS ledger_year, COUNT(*) AS rows_count
FROM Libro_Mayor
WHERE Fecha IS NOT NULL
GROUP BY YEAR(Fecha)
ORDER BY ledger_year;

SELECT
  SUM(COALESCE(DelReg,0) <> 0) AS deleted_receivables,
  SUM(COALESCE(DelReg,0) <> 0 AND ABS(COALESCE(SaldoDoc,0)) > 0.01) AS deleted_with_balance
FROM CargaDocs;

SELECT
  SUM(COALESCE(DelReg,0) <> 0) AS deleted_receipts,
  SUM(COALESCE(DelReg,0) <> 0 AND ABS(COALESCE(MontoRec,0)) > 0.01) AS deleted_with_amount
FROM Recibos;

SELECT
  COUNT(*) AS current_old_rows_with_differences
FROM PROPIETARIO p
JOIN PROPIETARIO_OLD o ON o.ID_PRO = p.ID_PRO
WHERE NOT (
  p.APTO <=> o.APTO
  AND p.REPRESENTANTE <=> o.REPRESENTANTE
  AND p.CEDULA <=> o.CEDULA
  AND p.ALICUOTAT <=> o.ALICUOTAT
  AND p.ALICUOTAC <=> o.ALICUOTAC
  AND p.TELEFONO <=> o.TELEFONO
  AND p.DIRECCION <=> o.DIRECCION
  AND p.E_MAIL <=> o.E_MAIL
  AND p.DelReg <=> o.DelReg
);
