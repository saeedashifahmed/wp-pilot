const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WP_USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,60}$/;

export const SUPPORTED_PHP_VERSIONS = ['8.1', '8.2', '8.3', '8.4'] as const;

type SupportedPhpVersion = (typeof SUPPORTED_PHP_VERSIONS)[number];

export function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  let host = value.trim();
  host = host.replace(/^https?:\/\//i, '');
  host = host.replace(/\/.+$/, '');

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  return host.trim();
}

export function isValidHost(host: string): boolean {
  return host.length > 0 && !/\s/.test(host);
}

export function parsePort(value: unknown, defaultPort: number = 22): number | null {
  if (value === undefined || value === null || value === '') {
    return defaultPort;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }

  return parsed;
}

export function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  let domain = value.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//i, '');
  domain = domain.replace(/\/.+$/, '');
  domain = domain.replace(/\.$/, '');

  return domain;
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function isValidWpUsername(username: string): boolean {
  return WP_USERNAME_PATTERN.test(username);
}

export function parsePhpVersion(value: unknown, defaultVersion: SupportedPhpVersion = '8.3'): SupportedPhpVersion | null {
  if (value === undefined || value === null || value === '') {
    return defaultVersion;
  }

  const candidate = String(value).trim() as SupportedPhpVersion;
  if (SUPPORTED_PHP_VERSIONS.includes(candidate)) {
    return candidate;
  }

  return null;
}

export function normalizePrivateKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\\n/g, '\n').trim();
}
