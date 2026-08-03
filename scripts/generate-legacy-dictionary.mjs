import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const inventoryPath = resolve(
  process.argv[2] ??
    "C:/Users/Diego ASR/Documents/CaribbeanOne/casa-home/docs/legacy-audit/inventory.json",
);
const outputPath = resolve(
  process.argv[3] ??
    "C:/Users/Diego ASR/Documents/CaribbeanOne/casa-home/docs/legacy-audit/DICCIONARIO_DATOS_LEGACY.md",
);
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));

const meta = {
  Acumulado: ["Saldos contables anuales desnormalizados por cuenta, mes y moneda.", "Importante", "ARCHIVE_RECOMPUTE", "AccountingBalanceSnapshot"],
  Alicuotas: ["Catálogo de alícuotas o reglas reutilizables; no sustituye la alícuota grabada en PROPIETARIO.", "Importante", "VALIDATE_MIGRATE", "AliquotRule"],
  AuditoriaU: ["Bitácora textual de operaciones de usuario.", "Crítica", "ARCHIVE_MIGRATE", "LegacyAuditEvent"],
  Aviso: ["Cabecera del aviso de cobro periódico de la comunidad.", "Crítica", "MIGRATE", "BillingRun"],
  Balance_Comprobacion: ["Resultado materializado de un balance de comprobación.", "Secundaria", "ARCHIVE_RECOMPUTE", "TrialBalanceSnapshot"],
  BANCO: ["Catálogo de bancos.", "Importante", "MIGRATE", "Bank"],
  Basededatos: ["Configuración local de rutas de archivos Access por ejercicio.", "Obsoleta", "DISCARD_AFTER_ARCHIVE", "LegacySourceReference"],
  BENEFICIARIO: ["Maestro de beneficiarios o proveedores a quienes se realizan pagos.", "Crítica", "MIGRATE", "Vendor"],
  BENEFICIARIO_OLD: ["Copia histórica del maestro de beneficiarios.", "Secundaria", "ARCHIVE_COMPARE", "LegacyVendorSnapshot"],
  CargaDocs: ["Libro operativo de documentos por cobrar y saldos por inmueble/código de propietario.", "Crítica", "MIGRATE", "Receivable"],
  CargaDocsDetalle: ["Aplicaciones y movimientos que afectan documentos por cobrar.", "Crítica", "MIGRATE", "ReceivableApplication"],
  CargaDocsORI: ["Copia original o base histórica de documentos por cobrar.", "Crítica", "ARCHIVE_RECONCILE", "LegacyReceivableSnapshot"],
  CobranzaRes: ["Resumen mensual desnormalizado de cobranza.", "Secundaria", "ARCHIVE_RECOMPUTE", "CollectionSnapshot"],
  Comprobante: ["Cabecera de comprobante o asiento contable.", "Crítica", "MIGRATE", "JournalEntry"],
  Comprobante_Detalle: ["Partidas de débito y crédito de cada comprobante.", "Crítica", "MIGRATE", "JournalLine"],
  CONCEPTO_FACT: ["Catálogo de conceptos de gasto/cobro y sus cuentas contables y reglas de distribución.", "Crítica", "MIGRATE", "ChargeConcept"],
  ConcOtrosIng: ["Catálogo de conceptos de otros ingresos.", "Importante", "MIGRATE", "RevenueConcept"],
  Concpto_Estad: ["Acumulado mensual por concepto de gasto.", "Secundaria", "ARCHIVE_RECOMPUTE", "ExpenseAnalyticsSnapshot"],
  CONDOMINIO: ["Maestro y configuración financiera de entidades administradas.", "Crítica", "MIGRATE_WITH_SPLIT", "Community"],
  CONDOMINIO_OLD: ["Copia histórica del maestro de condominios.", "Secundaria", "ARCHIVE_COMPARE", "LegacyCommunitySnapshot"],
  Conjuntos: ["Maestro previsto para agrupaciones de condominios; está vacío en este dump.", "Secundaria", "VALIDATE_DISCARD", "CommunityGroup"],
  ContAvisoCobro: ["Totales mensuales materializados de avisos de cobro.", "Secundaria", "ARCHIVE_RECOMPUTE", "BillingRunSnapshot"],
  ControlDNI: ["Control de depósitos no identificados y su posterior asociación a recibos/propietarios.", "Crítica", "MIGRATE", "UnidentifiedPayment"],
  CUENTA_BANC: ["Cuentas bancarias de las entidades administradas y sus cuentas contables asociadas.", "Crítica", "MIGRATE", "BankAccount"],
  Cuenta_BancSaldo: ["Saldos bancarios mensuales desnormalizados por cuenta.", "Importante", "ARCHIVE_RECONCILE", "BankBalanceSnapshot"],
  ChqDevOtrosCarg: ["Cheques devueltos y otros cargos aplicables a cuentas por cobrar.", "Importante", "MIGRATE_IF_PRESENT", "ReturnedPaymentCharge"],
  ChqDevOtrosCargold: ["Versión anterior de cheques devueltos y otros cargos.", "Secundaria", "ARCHIVE_COMPARE", "LegacyReturnedPaymentCharge"],
  Detalle_Aviso: ["Detalle de conceptos, gastos, reintegros y usos incluidos en un aviso.", "Crítica", "MIGRATE", "BillingRunLine"],
  DetAvisoPropt: ["Asignación de conceptos específicos del aviso a determinados propietarios/inmuebles.", "Crítica", "MIGRATE", "ChargeTarget"],
  Doc_De_Cobro: ["Catálogo de tipos de documentos por cobrar y reglas contables.", "Importante", "MIGRATE", "ReceivableType"],
  EmisionCheque: ["Cabecera de egresos, cheques o transferencias a beneficiarios.", "Crítica", "MIGRATE", "Disbursement"],
  EmisionCheque_OLD: ["Copia histórica de egresos emitidos.", "Importante", "ARCHIVE_RECONCILE", "LegacyDisbursementSnapshot"],
  EmisionChequeDeta: ["Detalle por concepto de los egresos emitidos.", "Crítica", "MIGRATE", "DisbursementLine"],
  EmisionChequeDeta_OLD: ["Copia histórica del detalle de egresos.", "Importante", "ARCHIVE_RECONCILE", "LegacyDisbursementLineSnapshot"],
  Empresa: ["Identidad de la empresa operadora del software legacy, no necesariamente del condominio.", "Importante", "VALIDATE_ARCHIVE", "LegacyOperator"],
  Factura: ["Modelo previsto para facturas/gastos; no tiene registros en el dump.", "Importante", "VALIDATE_DISCARD", "VendorInvoice"],
  InteresesMora: ["Cálculos de intereses moratorios por documento; tabla vacía en el dump.", "Importante", "MIGRATE_IF_PRESENT", "LateFeeAssessment"],
  Libro_Mayor: ["Libro mayor materializado para reportes.", "Importante", "ARCHIVE_RECONCILE", "GeneralLedgerSnapshot"],
  Perfil_User: ["Matriz horizontal de permisos por usuario y función.", "Crítica", "TRANSFORM", "RolePermission"],
  PLAN: ["Plan de cuentas contables por entidad administrada.", "Crítica", "MIGRATE", "LedgerAccount"],
  PLAN_old: ["Copia anterior del plan contable.", "Importante", "ARCHIVE_COMPARE", "LegacyLedgerAccountSnapshot"],
  PROPIETARIO: ["Registro mixto que combina inmueble, titular/representante, contacto y alícuota.", "Crítica", "MIGRATE_WITH_SPLIT", "Person+Property+Ownership"],
  PROPIETARIO_OLD: ["Copia histórica del registro mixto propietario/inmueble.", "Crítica", "ARCHIVE_RECONCILE", "LegacyOwnershipSnapshot"],
  Recibos: ["Cabecera de recibos de pago, medio, depósito, tasa y propietario.", "Crítica", "MIGRATE", "PaymentReceipt"],
  RecibosDetalle: ["Aplicación de un recibo a documentos por cobrar.", "Crítica", "MIGRATE", "PaymentAllocation"],
  RecibosOtrosing: ["Otros ingresos incluidos en un recibo.", "Importante", "MIGRATE", "PaymentRevenueLine"],
  Tasas: ["Tasas de cambio BCV y paralela por fecha.", "Crítica", "MIGRATE_BCV_ONLY", "ExchangeRate"],
  TBLRComisiones: ["Tabla auxiliar de reporte para comisiones de cobranza.", "Secundaria", "ARCHIVE_RECOMPUTE", "CollectionCommissionSnapshot"],
  TBLRP01: ["Tabla auxiliar de reporte de pagos agregados.", "Secundaria", "ARCHIVE_RECOMPUTE", "PaymentReportSnapshot"],
  TBLRP02: ["Tabla auxiliar secundaria de pagos agregados.", "Secundaria", "ARCHIVE_RECOMPUTE", "PaymentReportSnapshot"],
  TempContRecibo: ["Área temporal de contabilización y clasificación de recibos.", "Secundaria", "DISCARD_AFTER_RECONCILE", "PaymentPostingStaging"],
  TempContReciboAc: ["Área temporal de partidas contables generadas desde recibos.", "Secundaria", "DISCARD_AFTER_RECONCILE", "PaymentJournalStaging"],
  TempMovCxC: ["Área temporal para verificar movimientos y diferencias de cuentas por cobrar.", "Secundaria", "DISCARD_AFTER_RECONCILE", "ReceivableValidationStaging"],
  TempVerifSaldoCxC: ["Resultado temporal de verificación de saldos de cuentas por cobrar.", "Importante", "ARCHIVE_EXCEPTIONS", "ReceivableReconciliationIssue"],
  TIPO_COMPROBANTE: ["Catálogo de tipos de comprobante contable.", "Importante", "MIGRATE", "JournalEntryType"],
  TIPO_DOC_CXC: ["Modelo alternativo/vacío de tipos de documento por cobrar.", "Secundaria", "COMPARE_WITH_DOC_DE_COBRO", "ReceivableType"],
  TIPO_GASTO: ["Categorías vigentes de gastos.", "Crítica", "MIGRATE", "ExpenseCategory"],
  TIPO_GASTO_ORIGINAL: ["Catálogo original de categorías de gasto.", "Importante", "ARCHIVE_COMPARE", "LegacyExpenseCategorySnapshot"],
  Tipo_TransBanc: ["Catálogo de tipos de transacción bancaria y su contrapartida contable.", "Importante", "MIGRATE", "BankTransactionType"],
  TipoCambio: ["Tabla alternativa vacía de tasas de cambio.", "Secundaria", "COMPARE_WITH_TASAS", "ExchangeRate"],
  Transaccion_Bancaria: ["Movimientos bancarios conciliables en moneda principal.", "Crítica", "MIGRATE", "BankTransaction"],
  Transaccion_Divisas: ["Movimientos bancarios de divisas con moneda y tasa.", "Crítica", "MIGRATE", "BankTransaction"],
  USUARIO: ["Usuarios legacy con credenciales reversibles en texto plano.", "Crítica", "IDENTITY_ONLY_RESET_PASSWORD", "AppUser"],
};

const reportPurposes = {
  ImpAnaXCta: "Reporte materializado de analítico por cuenta.",
  ImpAvisoCV: "Detalle expandido del aviso de cobro para impresión/verificación.",
  ImpAvisoRes: "Resumen del aviso por propietario.",
  ImpAvisoVerif: "Área de verificación del aviso antes de imprimir.",
  ImpCompEgreso: "Comprobante de egreso preparado para impresión.",
  ImpConcilBanc: "Reporte de conciliación bancaria.",
  ImpDocsPendP: "Documentos pendientes por propietario.",
  ImpDocsPendPCart: "Antigüedad mensual de deuda para cartelera.",
  ImpEdoCtaProp: "Estado de cuenta materializado del propietario.",
  ImpFGIniFin: "Resumen de fondo/gasto inicial y final del período.",
  ImpReciboCajaDet: "Detalle imprimible de recibo de caja.",
  ImpReciboResOI: "Resumen imprimible de recibos y otros ingresos.",
  ImpReciboResOIAc: "Partidas contables agregadas del resumen de recibos.",
  ImpSaldoPropt: "Saldo resumido por propietario.",
  ImpSubAvisoCI: "Subreporte de cargos individuales del aviso.",
  ImpSubAvisoV: "Subreporte de conceptos del aviso.",
  ImpSubAvisoVFR: "Subreporte de fondo de reserva del aviso.",
  ImpSubIBan: "Subreporte bancario de recibos.",
  ImpSubIRecResC: "Subreporte de contrapartidas contables de recibos.",
  ImpSubIRecResD: "Subreporte de documentos aplicados en recibos.",
  ImpSubSalPropt: "Subreporte de débitos y créditos por propietario.",
  ImpTransCxC: "Resumen imprimible de transacciones de cuentas por cobrar.",
  ImpVDTransf: "Verificación de documentos transferidos al auxiliar de cobro.",
};

function tableMeta(name) {
  if (meta[name]) return meta[name];
  if (/^EmiTemp_\d{3}$/.test(name)) {
    const slot = name.slice(-3);
    return [
      `Área temporal de detalle de egresos asociada al slot o entidad ${slot}; replica EmisionChequeDeta.`,
      "Obsoleta",
      "DISCARD_AFTER_RECONCILE",
      "DisbursementStaging",
    ];
  }
  if (reportPurposes[name]) {
    return [
      reportPurposes[name],
      "Secundaria",
      "ARCHIVE_RECOMPUTE",
      "ReportingSnapshot",
    ];
  }
  return [
    "Propósito no confirmado; requiere validación funcional.",
    "Secundaria",
    "REVIEW",
    "LegacyArchive",
  ];
}

const exactTarget = {
  CONDOMINIO: {
    CODIGO_COND: "Community.legacyCode",
    NOMBRE: "Community.name",
    DIRECCION: "Community.address",
    TELEFONO: "Community.phone",
    CONTACTO: "Client.contactName",
    FECHA_ING: "Community.legacyStartedAt",
    RIF: "Community.rif",
    Email: "Community.email",
    DirLogo: "Community.branding.logoAssetId",
    PORC_FOND: "BillingPolicy.reserveFundPercentage",
    DIASVENCIM: "BillingPolicy.dueDays",
    PORCINTM: "LateFeePolicy.rate",
    FECHA_INICIAL: "FiscalPeriod.startsOn",
    FECHA_FINAL: "FiscalPeriod.endsOn",
    MES: "FiscalPeriod.currentMonth",
    ANO: "FiscalPeriod.currentYear",
    TIPOCAMBIO: "LegacyExchangeRateReference",
  },
  PROPIETARIO: {
    CODIGO_PRO: "Property.legacyCode",
    APTO: "Property.code",
    REPRESENTANTE: "Person/LegalEntity.displayName",
    CEDULA: "PartyIdentification.documentNumber",
    ALICUOTAT: "PropertyAliquotPeriod.generalAliquot",
    ALICUOTAC: "PropertyAliquotPeriod.commercialAliquot",
    TELEFONO: "PartyContact.phone",
    DIRECCION: "PartyContact.address",
    E_MAIL: "PartyContact.email",
    CODIGO_COND: "Community.legacyCode",
    ID_PRO: "LegacyKeyMap.sourceKey",
  },
  Aviso: {
    CODIGO_AVI: "BillingRun.legacyNumber",
    FECHA_EMISION: "BillingRun.issuedOn",
    FECHA_VENCIMIENTO: "BillingRun.dueOn",
    F_Elaboracion: "BillingRun.preparedOn",
    ANO: "BillingPeriod.year",
    MES: "BillingPeriod.month",
    SALDO_ANT: "BillingRun.openingReceivable",
    OBSERVACION: "BillingRun.notes",
    TOTAL_CUOTA: "BillingRun.communitySubtotal",
    MONTO_PAGAR: "BillingRun.totalAmount",
    PORC_FON: "BillingRun.reservePercentage",
    MONTO_FONDO: "BillingRun.reserveAmount",
    Tasa: "BillingRun.exchangeRate",
    ACTCambio: "BillingRun.exchangeRate",
    "AMontoUS$": "BillingRun.amountUsd",
    ID_AVI: "LegacyKeyMap.sourceKey",
  },
  CargaDocs: {
    CodPropt: "Receivable.propertyId (resolved)",
    TipoDoc: "Receivable.typeId (resolved)",
    NroDoc: "Receivable.documentNumber",
    FechaEmi: "Receivable.issuedOn",
    FechaVen: "Receivable.dueOn",
    MontoDoc: "Receivable.originalAmount",
    SaldoDoc: "Receivable.openAmount",
    MontoDocAlt: "Receivable.originalAmountAlternate",
    SaldoDocAlt: "Receivable.openAmountAlternate",
    DebCre: "Receivable.direction",
    CTipoCambio: "Receivable.exchangeRate",
    "CMontoUS$": "Receivable.amountUsd",
  },
  Recibos: {
    NroRec: "PaymentReceipt.number",
    CodProptRec: "Payment.payerPropertyId (resolved)",
    CodBanRec: "Payment.destinationBankId (resolved)",
    NroCtaBan: "Payment.destinationBankAccountId (resolved)",
    NroDeptBan: "Payment.reference",
    MontoRec: "Payment.amount",
    FechaPago: "Payment.paidOn",
    FechaDept: "Payment.depositedOn",
    TipoDept: "Payment.methodLegacyCode",
    NroCheque: "Payment.checkNumber",
    BancoChq: "Payment.originBank",
    Montoalterno: "Payment.amountAlternate",
    Tasa: "Payment.exchangeRate",
    Usuario: "Payment.recordedByUserId (resolved)",
  },
  USUARIO: {
    Codigo: "AppUser.legacyCode",
    USUARIO: "AppUser.displayName",
    CLAVE: "NO MIGRAR; forzar restablecimiento",
    CONDICION: "AppUser.status",
    FECHA1: "LegacyLoginEvent",
    HORA1: "LegacyLoginEvent",
    FECHA2: "LegacyLoginEvent",
    HORA2: "LegacyLoginEvent",
  },
};

const targetByTable = {
  BANCO: "Bank",
  CUENTA_BANC: "BankAccount",
  BENEFICIARIO: "Vendor",
  BENEFICIARIO_OLD: "LegacyVendorSnapshot",
  PLAN: "LedgerAccount",
  PLAN_old: "LegacyLedgerAccountSnapshot",
  Comprobante: "JournalEntry",
  Comprobante_Detalle: "JournalLine",
  CONCEPTO_FACT: "ChargeConcept",
  TIPO_GASTO: "ExpenseCategory",
  TIPO_GASTO_ORIGINAL: "LegacyExpenseCategorySnapshot",
  Detalle_Aviso: "BillingRunLine",
  DetAvisoPropt: "ChargeTarget",
  CargaDocsDetalle: "ReceivableApplication",
  RecibosDetalle: "PaymentAllocation",
  RecibosOtrosing: "PaymentRevenueLine",
  EmisionCheque: "Disbursement",
  EmisionChequeDeta: "DisbursementLine",
  Transaccion_Bancaria: "BankTransaction",
  Transaccion_Divisas: "BankTransaction",
  Tasas: "ExchangeRate",
  Perfil_User: "RolePermission",
  AuditoriaU: "LegacyAuditEvent",
};

function targetFor(tableName, fieldName, fallbackEntity) {
  if (exactTarget[tableName]?.[fieldName]) return exactTarget[tableName][fieldName];
  if (/^EmiTemp_/.test(tableName) || /^Imp/.test(tableName) || /^Temp/.test(tableName)) {
    return `${fallbackEntity}.legacy.${fieldName}`;
  }
  const base = targetByTable[tableName] ?? fallbackEntity;
  if (/^(?:CODIGO_COND|Codigo_Cond|CODIGO_COND)$/i.test(fieldName)) {
    return `${base}.communityId (resolver por LegacyKeyMap)`;
  }
  if (/^(?:ActReg|DelReg)$/i.test(fieldName)) {
    return fieldName.toLowerCase() === "delreg"
      ? `${base}.legacyDeleted/status`
      : `${base}.legacyAuditMetadata`;
  }
  return `${base}.${fieldName}`;
}

function interpretation(fieldName) {
  const exact = {
    ActReg: "Metadato legacy de modificación; semántica no confirmada.",
    DelReg: "Indicador de eliminación lógica; validar valores y uso real.",
    DebCre: "Naturaleza débito/crédito codificada.",
    DebCred: "Naturaleza débito/crédito codificada.",
    MES: "Mes contable o de facturación.",
    ANO: "Año contable o de facturación.",
    Anho: "Año contable o de facturación.",
    Tasa: "Tasa de conversión aplicada a la operación.",
    MONEDA: "Código numérico de moneda sin catálogo relacional.",
  };
  if (exact[fieldName]) return exact[fieldName];
  if (/^ID_/i.test(fieldName)) return "Identificador compuesto o técnico del sistema legacy.";
  if (/^COD(?:IGO)?_/i.test(fieldName)) return "Código funcional usado como referencia implícita.";
  if (/FECHA/i.test(fieldName)) return "Fecha asociada al registro o proceso.";
  if (/MONTO|SALDO|DEBE|HABER/i.test(fieldName)) return "Importe monetario; DOUBLE requiere conversión controlada a DECIMAL.";
  if (/DESCRIP|DETALLE|CONCEP|OBSERV/i.test(fieldName)) return "Texto descriptivo o concepto de negocio.";
  if (/NRO|NUM_/i.test(fieldName)) return "Número o referencia funcional legacy.";
  return `Atributo legacy «${fieldName}»; semántica exacta por validar con reglas y pantallas originales.`;
}

const lines = [
  "# Diccionario de datos del sistema legacy",
  "",
  "> Generado desde `dump.sql`. Los propósitos marcados como hipótesis deben validarse con Luis Venezuela y con las pantallas originales. `?` significa nullable; `!` significa obligatorio según DDL.",
  "> La obligatoriedad describe el DDL, no garantiza cumplimiento: el perfil detectó valores NULL en campos declarados NOT NULL.",
  "",
  `- Tablas: ${inventory.summary.totalTables}`,
  `- Columnas: ${inventory.summary.totalColumns}`,
  `- Registros: ${inventory.summary.totalRows.toLocaleString("es-VE")}`,
  `- Claves foráneas declaradas: ${inventory.summary.declaredForeignKeys}`,
  "",
];

for (const table of inventory.tables) {
  const [purpose, importance, decision, targetEntity] = tableMeta(table.name);
  lines.push(
    `## ${table.name}`,
    "",
    `- **Propósito probable:** ${purpose}`,
    `- **Nivel de importancia:** ${importance}`,
    `- **Registros:** ${table.rowCount.toLocaleString("es-VE")}`,
    `- **Clave primaria declarada:** ${table.primaryKey.length ? table.primaryKey.join(", ") : "ninguna"}`,
    `- **Índices secundarios:** ${table.indexes.length + table.uniqueIndexes.length}`,
    `- **Claves foráneas declaradas:** ${table.foreignKeys.length}`,
    `- **Decisión preliminar:** \`${decision}\``,
    `- **Destino conceptual:** \`${targetEntity}\``,
    "",
    "| Campo | Tipo y nulabilidad | Interpretación | Nueva entidad recomendada |",
    "|---|---|---|---|",
  );
  for (const column of table.columns) {
    lines.push(
      `| \`${column.name}\` | \`${column.type}${column.nullable ? " ?" : " !"}\` | ${interpretation(column.name)} | \`${targetFor(table.name, column.name, targetEntity)}\` |`,
    );
  }
  lines.push("");
}

writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(
  JSON.stringify(
    {
      outputPath,
      tables: inventory.tables.length,
      columns: inventory.summary.totalColumns,
      lines: lines.length,
    },
    null,
    2,
  ),
);
