# CASA API

Backend independiente para el ecosistema CASA. Expone una API multi-condominio,
mantiene el aislamiento por comunidad y concentra las operaciones
transaccionales, vigencias y auditoría.

## Requisitos

- Node.js 24
- npm 11
- MySQL 8.4
- Docker Desktop opcional, recomendado para desarrollo local

## Inicio local

1. Copiar `.env.example` como `.env`.
2. Levantar MySQL con `docker compose up -d`.
3. Ejecutar `npm install`.
4. Ejecutar `npm run prisma:generate`.
5. Crear la primera migración con `npm run prisma:migrate:dev -- --name init`.
6. Iniciar la API con `npm run start:dev`.

La API queda en `http://localhost:3001/v1` y su salud se consulta en
`GET /v1/health`.

El MySQL aislado de CASA se publica en `localhost:3307` para no interferir con
instalaciones locales que utilicen el puerto predeterminado `3306`.

Las migraciones de desarrollo utilizan `casa_shadow`, una base temporal
separada con permisos restringidos al usuario local de CASA.

## Autenticación

El usuario root inicial se crea de forma idempotente a partir de
`ROOT_BOOTSTRAP_EMAIL` y `ROOT_BOOTSTRAP_PASSWORD`. La contraseña nunca se
persiste en texto plano. En producción ambos valores deben provenir del gestor
de secretos del entorno.

El inicio de sesión no selecciona una comunidad automáticamente. El flujo es:

1. `POST /v1/auth/login`
2. `GET /v1/auth/contexts`
3. `POST /v1/auth/select-context` cuando corresponda

La API también permite renovar o revocar sesiones, cerrar todas las sesiones
y cambiar la contraseña mediante `POST /v1/auth/refresh`,
`POST /v1/auth/logout`, `POST /v1/auth/logout-all` y
`POST /v1/auth/change-password`.

Los access tokens son breves y los refresh tokens son opacos, rotativos,
revocables y almacenados únicamente mediante su hash.

## Etapas 01 y 02

La etapa 01 expone la gestión exclusiva de plataforma bajo
`/v1/platform/clients`:

- alta integral de cliente, comunidad, licencia e incorporación;
- consulta general e individual de clientes;
- actualización documentada del estado de solvencia;
- conciliación del pago mensual y renovación automática de la licencia;
- revocación de licencia con motivo y trazabilidad.

La etapa 02 utiliza siempre la comunidad incluida en el token seleccionado.
Los cuerpos de las solicitudes no aceptan un `communityId`, de modo que un
cliente no puede cambiar de comunidad manipulando el navegador.

El núcleo se consulta en `GET /v1/core/snapshot` y permite:

- actualizar la identidad y el modelo administrativo de la comunidad;
- registrar personas globales y vincularlas a su directorio privado;
- crear edificios, centros comerciales e inmuebles;
- mantener alícuotas, propietarios, junta y personal con vigencia histórica;
- registrar concesiones con canon fijo;
- impedir simultáneamente una relación laboral y una designación en junta.

La tesorería inicial se consulta en `GET /v1/treasury/snapshot` y permite
registrar cuentas bancarias y métodos de pago por transferencia, pago móvil o
efectivo. Los anticipos y cruces de cuenta no son métodos configurables; serán
movimientos contables del libro financiero.

## Fronteras iniciales

- `platform`: clientes, licencias e incorporación.
- `core`: comunidades, personas, inmuebles y relaciones.
- `treasury`: cuentas y métodos de pago.
- `audit`: bitácora inmutable.

El frontend permanece en el repositorio independiente `casa-home`.
