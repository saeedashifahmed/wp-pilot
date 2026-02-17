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
