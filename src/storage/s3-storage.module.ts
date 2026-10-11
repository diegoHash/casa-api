import { Global, Module } from '@nestjs/common';
import { IdentityImageService } from './identity-image.service';
import { S3StorageService } from './s3-storage.service';

@Global()
@Module({ providers: [S3StorageService, IdentityImageService], exports: [S3StorageService, IdentityImageService] })
export class S3StorageModule {}
