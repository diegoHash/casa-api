import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlatformRole } from '@prisma/client';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { CurrentAuth, PlatformRoles } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRolesGuard } from '../auth/platform-roles.guard';
import { SaveTableMappingDto } from './dto/save-table-mapping.dto';
import { ImportPasswordDto } from './dto/import-password.dto';
import { ImportsService } from './imports.service';
import { DeleteImportBatchDto } from './dto/delete-import-batch.dto';

const uploadDirectory = join(tmpdir(), 'casa-imports');
mkdirSync(uploadDirectory, { recursive: true });

@Controller('platform/clients/:clientId/imports')
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.ROOT)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get('catalog')
  catalog() {
    return this.importsService.catalog();
  }

  @Get()
  list(@Param('clientId') clientId: string) {
    return this.importsService.list(clientId);
  }

  @Get(':batchId')
  get(@Param('clientId') clientId: string, @Param('batchId') batchId: string) {
    return this.importsService.get(clientId, batchId);
  }

  @Post('scan')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDirectory,
        filename: (_request, file, callback) =>
          callback(
            null,
            `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          ),
      }),
      limits: {
        files: 1,
        fileSize: 100 * 1024 * 1024,
        fields: 5,
        fieldSize: 2048,
      },
    }),
  )
  scan(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('clientId') clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() input: ImportPasswordDto,
  ) {
    return this.importsService.scan(
      auth.userId,
      clientId,
      file,
      input.password,
    );
  }

  @Post(':batchId/rescan')
  rescan(
    @Param('clientId') clientId: string,
    @Param('batchId') batchId: string,
    @Body() input: ImportPasswordDto,
  ) {
    return this.importsService.rescan(clientId, batchId, input.password);
  }

  @Delete(':batchId')
  remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('clientId') clientId: string,
    @Param('batchId') batchId: string,
    @Body() input: DeleteImportBatchDto,
  ) {
    return this.importsService.remove(auth.userId, clientId, batchId, input);
  }

  @Put(':batchId/tables/:tableId/mapping')
  saveMapping(
    @Param('clientId') clientId: string,
    @Param('batchId') batchId: string,
    @Param('tableId') tableId: string,
    @Body() input: SaveTableMappingDto,
  ) {
    return this.importsService.saveMapping(clientId, batchId, tableId, input);
  }
}
