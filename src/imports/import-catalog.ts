export interface ImportTargetField {
  key: string;
  label: string;
  required: boolean;
}

export interface ImportTargetEntity {
  key: string;
  label: string;
  description: string;
  fields: ImportTargetField[];
}

export const IMPORT_TARGET_CATALOG: ImportTargetEntity[] = [
  {
    key: 'property_location',
    label: 'Ubicaciones inmobiliarias',
    description:
      'Edificios, torres o centros comerciales que agrupan inmuebles.',
    fields: [
      { key: 'kind', label: 'Tipo de ubicación', required: true },
      { key: 'code', label: 'Código', required: true },
      { key: 'name', label: 'Nombre', required: true },
    ],
  },
  {
    key: 'property',
    label: 'Inmuebles',
    description: 'Apartamentos, townhouses y locales comerciales.',
    fields: [
      { key: 'code', label: 'Código único', required: true },
      { key: 'kind', label: 'Categoría', required: true },
      { key: 'locationCode', label: 'Código de ubicación', required: false },
      { key: 'aliquot', label: 'Alícuota', required: false },
      { key: 'status', label: 'Estado', required: false },
    ],
  },
  {
    key: 'person',
    label: 'Personas',
    description: 'Directorio único de personas naturales o jurídicas.',
    fields: [
      { key: 'documentType', label: 'Tipo de documento', required: true },
      { key: 'documentNumber', label: 'Número de documento', required: true },
      { key: 'firstName', label: 'Nombre', required: true },
      { key: 'lastName', label: 'Apellido o razón social', required: true },
      { key: 'phone', label: 'Teléfono', required: false },
      { key: 'email', label: 'Correo', required: false },
    ],
  },
  {
    key: 'ownership',
    label: 'Propiedad',
    description: 'Relaciones históricas entre personas e inmuebles.',
    fields: [
      {
        key: 'personDocument',
        label: 'Documento del propietario',
        required: true,
      },
      { key: 'propertyCode', label: 'Código del inmueble', required: true },
      { key: 'ownershipPercentage', label: 'Participación', required: true },
      { key: 'startsOn', label: 'Vigente desde', required: true },
      { key: 'endsOn', label: 'Vigente hasta', required: false },
    ],
  },
  {
    key: 'employment',
    label: 'Personal',
    description: 'Relaciones laborales, profesionales o contractuales.',
    fields: [
      { key: 'personDocument', label: 'Documento', required: true },
      { key: 'position', label: 'Cargo', required: true },
      { key: 'department', label: 'Departamento', required: true },
      { key: 'engagementType', label: 'Tipo de vinculación', required: true },
      { key: 'startsOn', label: 'Inicio', required: true },
      { key: 'endsOn', label: 'Fin', required: false },
    ],
  },
  {
    key: 'board_appointment',
    label: 'Junta de condominio',
    description: 'Designaciones y cargos históricos de la junta.',
    fields: [
      { key: 'personDocument', label: 'Documento', required: true },
      { key: 'propertyCode', label: 'Inmueble representado', required: false },
      { key: 'position', label: 'Cargo', required: true },
      { key: 'startsOn', label: 'Inicio', required: true },
      { key: 'endsOn', label: 'Fin', required: false },
    ],
  },
  {
    key: 'concession',
    label: 'Concesiones',
    description: 'Explotaciones autorizadas con canon fijo y sin alícuota.',
    fields: [
      { key: 'code', label: 'Código', required: true },
      { key: 'name', label: 'Nombre', required: true },
      { key: 'holderName', label: 'Titular', required: true },
      { key: 'holderDocument', label: 'Documento del titular', required: true },
      { key: 'monthlyAmount', label: 'Canon mensual', required: true },
      { key: 'currency', label: 'Moneda', required: true },
      { key: 'startsOn', label: 'Inicio', required: true },
    ],
  },
  {
    key: 'bank_account',
    label: 'Cuentas bancarias',
    description: 'Cuentas receptoras de la comunidad.',
    fields: [
      { key: 'bankName', label: 'Banco', required: true },
      { key: 'holder', label: 'Titular', required: true },
      { key: 'holderRif', label: 'RIF del titular', required: true },
      { key: 'accountNumber', label: 'Número de cuenta', required: true },
      { key: 'accountType', label: 'Tipo de cuenta', required: true },
      { key: 'currency', label: 'Moneda', required: true },
    ],
  },
  {
    key: 'payment_method',
    label: 'Métodos de pago',
    description: 'Transferencia, pago móvil o efectivo.',
    fields: [
      { key: 'type', label: 'Tipo', required: true },
      { key: 'label', label: 'Nombre visible', required: true },
      { key: 'currency', label: 'Moneda', required: true },
      { key: 'accountNumber', label: 'Cuenta relacionada', required: false },
      { key: 'mobilePhone', label: 'Teléfono pago móvil', required: false },
      { key: 'mobileDocument', label: 'Documento pago móvil', required: false },
    ],
  },
];
