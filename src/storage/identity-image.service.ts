import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export const IDENTITY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IDENTITY_IMAGE_TARGET_BYTES = 500 * 1024;
const MAX_INPUT_PIXELS = 30_000_000;

@Injectable()
export class IdentityImageService {
  async toWebp(input: Buffer): Promise<Buffer> {
    if (!input.length || input.length > IDENTITY_IMAGE_MAX_BYTES) {
      throw new BadRequestException('La foto debe pesar como máximo 2 MB.');
    }

    // Trust the binary signature, not the user-controlled filename or MIME header.
    const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
    const isPng = input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isJpeg && !isPng) {
      throw new BadRequestException('Adjunta una foto válida en formato JPG o PNG.');
    }

    try {
      const image = sharp(input, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        animated: false,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.pages !== undefined && metadata.pages > 1) {
        throw new Error('Unsupported image dimensions or pages');
      }

      // Decode and re-encode pixels only: metadata, appended payloads, and original
      // container bytes are discarded. Quality remains high to protect document text.
      let output = await sharp(input, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        animated: false,
        sequentialRead: true,
      })
        .rotate()
        .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92, effort: 5, smartSubsample: false })
        .toBuffer();

      if (output.byteLength > IDENTITY_IMAGE_TARGET_BYTES) {
        const qualityPass = await sharp(input, {
          failOn: 'warning',
          limitInputPixels: MAX_INPUT_PIXELS,
          animated: false,
          sequentialRead: true,
        })
          .rotate()
          .resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88, effort: 6, smartSubsample: false })
          .toBuffer();
        // 500 KB is a target only. Keep the higher-quality result if the lower
        // quality pass does not materially reduce the size.
        if (qualityPass.byteLength < output.byteLength) output = qualityPass;
      }
      return output;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('No se pudo validar la foto. Prueba con otra imagen JPG o PNG.');
    }
  }
}
