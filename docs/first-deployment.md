# Primer despliegue de CASA API

Este runbook prepara el primer lanzamiento de producción. Toma como base AWS EC2,
RDS MySQL y el Application Load Balancer indicado por la configuración actual;
confirma la arquitectura antes de ejecutar cambios en AWS.

## Estado del repositorio

- La API compila con Node.js 24 y el esquema Prisma valida.
- Las migraciones Prisma están en `prisma/migrations`; en producción se aplican
  con `prisma migrate deploy`, nunca con `migrate dev`.
- La API obtiene `casa/prod/database` y `casa/prod/app` de Secrets Manager al
  iniciar en `NODE_ENV=production`.
- S3 requiere `AWS_REGION` y `S3_BUCKET_NAME`; la guía
  [amazon-s3-casabucket-setup.md](./amazon-s3-casabucket-setup.md) documenta el
  bucket, el versionado y los permisos de la instancia.
- `GET /v1/health` es una comprobación básica de proceso; no comprueba RDS ni S3.
- Hay cambios locales todavía sin commit. Antes de publicar hay que revisar y
  consolidar intencionalmente los cambios que formarán el release.

## Configuración del auto deploy

El workflow `.github/workflows/deploy-api.yml` compila cada push a `main` y
también permite un inicio manual. Configura estos GitHub Actions secrets en el
repositorio `casa-api`:

- `EC2_HOST`: IP o hostname público de EC2.
- `EC2_USER`: usuario SSH de EC2.
- `EC2_KEY`: clave privada SSH sin passphrase.

Configura además la variable de repositorio `EC2_KNOWN_HOSTS` con la línea
`known_hosts` verificada para esa instancia. Es un dato público, no una clave
secreta; el workflow la usa para validar la identidad SSH de EC2.

En la instancia, instala Node.js 24, npm y `flock`. El usuario SSH necesita
`sudo` sin contraseña para instalar y administrar `casa-api.service`. El
instance profile debe poder leer `casa/prod/database` y `casa/prod/app` en
Secrets Manager, y usar S3 con los permisos mínimos descritos en
[amazon-s3-casabucket-setup.md](./amazon-s3-casabucket-setup.md).

Antes del primer push a `main`, crea
`~/casa/casa-api/shared/runtime.env` en EC2 con permisos `0600`:

```dotenv
NODE_ENV=production
PORT=3001
AWS_REGION=us-east-1
S3_BUCKET_NAME=casa-s3-prod-066640849393-us-east-1-an
API_PREFIX=v1
WEB_ORIGIN=https://somoscasa.site
TRUSTED_PROXY_CIDRS=<CIDR-de-las-subredes-del-ALB>
```

El workflow conserva los releases anteriores y cambia `current` solo cuando la
migración y el chequeo local de salud terminan bien. Si ya existe una
instalación que use otro gestor de procesos o puerto, hay que adaptar ese
servicio antes de habilitar el workflow.

## Datos que deben quedar confirmados

- Instancia EC2 y que su usuario SSH tenga permisos para escribir en
  `~/casa/casa-api`.
- RDS MySQL 8.4, subredes privadas, grupos de seguridad y política de respaldo.
- Dominio de la API, certificado TLS y origen(es) del frontend para `WEB_ORIGIN`.
- CIDR real del proxy/ALB para `TRUSTED_PROXY_CIDRS`.
- Rol de instancia con acceso de lectura a los dos secretos y a los objetos de
  identidad del bucket. Si Secrets Manager usa una clave KMS propia, añadir el
  permiso de descifrado necesario.

## Configuración de producción

En EC2 configurar como variables no secretas:

```dotenv
NODE_ENV=production
PORT=3001
AWS_REGION=us-east-1
S3_BUCKET_NAME=casa-s3-prod-066640849393-us-east-1-an
API_PREFIX=v1
WEB_ORIGIN=https://<dominio-del-frontend>
TRUSTED_PROXY_CIDRS=<CIDR-real-del-proxy>
```

No crear `DATABASE_URL` ni credenciales estáticas de AWS en un archivo `.env`
de producción. El rol de EC2 proporciona las credenciales AWS; la aplicación
construye la URL de RDS a partir de Secrets Manager. El secreto
`casa/prod/app` debe incluir `JWT_ACCESS_SECRET`, `ROOT_BOOTSTRAP_EMAIL` y
`ROOT_BOOTSTRAP_PASSWORD`. La aplicación valida esa variable en cada arranque;
tras crear el usuario ROOT inicial, rotarla por una contraseña aleatoria fuerte
que no se reutilice en cuentas humanas.

## Secuencia del release

1. Revisar el diff completo, retirar secretos y datos locales, y seleccionar
   los cambios que componen el release. Crear un commit y un tag identificables.
2. Preparar EC2, RDS, rol IAM, bucket privado y TLS; permitir el puerto de la API
   solo desde el proxy. Configurar el proxy para enviar `X-Forwarded-Proto` y
   confiar únicamente en sus CIDR reales.
3. El workflow construye el artefacto desde el commit en `main`, sube solo
   archivos versionados y ejecuta el script de release en EC2.
4. El script genera Prisma, compila y ejecuta `prisma migrate deploy` desde la
   instancia. El helper carga el acceso a RDS desde Secrets Manager sin imprimir
   la URL. Antes de la migración antigua que elimina columnas de pagos, bloquea
   el release si `OwnerPayment` tiene filas y la migración todavía está
   pendiente.
5. Arrancar la API con `NODE_ENV=production`, validar
   `GET https://<dominio-api>/v1/health`, login ROOT, correo de prueba y carga,
   lectura y expiración de un documento de prueba en S3.
6. Revisar logs y monitoreo, comprobar el respaldo de RDS y documentar el
   procedimiento de rollback. Una reversión del binario no revierte migraciones.

## Comprobaciones locales antes de empaquetar

```powershell
npm ci
npm run prisma:generate
npm run prisma:validate
npm run build
```

Esta lista no hace cambios en AWS. La aprobación de infraestructura, release y
ventana de migración sigue pendiente.
