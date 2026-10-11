import { TransformFnParams } from 'class-transformer';

/**
 * Strips HTML tags, script signatures, event handlers, and javascript: URIs
 * from string values in NestJS DTOs before class-validator or service handlers process them.
 */
export function sanitizeString({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    // Remove explicit <script> tags and contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove inline event handlers (onerror=, onload=, etc.)
    .replace(/on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    // Remove javascript: and data: URIs
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    // Remove remaining HTML tags
    .replace(/<[^>]*>/g, '')
    .trim();
}
