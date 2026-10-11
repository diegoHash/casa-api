import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentAuth } from './auth.decorators';
import { AuthService } from './auth.service';
import { AuthPrincipal } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SelectContextDto } from './dto/select-context.dto';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

import { BackendMailService } from '../common/services/backend-mail.service';
import { CreateOwnerAccessRequestDto } from '../owner-service/dto/owner-service.dto';
import { PrismaService } from '../database/prisma.service';
import { EmailDomainService } from './email-domain.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { IdentityImageService, IDENTITY_IMAGE_MAX_BYTES } from '../storage/identity-image.service';
import { randomUUID } from 'node:crypto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mailService: BackendMailService,
    private readonly prisma: PrismaService,
    private readonly emailDomains: EmailDomainService,
    private readonly s3: S3StorageService,
    private readonly identityImages: IdentityImageService,
  ) {}

  @Post('registration-requests')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('identityDocument', {
    storage: memoryStorage(),
    limits: { fileSize: IDENTITY_IMAGE_MAX_BYTES, files: 1, fields: 7, parts: 8, fieldNameSize: 64, fieldSize: 2048 },
  }))
  async publicRegistrationRequest(
    @Body() input: CreateOwnerAccessRequestDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() transportRequest: Request,
  ) {
    if (process.env.NODE_ENV === 'production' && !transportRequest.secure) {
      throw new BadRequestException('Envía la solicitud mediante una conexión HTTPS segura.');
    }
    if (!file) throw new BadRequestException('Adjunta una foto de tu cédula para enviar la solicitud.');
    await this.emailDomains.assertReceivesEmail(input.email);
    const inviteCode = String(input.inviteCode || '').trim();
    
    // 1. Verify invitation code
    const invite = await this.prisma.communityInvitation.findUnique({
      where: { code: inviteCode },
    });

    if (!invite) {
      throw new BadRequestException('El código de invitación ingresado no es válido.');
    }

    if (invite.revokedAt !== null) {
      throw new BadRequestException('El código de invitación ingresado ha sido revocado.');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('El código de invitación ingresado ha expirado.');
    }
    const webp = await this.identityImages.toWebp(file.buffer);

    // The invitation is the sole authority for the request's community.
    // Never accept a community id from this public endpoint.
    const folioNumber = `FOL-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const registrationRequest = await this.prisma.ownerRegistrationRequest.create({
      data: {
        communityId: invite.communityId,
        folioNumber,
        docType: input.docType,
        docNumber: input.docNumber,
        fullName: input.fullName,
        propertyCode: input.propertyCode,
        email: input.email.trim().toLowerCase(),
        phone: input.phone,
      },
    });

    const key = `prod/casa/${invite.communityId}/registration-requests/${registrationRequest.id}/identity/${randomUUID()}.webp`;
    let versionId: string | null = null;
    let documentExpiresAt: Date | null = null;
    try {
      versionId = await this.s3.putPrivateImage(key, webp);
      if (!versionId) throw new Error('Bucket versioning is required for private identity documents.');
      documentExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await this.prisma.ownerRegistrationRequest.update({
        where: { id: registrationRequest.id },
        data: { identityDocumentKey: key, identityDocumentVersionId: versionId, identityDocumentExpiresAt: documentExpiresAt, identityDocumentSizeBytes: webp.byteLength },
      });
    } catch {
      let removedFromS3 = false;
      if (versionId) {
        try {
          await this.s3.deletePrivateObject(key, versionId);
          removedFromS3 = true;
        } catch {
          removedFromS3 = false;
        }
      }
      if (removedFromS3) {
        await this.prisma.ownerRegistrationRequest.delete({ where: { id: registrationRequest.id } }).catch(() => undefined);
      } else {
        // Preserve the key/version so the retention worker can retry deletion.
        await this.prisma.ownerRegistrationRequest.update({
          where: { id: registrationRequest.id },
          data: { status: 'REJECTED', identityDocumentKey: key, identityDocumentVersionId: versionId, identityDocumentExpiresAt: new Date(), identityDocumentSizeBytes: webp.byteLength },
        }).catch(() => undefined);
      }
      throw new InternalServerErrorException('No fue posible completar el registro de forma segura. Inténtalo nuevamente.');
    }

    const receipt = await this.mailService.sendRegistrationReceiptEmail({
      folioNumber: registrationRequest.folioNumber,
      email: registrationRequest.email,
      fullName: registrationRequest.fullName,
      propertyCode: registrationRequest.propertyCode,
      docType: registrationRequest.docType,
      phone: registrationRequest.phone ?? undefined,
      createdAt: registrationRequest.createdAt.toISOString(),
    });
    return {
      message: receipt.dispatched
        ? 'Solicitud de registro recibida y correo de confirmación enviado.'
        : 'Solicitud de registro recibida, pero no fue posible enviar el correo de confirmación.',
      emailDispatched: receipt.dispatched,
      request: {
        id: registrationRequest.id,
        folioNumber: registrationRequest.folioNumber,
        status: registrationRequest.status,
        createdAt: registrationRequest.createdAt,
        identityDocumentExpiresAt: documentExpiresAt,
      },
    };
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginDto, @Req() request: Request) {
    return this.auth.login(
      input.email,
      input.password,
      this.requestMetadata(request),
    );
  }

  @Post('password-reset/request')
  @HttpCode(202)
  requestPasswordReset(
    @Body() input: RequestPasswordResetDto,
    @Req() request: Request,
  ) {
    return this.auth.requestPasswordReset(
      input.email,
      this.requestMetadata(request),
      input.type,
    );
  }

  @Post('password-reset/complete')
  @HttpCode(200)
  resetPassword(@Body() input: ResetPasswordDto, @Req() request: Request) {
    return this.auth.resetPassword(input, this.requestMetadata(request));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: RefreshTokenDto, @Req() request: Request) {
    return this.auth.refresh(
      input.refreshToken,
      input.communityId,
      this.requestMetadata(request),
    );
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() input: RefreshTokenDto) {
    return this.auth.logout(input.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logoutAll(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.logoutAll(auth);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.auth.changePassword(
      auth,
      input.currentPassword,
      input.newPassword,
      this.requestMetadata(request),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.me(auth);
  }

  @Get('contexts')
  @UseGuards(JwtAuthGuard)
  contexts(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.listContexts(auth);
  }

  @Post('select-context')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  selectContext(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: SelectContextDto,
  ) {
    return this.auth.selectContext(auth, input.communityId);
  }

  private requestMetadata(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
