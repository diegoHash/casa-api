# Primer despliegue de CASA API

Este runbook prepara el primer lanzamiento de producción. La EC2 Amazon Linux
2023 (`severus-ec2`) ejecutará la API detrás del Nginx ya configurado para
`api.somoscasa.site`; el RDS MySQL 8.4 (`central-severus`) aloja la base `AIS_DB`.
No se usa ALB. El puerto 3001 queda enlazado localmente detrás del proxy.

## Estado del repositorio

- La API compila con Node.js 24 y el esquema Prisma valida.
- Las migraciones Prisma están en `prisma/migrations`; en producción se aplican
  con `prisma migrate deploy`, nunca con `migrate dev`.
- La API obtiene `casa/prod/database` y `casa/prod/app` de Secrets Manager al
  iniciar en `NODE_ENV=production`. El secreto de base de datos existente se
  llama `casa/prod/database/` (barra final), y el código lo consulta primero
  porque el rol de EC2 tiene permiso sobre ese ARN; conserva el nombre canónico
  sin barra como opción de transición futura.
- El usuario runtime configurado es `casa-user` y la base se llama `AIS_DB`.
- Las migraciones se ejecutarán desde GitHub Actions a través de un túnel SSH a
  EC2. El runner usará OIDC con `ec2-role-secret-reader`; una política de sesión
  limita las credenciales de GitHub al secreto `casa/prod/database-migrations`.
- S3 requiere `AWS_REGION` y `S3_BUCKET_NAME`; la guía
  [amazon-s3-casabucket-setup.md](./amazon-s3-casabucket-setup.md) documenta el
  bucket, el versionado y los permisos de la instancia.
- `GET /v1/health` es una comprobación básica de proceso; no comprueba RDS ni S3.
- El RDS está disponible y cifrado, con snapshots automáticos recientes; su
  retención es de 1 día y la protección contra borrado está desactivada. Aumentar
  la retención y habilitar protección antes de una migración de producción.
- El grupo de seguridad EC2 permite SSH (22) desde `0.0.0.0/0` y HTTPS (443)
  desde `0.0.0.0/0`; 3001 no está expuesto. Restringir SSH a IPs administrativas
  antes de operar la instancia.
- GitHub ya tiene los secrets `EC2_HOST`, `EC2_KEY` y `EC2_USER`, y la variable
  `EC2_KNOWN_HOSTS` valida la identidad del servidor SSH.
- `casa/prod/app` y `casa/prod/database/` existen y contienen los campos
  esperados. La API prueba primero el nombre con barra final autorizado por el
  rol de EC2, y luego el nombre canónico sin barra.
- `casa/prod/database-migrations` existe y contiene los campos esperados. El
  usuario MySQL `casa-migrator` ya está creado con permisos limitados a `AIS_DB`.
  El rol compartido `ec2-role-secret-reader` debe conservar su confianza para
  EC2 y agregar confianza OIDC para GitHub Actions antes de desplegar. El
  proveedor OIDC de GitHub ya está creado.
- El rol de la instancia conserva acceso al secreto administrado por RDS para
  el usuario `admin`. Como ese rol es compartido con otros proyectos, no se
  retiró ese permiso; la separación del secreto migrador no impide que la
  instancia use esa credencial administrativa hasta que se audite ese acceso.

## Configuración del auto deploy

El workflow `.github/workflows/deploy-api.yml` compila cada push a `main` y
también permite un inicio manual. Configura estos GitHub Actions secrets en el
repositorio `casa-api`:

- `EC2_HOST`: IP o hostname público de EC2.
- `EC2_USER`: usuario SSH de EC2.
- `EC2_KEY`: clave privada SSH sin passphrase.

La variable `EC2_KNOWN_HOSTS` ya está configurada con la línea verificada para
esa instancia. Es un dato público, no una clave secreta; el workflow la usa
para validar la identidad SSH de EC2.

En la instancia, instala Node.js 24, npm y `flock`. El usuario SSH necesita
`sudo` sin contraseña para instalar y administrar `casa-api.service`. El
instance profile debe poder leer los secretos configurados en Secrets Manager,
y usar S3 con los permisos mínimos descritos en
[amazon-s3-casabucket-setup.md](./amazon-s3-casabucket-setup.md).

### Secreto y rol de migraciones

Crea `casa/prod/database-migrations` en Secrets Manager con los mismos campos
de conexión de runtime, pero con el usuario MySQL separado `casa-migrator`:

```json
{
  "user_db_casa": "casa-migrator",
  "pass_db_casa": "<contraseña aleatoria exclusiva>",
  "host": "central-severus.c0dqi40m44ev.us-east-1.rds.amazonaws.com",
  "port": "3306",
  "dbname": "AIS_DB",
  "engine": "mysql"
}
```

Limita ese usuario a `AIS_DB` y otórgale los privilegios que Prisma necesita
para crear y modificar tablas e índices. No concedas permisos globales. El rol
`ec2-role-secret-reader` ya es usado por EC2 y tiene acceso al secreto migrador.
Agrega esta segunda declaración de confianza OIDC sin quitar la declaración
existente para `ec2.amazonaws.com`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::066640849393:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:diegoHash/casa-api:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

El workflow usa una política de sesión para limitar las credenciales OIDC de
GitHub a `secretsmanager:GetSecretValue` en el secreto migrador. La política de
sesión reduce los permisos efectivos de esa sesión; la política IAM adjunta al
rol también debe permitir la lectura del secreto:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:us-east-1:066640849393:secret:casa/prod/database-migrations-IGAJrW"
  }]
}
```

La cuenta MySQL `casa-migrator` ya existe y usa la contraseña guardada como
`pass_db_casa` en el secreto.

La cuenta no tiene un ALB. El puerto 3001 permanece privado y el proxy inverso
local debe aceptar HTTPS en 443 y reenviar a `127.0.0.1:3001`. Configura
`TRUSTED_PROXY_CIDRS` con la dirección de loopback del proxy local, salvo que se
confirme otra topología. Si Cloudflare va a proxyar el dominio API, confirma el
registro `api.somoscasa.site`, el modo TLS estricto y el certificado del origen;
la publicación del frontend no crea por sí sola ese endpoint.

El archivo `~/casa/casa-api/shared/runtime.env` ya existe en EC2 con permisos
restringidos. Mantén ahí solo variables no secretas:

```dotenv
NODE_ENV=production
PORT=3001
AWS_REGION=us-east-1
S3_BUCKET_NAME=casa-s3-prod-066640849393-us-east-1-an
API_PREFIX=v1
WEB_ORIGIN=https://somoscasa.site
TRUSTED_PROXY_CIDRS=127.0.0.1/8,::1/128
```

El workflow aplica migraciones desde Actions antes de desplegar la API. El
runner obtiene solo el secreto migrador mediante OIDC y llega a RDS por un
túnel SSH a EC2. El script de instancia conserva los releases anteriores y
cambia `current` solo cuando el servicio y el chequeo local de salud terminan
bien. Si ya existe una
instalación que use otro gestor de procesos o puerto, hay que adaptar ese
servicio antes de habilitar el workflow.

## Datos que deben quedar confirmados

- Instancia EC2 y que su usuario SSH tenga permisos para escribir en
  `~/casa/casa-api`.
- Acceso de lectura/escritura para `casa-user` y privilegios DDL limitados a
  `AIS_DB` para `casa-migrator`.
- Proxy inverso HTTPS existente en 443, certificado de origen y DNS para la API.
- Dominio(s) del frontend para `WEB_ORIGIN`.
- CIDR real del proxy local para `TRUSTED_PROXY_CIDRS`.
- Retención de backups de RDS y protección contra borrado.
- Restricción del acceso SSH en el grupo de seguridad EC2.
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
TRUSTED_PROXY_CIDRS=127.0.0.1/8,::1/128
```

No crear `DATABASE_URL` ni credenciales estáticas de AWS en un archivo `.env`
de producción. El rol de EC2 proporciona las credenciales AWS; la aplicación
construye la URL de RDS a partir de Secrets Manager. El secreto
`casa/prod/app` debe incluir `JWT_ACCESS_SECRET`, `ROOT_BOOTSTRAP_EMAIL` y
`ROOT_BOOTSTRAP_PASSWORD`. Para los correos de confirmación, puede incluir
`EMAIL_FROM_ADDRESS` (por ejemplo, `noreply@somoscasa.site`); si se omite, la
API usa ese remitente por defecto. El dominio remitente debe estar verificado
en Resend antes de enviar a destinatarios públicos. La aplicación valida esas
variables en cada arranque;
tras crear el usuario ROOT inicial, rotarla por una contraseña aleatoria fuerte
que no se reutilice en cuentas humanas.

## Secuencia del release

1. Revisar el diff completo, retirar secretos y datos locales, y seleccionar
   los cambios que componen el release. Crear un commit y un tag identificables.
2. Preparar EC2, RDS, rol IAM, bucket privado y TLS; permitir el puerto de la API
   solo por loopback detrás del proxy HTTPS. Configurar el proxy para enviar
   `X-Forwarded-Proto` y confiar únicamente en su dirección real.
3. El workflow construye el artefacto desde el commit en `main`, aplica
   `prisma migrate deploy` desde el runner aislado y sube solo archivos
   versionados para ejecutar el script de release en EC2.
4. Antes de la migración antigua que elimina columnas de pagos, bloquea
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
