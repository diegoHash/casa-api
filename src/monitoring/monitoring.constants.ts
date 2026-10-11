export const MONITORING_RETENTION_DAYS = 30;
export const MONITORING_MAX_STACK_BYTES = 240_000;
export const MONITORING_MAX_MESSAGE_BYTES = 1_900;

export function truncateUtf8(value: string, maxBytes: number) {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return { value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return { value: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

export function sanitizeDiagnostic(value: string) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(password|passwd|secret|token|authorization|api[_-]?key)(\s*[:=]\s*)([^\s,;"']+)/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:token|access_token|refresh_token|password)=)[^&\s]+/gi, '$1[REDACTED]');
}
