export interface ServerConfig {
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key';
  password?: string;
  privateKey?: string;
}

export interface SiteConfig {
  domain: string;
  siteTitle: string;
  adminUser: string;
  adminEmail: string;
  enableSSL: boolean;
  phpVersion: string;
}

export interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export interface InstallProgress {
  step: string;
  status: 'running' | 'completed' | 'failed';
  message: string;
  details?: string;
}

export interface InstallResult {
  success: boolean;
  siteUrl: string;
  adminUrl: string;
  adminUser: string;
  adminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  error?: string;
}
