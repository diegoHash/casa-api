import { BadRequestException, Injectable } from '@nestjs/common';
import MDBReader from 'mdb-reader';
import { parse } from 'csv-parse/sync';
import { readFile } from 'node:fs/promises';
import { extname, parse as parsePath } from 'node:path';

export interface ScannedColumn {
  name: string;
  sourceType: string;
  nullable: boolean;
  sampleValues: unknown[];
}

export interface ScannedTable {
  sourceName: string;
  rowCount: number;
  columns: ScannedColumn[];
  sampleRows: Record<string, unknown>[];
}

function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[valor complejo]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binario · ${value.byteLength} bytes]`;
  if (typeof value === 'string')
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value))
    return value.slice(0, 10).map((item) => jsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([key, item]) => [key, jsonSafe(item, depth + 1)]),
    );
  }
  return value;
}

function safeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => jsonSafe(row) as Record<string, unknown>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferType(values: unknown[]) {
  const present = values.filter(
    (value) => value !== null && value !== undefined && value !== '',
  );
  if (!present.length) return 'empty';
  if (
    present.every((value) => /^-?\d+(?:[.,]\d+)?$/.test(String(value).trim()))
  )
    return 'number';
  if (present.every((value) => !Number.isNaN(Date.parse(String(value)))))
    return 'date';
  if (
    present.every((value) =>
      /^(true|false|sí|si|no|0|1)$/i.test(String(value).trim()),
    )
  )
    return 'boolean';
  return 'text';
}

function detectDelimiter(header: string) {
  const candidates = [',', ';', '\t', '|'];
  return (
    candidates
      .map((delimiter) => ({
        delimiter,
        count: header.split(delimiter).length - 1,
      }))
      .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ','
  );
}

@Injectable()
export class LegacyScannerService {
  async scan(
    filePath: string,
    originalName: string,
    password?: string,
  ): Promise<ScannedTable[]> {
    const extension = extname(originalName).toLowerCase();
    if (extension === '.mdb') return this.scanMdb(filePath, password);
    if (extension === '.csv') return this.scanCsv(filePath, originalName);
    throw new BadRequestException(
      'Solo se permiten archivos MDB y CSV en esta etapa.',
    );
  }

  private async scanMdb(filePath: string, password?: string) {
    try {
      const buffer = await readFile(filePath);
      const reader = new MDBReader(buffer, password ? { password } : undefined);
      return reader.getTableNames().map((sourceName) => {
        const table = reader.getTable(sourceName);
        const sampleRows = safeRows(table.getData({ rowLimit: 5 }));
        const columns = table.getColumns().map((column) => ({
          name: column.name,
          sourceType: column.type,
          nullable: column.nullable,
          sampleValues: sampleRows
            .map((row) => row[column.name])
            .filter((value) => value !== null && value !== undefined)
            .slice(0, 3),
        }));
        return { sourceName, rowCount: table.rowCount, columns, sampleRows };
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? `No se pudo leer la base Access: ${error.message}`
          : 'No se pudo leer la base Access.',
      );
    }
  }

  private async scanCsv(filePath: string, originalName: string) {
    const buffer = await readFile(filePath);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      content = new TextDecoder('windows-1252').decode(buffer);
    }
    const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = detectDelimiter(firstLine);
    try {
      const parsedRecords: unknown = parse(content, {
        bom: true,
        columns: true,
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
      if (!Array.isArray(parsedRecords)) {
        throw new Error('El contenido no produjo una colección de registros.');
      }
      const records = parsedRecords.filter((row: unknown) => isRecord(row));
      const sampleRows = safeRows(records.slice(0, 5));
      const columnNames = records.length
        ? Object.keys(records[0])
        : firstLine
            .split(delimiter)
            .map((name) => name.trim().replace(/^"|"$/g, ''));
      const columns = columnNames.map((name) => {
        const values = records.slice(0, 100).map((row) => row[name]);
        return {
          name,
          sourceType: inferType(values),
          nullable: values.some(
            (value) => value === null || value === undefined || value === '',
          ),
          sampleValues: sampleRows
            .map((row) => row[name])
            .filter((value) => value !== null && value !== undefined)
            .slice(0, 3),
        };
      });
      return [
        {
          sourceName: parsePath(originalName).name,
          rowCount: records.length,
          columns,
          sampleRows,
        },
      ];
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? `El CSV no es válido: ${error.message}`
          : 'El CSV no es válido.',
      );
    }
  }
}
