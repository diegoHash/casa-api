# Guía inicial: Amazon S3 para Casa

Esta guía prepara el bucket `CasaBucket` para guardar documentos de identidad enviados durante el registro de propietarios y comprobantes de pago. Es una guía de configuración; la cuenta, la región y los permisos concretos se completarán con la información del responsable de AWS.

## 1. Decisiones que hay que cerrar antes de crear el bucket

- **Cuenta y región AWS:** elegir la cuenta de la aplicación y una región aprobada para los datos. La región del bucket no se puede cambiar después de crearlo.
- **Nombre real del bucket:** `CasaBucket` puede usarse como nombre interno, pero los nombres de buckets S3 estándar deben ir en minúsculas y ser globalmente únicos. Confirmar el nombre disponible, por ejemplo `casa-<organizacion>-prod-<sufijo>`.
- **Entornos:** decidir si habrá buckets distintos para desarrollo/pruebas y producción. Recomendación: mantener producción aislada del resto.
- **Retención y eliminación:** acordar cuánto tiempo se conservan solicitudes rechazadas, comprobantes y versiones reemplazadas, considerando las obligaciones legales y contables aplicables.
- **Conversión WebP:** confirmar qué formatos de entrada acepta el producto. PDF no se convierte a WebP; para imágenes de cédulas y comprobantes hay que priorizar que el texto siga siendo legible.

## 2. Convención propuesta para las claves

S3 no tiene carpetas reales: los segmentos separados por `/` son prefijos de la clave del objeto. Propongo normalizar los nombres y eliminar la duplicación `dni/dni` y el error `id-comunnity`:

```text
prod/casa/{communityId}/owners/{ownerId}/dni/{documentId}.webp
prod/casa/{communityId}/owners/{ownerId}/payments/{paymentId}/{documentId}.webp
```

Durante el registro el propietario todavía puede no existir como entidad. Para ese caso se debe usar el ID generado por `OwnerRegistrationRequest` y asociar el adjunto a esa solicitud; no inventar un `ownerId` ni usar cédula, correo, nombre o folio como parte de la clave. Cuando se apruebe la solicitud, la referencia de base de datos puede vincularse al `personId` definitivo sin que sea necesario cambiar la clave del objeto.

`{documentId}` debe ser un identificador aleatorio generado por el servidor. Para archivos que no sean imágenes, conservar su extensión y tipo; por ejemplo, `{documentId}.pdf`. El cliente nunca decide el bucket ni la clave final.

## 3. Crear el bucket desde AWS Console

1. Iniciar sesión en la cuenta AWS de la aplicación con un usuario/rol administrativo autorizado; no usar credenciales de root para las operaciones de la aplicación.
2. Abrir **Amazon S3 → Buckets → Create bucket**.
3. Elegir **General purpose bucket**, ingresar el nombre final en minúsculas y seleccionar la región aprobada.
4. En **Object Ownership**, dejar **ACLs disabled / Bucket owner enforced**.
5. Mantener activas las cuatro opciones de **Block all public access**.
6. Habilitar **Bucket Versioning** para permitir recuperación ante sobrescrituras o eliminaciones accidentales. Definir posteriormente una regla de expiración de versiones no actuales una vez acordada la retención.
7. Mantener el cifrado por defecto. SSE-S3 es una opción inicial sencilla; usar SSE-KMS si la política de la organización exige control de claves, auditoría o separación de funciones. Si se elige KMS, configurar permisos de la clave para el rol de ejecución.
8. Crear el bucket. Añadir etiquetas de propietario, sistema, ambiente y clasificación de datos si la organización las usa.
9. En **Properties → Default encryption**, confirmar el cifrado. En **Permissions → Block public access**, verificar las cuatro casillas. No configurar hosting web ni acceso anónimo.
10. No hace falta crear carpetas a mano; el prefijo aparece cuando se escriben los primeros objetos.

## 4. Acceso de la aplicación

Crear un rol de IAM para el entorno donde corre el API y conceder solo las acciones necesarias sobre este bucket. No guardar `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` de producción en `.env`, código o repositorio; usar el rol de ejecución y la cadena estándar de credenciales del SDK de AWS.

Como mínimo, revisar si el API necesita:

- `s3:PutObject` para subir los objetos bajo `prod/casa/*`.
- `s3:GetObject` para lectura/descarga autorizada.
- `s3:DeleteObject` solo si la política permite borrar archivos desde la aplicación.
- `s3:AbortMultipartUpload` si se habilita carga multiparte.

Evitar `s3:*`, permisos de administración del bucket y `s3:ListBucket` salvo que el flujo realmente los requiera. El acceso a una descarga debe pasar primero por autenticación, autorización por comunidad y comprobación de que el adjunto pertenece a la entidad solicitada; después el API puede entregar una URL prefirmada de vida corta. No exponer URLs permanentes ni las claves S3 en respuestas públicas.

## 5. Subida, metadatos y WebP

El API deberá guardar en base de datos la clave S3, `communityId`, entidad relacionada (solicitud de registro o pago), tipo de archivo, MIME detectado, tamaño, fecha y actor. El archivo y sus metadatos deben tener una estrategia de compensación: si falla la transacción después de subir, eliminar el objeto huérfano o marcarlo para limpieza.

Para conversión WebP, el primer diseño recomendado es procesar la imagen en el API antes de subirla usando una librería como `sharp`, con límites de tamaño en píxeles y bytes, validación de contenido real y tiempo/memoria acotados. Convertir solo entradas raster permitidas (por ejemplo JPEG/PNG); no tratar un archivo renombrado como imagen. Mantener PDF como PDF. Para identificaciones escaneadas, evaluar WebP lossless o calidad alta y comprobar legibilidad antes de fijar parámetros. Decidir si se conserva también el original —recomendado inicialmente hasta validar calidad, extracción y retención— o si solo se persiste el WebP.

Si la conversión se mueve a una Lambda disparada por S3, usar prefijos separados de entrada y salida o buckets separados para evitar que la salida vuelva a disparar la función en un bucle. Esa alternativa requiere definir estados de procesamiento y reintentos; no es necesaria para el primer corte si el API puede convertir de forma fiable.

## 6. Variables de configuración previstas para el API

Se definirán después de confirmar la cuenta y región; estos nombres son una propuesta y no se deben rellenar con credenciales:

```dotenv
AWS_REGION=
S3_BUCKET_NAME=
S3_KEY_PREFIX=prod/casa
S3_PRESIGNED_URL_TTL_SECONDS=300
```

El API debe validar configuración en arranque y fallar claramente si el bucket requerido no está configurado en producción. Las credenciales en desarrollo deben ser temporales o venir de un perfil/rol local; no añadir secretos a `.env.example`.

## 7. Comprobaciones de cierre de la configuración

- El bucket existe en la cuenta y región acordadas y su nombre final queda registrado.
- Acceso público bloqueado en los cuatro controles y ACLs deshabilitadas.
- Cifrado por defecto activo y versionado habilitado, si esa decisión se mantiene.
- El rol del API puede subir y leer objetos de prueba solo en los prefijos autorizados; acceso anónimo falla.
- Las claves usan IDs opacos, incluyen ambiente/comunidad y no contienen datos personales.
- Una URL prefirmada caduca en el plazo configurado y solo se emite después de validar permisos en el API.
- Una imagen de prueba llega como WebP legible; un PDF de prueba permanece PDF; tipos no permitidos se rechazan.
- Está acordada la retención de versiones, eliminación y adjuntos de solicitudes rechazadas.

## 8. Información que necesito para continuar contigo

Compárteme, sin enviar contraseñas ni claves secretas:

1. Región AWS elegida y si ya existe una cuenta/proyecto AWS para CASA.
2. Nombre final disponible del bucket (puede ser `CasaBucket` como etiqueta; el nombre S3 se normaliza a minúsculas y puede necesitar sufijo único).
3. Entorno de despliegue del API (EC2, ECS, EKS, Lambda, otro) para orientar el rol IAM.
4. Si prefieres conservar originales además de WebP y qué límite inicial de tamaño de archivo deseas.
5. Política de retención/eliminación aprobada, o quién la definirá.

No compartas aquí claves de acceso de AWS, contraseñas, códigos MFA ni archivos reales de identidad o pagos.

## Referencias oficiales

- [Crear un bucket de uso general](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html)
- [Reglas de nombres de buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)
- [Claves y prefijos de objetos S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)
- [Bloquear acceso público a S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [Buenas prácticas de seguridad para S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [URLs prefirmadas](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
- [WebP en Sharp](https://sharp.pixelplumbing.com/api-output/#webp)
- [Procesar notificaciones S3 con Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)

## Implementación segura de la foto de identidad

El API ahora recibe la foto como `multipart/form-data` en el campo `identityDocument`. Rechaza solicitudes sin archivo; limita a 2 MB, un archivo y un máximo de siete campos; aplica un límite de cinco intentos por minuto por IP; solo admite firmas JPEG/PNG y decodifica/re-encodea los píxeles a WebP. El nombre original, MIME declarado y bytes originales no se conservan. WebP se intenta comprimir con calidad alta; los 500 KB son objetivo, nunca una condición que fuerce a degradar la legibilidad.

El archivo queda relacionado con `OwnerRegistrationRequest`, y la clave usa su ID junto al `communityId`. Tras la aprobación, `OwnerRegistrationRequest.personId` enlaza el mismo expediente con la persona propietaria: el objeto no se mueve ni se copia. El endpoint de descarga transmite el documento por el API, requiere autorización de lectura del condominio y responde `no-store`; no entrega URL prefirmada. El código no incluye una ruta para reemplazar el archivo de una solicitud.

La expiración se guarda a 30 días y un proceso de fondo intenta la eliminación definitiva cada cinco minutos; al rechazar, el documento queda inmediatamente inaccesible y se intenta borrar enseguida. El proceso de fondo reintenta si AWS no responde. Como el bucket tiene Versioning activo, debe borrarse la versión exacta; un `DeleteObject` sin `VersionId` solo oculta la versión activa y no elimina sus bytes.

### Política IAM que requiere el rol de EC2

La política anterior con solo `PutObject` y `GetObject` no alcanza para el flujo seguro con versionado. Añade los permisos siguientes al rol que ya usa EC2; conserva los permisos de Secrets Manager que ya tenga. El statement del bucket se limita al prefijo de adjuntos de registro para que la enumeración de versiones no permita listar otras rutas:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageRegistrationIdentityObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectTagging",
        "s3:GetObjectVersion",
        "s3:DeleteObject",
        "s3:DeleteObjectVersion"
      ],
      "Resource": "arn:aws:s3:::casa-s3-prod-066640849393-us-east-1-an/prod/casa/*/registration-requests/*/identity/*"
    },
    {
      "Sid": "FindOnlyRegistrationIdentityVersionsForCleanup",
      "Effect": "Allow",
      "Action": "s3:ListBucketVersions",
      "Resource": "arn:aws:s3:::casa-s3-prod-066640849393-us-east-1-an",
      "Condition": {
        "StringLike": {
          "s3:prefix": "prod/casa/*/registration-requests/*/identity/*"
        }
      }
    }
  ]
}
```

`s3:PutObjectTagging` aplica la etiqueta `purpose=owner-registration-identity`. En la consola del bucket crea una regla de Lifecycle filtrada por esa etiqueta: expirar la versión actual a los 30 días y expirar versiones no actuales un día después. Como AWS no permite combinar el filtro por etiqueta con la acción `ExpiredObjectDeleteMarker`, crea una segunda regla, solo con esa acción, con prefijo `prod/casa/`. Esta regla es una defensa adicional por si el proceso de fondo no se ejecuta; AWS procesa reglas de Lifecycle de forma asíncrona. No crees una regla de expiración amplia por `prod/casa/`, porque podría borrar en el futuro comprobantes de pago. [Acciones de Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)

### Transporte y adopción del frontend

- En producción, el endpoint rechaza cargas si Express no reconoce la conexión como HTTPS. Configura TLS en el ALB/proxy y establece `TRUSTED_PROXY_CIDRS` solo con las redes reales del proxy para que `request.secure` use el protocolo reenviado confiable. No habilites confianza indiscriminada en cabeceras del cliente.
- El frontend debe enviar `multipart/form-data` con `identityDocument` (JPEG o PNG) y mostrar antes del envío que el documento se usa solo para evaluar la solicitud de ese condominio y se elimina a los 30 días o al ser rechazada. Después de enviar, no ofrecer reemplazo.
- Ejecuta la migración Prisma antes de desplegar el API, configura `AWS_REGION=us-east-1` y `S3_BUCKET_NAME=casa-s3-prod-066640849393-us-east-1-an` en producción. La instancia EC2 debe usar el instance profile existente; no agregues claves de acceso estáticas.
