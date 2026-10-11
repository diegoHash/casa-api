import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

@Injectable()
export class S3StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET_NAME', '');
    const region = config.getOrThrow<string>('AWS_REGION');
    // In EC2, rely on the attached instance profile and short-lived credentials.
    this.client = new S3Client({ region });
  }

  async putPrivateImage(key: string, body: Buffer) {
    this.assertConfigured();
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        ContentLength: body.byteLength,
        ServerSideEncryption: 'AES256',
        Tagging: 'purpose=owner-registration-identity',
        CacheControl: 'private, no-store, max-age=0',
        ContentDisposition: 'inline; filename="identity.webp"',
      }));
      if (!result.VersionId) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
        throw new Error('Versioning must be enabled for identity documents.');
      }
      return result.VersionId;
    } catch {
      // Never propagate provider errors: they can contain bucket/key or request details.
      throw new ServiceUnavailableException('No fue posible guardar el documento de forma segura.');
    }
  }

  async deletePrivateObject(key: string, versionId: string | null) {
    this.assertConfigured();
    try {
      if (versionId) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, VersionId: versionId }));
        return;
      }

      // A timed-out upload can leave an object even when the caller never received
      // its version ID. Enumerate and hard-delete only versions of this exact key.
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      do {
        const page = await this.client.send(new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }));
        const versions = [
          ...(page.Versions ?? []).filter((item) => item.Key === key && item.VersionId),
          ...(page.DeleteMarkers ?? []).filter((item) => item.Key === key && item.VersionId),
        ];
        for (const version of versions) {
          await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, VersionId: version.VersionId }));
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
      } while (keyMarker);
    } catch {
      throw new ServiceUnavailableException('No fue posible eliminar el documento de forma segura.');
    }
  }

  async readPrivateObject(key: string, versionId: string | null): Promise<Readable> {
    this.assertConfigured();
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      }));
      if (!result.Body || !(result.Body instanceof Readable)) {
        throw new Error('Unexpected S3 response body');
      }
      return result.Body;
    } catch {
      throw new ServiceUnavailableException('No fue posible recuperar el documento de forma segura.');
    }
  }

  private assertConfigured() {
    if (!this.bucket) throw new ServiceUnavailableException('El almacenamiento seguro de documentos no está configurado.');
  }
}
