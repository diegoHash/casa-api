import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportBatchStatus,
  ImportMappingStatus,
  ImportSourceType,
  Prisma,
  type ImportBatch,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { IMPORT_TARGET_CATALOG } from './import-catalog';
import { SaveTableMappingDto } from './dto/save-table-mapping.dto';
import { LegacyScannerService } from './legacy-scanner.service';
import { DeleteImportBatchDto } from './dto/delete-import-batch.dto';

const PRIVATE_STORAGE = resolve(process.cwd(), '.data', 'imports');

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: LegacyScannerService,
  ) {}

  catalog() {
    return IMPORT_TARGET_CATALOG;
  }

  async list(clientId: string) {
    await this.requireClient(clientId);
    const batches = await this.prisma.importBatch.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: {
        tables: {
          orderBy: { sourceName: 'asc' },
          include: { columnMappings: true },
        },
      },
    });
    return batches.map((batch) => this.publicBatch(batch));
  }

  async get(clientId: string, batchId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, clientId },
      include: {
        tables: {
          orderBy: { sourceName: 'asc' },
          include: { columnMappings: true },
        },
      },
    });
    if (!batch)
      throw new NotFoundException('Lote de importación no encontrado.');
    return this.publicBatch(batch);
  }

  async scan(
    actorUserId: string,
    clientId: string,
    file: Express.Multer.File,
    password?: string,
  ) {
    if (!file)
      throw new BadRequestException('Selecciona un archivo MDB o CSV.');
    let client: Awaited<ReturnType<ImportsService['requireClient']>>;
    try {
      client = await this.requireClient(clientId);
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }
    const extension = extname(file.originalname).toLowerCase();
    if (!['.mdb', '.csv'].includes(extension)) {
      await rm(file.path, { force: true });
      throw new BadRequestException('Solo se permiten archivos MDB y CSV.');
    }
    const checksumSha256 = createHash('sha256')
      .update(await readFile(file.path))
      .digest('hex');
    const duplicate = await this.prisma.importBatch.findFirst({
      where: {
        clientId,
        checksumSha256,
        status: { not: ImportBatchStatus.FAILED },
      },
      select: { id: true },
    });
    if (duplicate) {
      await rm(file.path, { force: true });
      throw new BadRequestException(
        `Este archivo ya fue registrado en el lote ${duplicate.id}.`,
      );
    }
    const batch = await this.prisma.importBatch.create({
      data: {
        onboardingId: client.onboarding!.id,
        clientId,
        communityId: client.community!.id,
        sourceType:
          extension === '.mdb' ? ImportSourceType.MDB : ImportSourceType.CSV,
        originalName: file.originalname,
        storagePath: 'pending',
        mimeType: file.mimetype || 'application/octet-stream',
        byteSize: BigInt(file.size),
        checksumSha256,
        status: ImportBatchStatus.SCANNING,
        createdById: actorUserId,
      },
    });
    const directory = join(PRIVATE_STORAGE, clientId);
    const storagePath = join(directory, `${batch.id}${extension}`);
    await mkdir(directory, { recursive: true });
    await rename(file.path, storagePath);
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { storagePath },
    });

    return this.persistScan(clientId, { ...batch, storagePath }, password);
  }

  async rescan(clientId: string, batchId: string, password?: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, clientId },
    });
    if (!batch)
      throw new NotFoundException('Lote de importación no encontrado.');
    if (batch.status === ImportBatchStatus.IMPORTED) {
      throw new BadRequestException(
        'Un lote ya importado no puede volver a escanearse.',
      );
    }
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: ImportBatchStatus.SCANNING, errorMessage: null },
    });
    return this.persistScan(clientId, batch, password);
  }

  async remove(
    actorUserId: string,
    clientId: string,
    batchId: string,
    input: DeleteImportBatchDto,
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, clientId },
    });
    if (!batch) {
      throw new NotFoundException('Lote de importación no encontrado.');
    }
    if (batch.status === ImportBatchStatus.IMPORTED) {
      throw new BadRequestException(
        'Un lote ya incorporado no puede eliminarse; debe conservarse como evidencia histórica.',
      );
    }
    if (input.confirmation.trim() !== batch.originalName) {
      throw new BadRequestException(
        'La confirmación debe coincidir exactamente con el nombre del archivo.',
      );
    }

    const quarantinePath = `${batch.storagePath}.deleting-${randomUUID()}`;
    let quarantined = false;
    try {
      await rename(batch.storagePath, quarantinePath);
      quarantined = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.importBatch.delete({ where: { id: batch.id } });
        await transaction.auditEvent.create({
          data: {
            communityId: batch.communityId,
            actorUserId,
            requestId: randomUUID(),
            action: 'IMPORT_BATCH_DELETED',
            entityType: 'ImportBatch',
            entityId: batch.id,
            detail: `Fuente legacy ${batch.originalName} descartada`,
            reason: input.reason.trim(),
            before: {
              originalName: batch.originalName,
              sourceType: batch.sourceType,
              status: batch.status,
              tableCount: batch.tableCount,
              rowCount: batch.rowCount,
              checksumSha256: batch.checksumSha256,
            },
          },
        });
      });
    } catch (error) {
      if (quarantined) await rename(quarantinePath, batch.storagePath);
      throw error;
    }
    if (quarantined) await rm(quarantinePath, { force: true });
    return { deleted: true, batchId: batch.id };
  }

  async saveMapping(
    clientId: string,
    batchId: string,
    tableId: string,
    input: SaveTableMappingDto,
  ) {
    const table = await this.prisma.importTable.findFirst({
      where: { id: tableId, batchId, batch: { clientId } },
      include: { batch: true },
    });
    if (!table) throw new NotFoundException('Tabla legacy no encontrada.');
    const sourceColumns = new Set(
      (table.columns as Array<{ name: string }>).map((column) => column.name),
    );

    if (input.mode === 'ignore') {
      await this.prisma.importTable.update({
        where: { id: tableId },
        data: {
          mappingStatus: ImportMappingStatus.IGNORED,
          targetEntity: null,
          notes: input.notes,
          columnMappings: { deleteMany: {} },
        },
      });
    } else {
      const target = IMPORT_TARGET_CATALOG.find(
        (entity) => entity.key === input.targetEntity,
      );
      if (!target)
        throw new BadRequestException(
          'La entidad CASA seleccionada no existe.',
        );
      const targetFields = new Set(target.fields.map((field) => field.key));
      const mappedTargets = new Set<string>();
      for (const column of input.columns) {
        if (!sourceColumns.has(column.sourceColumn)) {
          throw new BadRequestException(
            `La columna ${column.sourceColumn} no existe en la tabla legacy.`,
          );
        }
        if (!targetFields.has(column.targetField)) {
          throw new BadRequestException(
            `El campo CASA ${column.targetField} no pertenece a ${target.label}.`,
          );
        }
        if (mappedTargets.has(column.targetField)) {
          throw new BadRequestException(
            `El campo CASA ${column.targetField} fue asignado más de una vez.`,
          );
        }
        mappedTargets.add(column.targetField);
      }
      const missingRequired = target.fields
        .filter((field) => field.required && !mappedTargets.has(field.key))
        .map((field) => field.label);
      if (missingRequired.length) {
        throw new BadRequestException(
          `Faltan campos obligatorios: ${missingRequired.join(', ')}.`,
        );
      }
      await this.prisma.importTable.update({
        where: { id: tableId },
        data: {
          mappingStatus: ImportMappingStatus.COMPLETE,
          targetEntity: target.key,
          notes: input.notes,
          columnMappings: {
            deleteMany: {},
            create: input.columns.map((column) => ({
              sourceColumn: column.sourceColumn,
              targetField: column.targetField,
              transform: column.transform,
              required: column.required,
            })),
          },
        },
      });
    }

    const tables = await this.prisma.importTable.findMany({
      where: { batchId },
      select: { mappingStatus: true },
    });
    const mapped =
      tables.length > 0 &&
      tables.every(
        (item) =>
          item.mappingStatus === ImportMappingStatus.COMPLETE ||
          item.mappingStatus === ImportMappingStatus.IGNORED,
      );
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: mapped ? ImportBatchStatus.MAPPED : ImportBatchStatus.MAPPING,
      },
    });
    return this.get(clientId, batchId);
  }

  private async requireClient(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { community: true, onboarding: true },
    });
    if (!client || !client.community || !client.onboarding) {
      throw new NotFoundException(
        'Cliente o expediente de incorporación no encontrado.',
      );
    }
    return client;
  }

  private async persistScan(
    clientId: string,
    batch: ImportBatch,
    password?: string,
  ) {
    try {
      const tables = await this.scanner.scan(
        batch.storagePath,
        batch.originalName,
        password,
      );
      const rowCount = tables.reduce((sum, table) => sum + table.rowCount, 0);
      await this.prisma.$transaction([
        this.prisma.importTable.deleteMany({ where: { batchId: batch.id } }),
        ...tables.map((table) =>
          this.prisma.importTable.create({
            data: {
              batchId: batch.id,
              sourceName: table.sourceName,
              rowCount: table.rowCount,
              columns: table.columns as unknown as Prisma.InputJsonValue,
              sampleRows: table.sampleRows as Prisma.InputJsonValue,
            },
          }),
        ),
        this.prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: ImportBatchStatus.SCANNED,
            tableCount: tables.length,
            rowCount,
            scannedAt: new Date(),
            errorMessage: null,
          },
        }),
      ]);
      return this.get(clientId, batch.id);
    } catch (error) {
      const message =
        error instanceof HttpException
          ? error.message
          : 'El archivo fue leído, pero no se pudo registrar su inventario.';
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportBatchStatus.FAILED,
          errorMessage: message.slice(0, 1000),
        },
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(message);
    }
  }

  private publicBatch<T extends { byteSize: bigint; storagePath: string }>(
    batch: T,
  ) {
    const publicRecord = {
      ...batch,
      byteSize: batch.byteSize.toString(),
    } as Omit<T, 'byteSize' | 'storagePath'> & {
      byteSize: string;
      storagePath?: string;
    };
    delete publicRecord.storagePath;
    return publicRecord;
  }
}
