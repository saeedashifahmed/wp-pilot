import { createSSHConnection } from '@/lib/ssh';
import { installWordPress } from '@/lib/wordpress';
import type { Client } from 'ssh2';
import {
  isValidDomain,
  isValidEmail,
  isValidHost,
  isValidWpUsername,
  normalizeDomain,
  normalizeHost,
  normalizePrivateKey,
  parsePhpVersion,
  parsePort,
} from '@/lib/validation';
import type { ServerConfig, SiteConfig } from '@/types';

export const maxDuration = 300; // 5 minutes for serverless platforms

function jsonError(error: string, status: number = 400): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const host = normalizeHost(body.host);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const port = parsePort(body.port, 22);
    const authMethod: ServerConfig['authMethod'] = body.authMethod === 'key' ? 'key' : 'password';
    const password = typeof body.password === 'string' ? body.password : '';
    const privateKey = normalizePrivateKey(body.privateKey);

    const domain = normalizeDomain(body.domain);
    const siteTitle = typeof body.siteTitle === 'string' && body.siteTitle.trim() ? body.siteTitle.trim() : 'My WordPress Site';
    const adminUser = typeof body.adminUser === 'string' && body.adminUser.trim() ? body.adminUser.trim() : 'admin';
    const rawAdminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim() : '';
    const adminEmail = rawAdminEmail || `admin@${domain}`;
    const phpVersion = parsePhpVersion(body.phpVersion, '8.3');
    const enableSSL = body.enableSSL === true;

    if (!host || !username || !domain) {
      return jsonError('Host, username, and domain are required');
    }
    if (!isValidHost(host)) {
      return jsonError('Invalid host value');
    }
    if (port === null) {
      return jsonError('Port must be an integer between 1 and 65535');
    }
    if (authMethod === 'password' && !password) {
      return jsonError('Password is required for password authentication');
    }
    if (authMethod === 'key' && !privateKey) {
      return jsonError('Private key is required for key authentication');
    }
    if (!isValidDomain(domain)) {
      return jsonError('Please provide a valid domain name (example.com)');
    }
    if (!isValidWpUsername(adminUser)) {
      return jsonError('Admin username may only contain letters, numbers, ".", "_" or "-"');
    }
    if (!isValidEmail(adminEmail)) {
      return jsonError('Please provide a valid admin email address');
    }
    if (!phpVersion) {
      return jsonError('Unsupported PHP version selected');
    }

    const serverConfig: ServerConfig = {
      host,
      port,
      username,
      authMethod,
      password: authMethod === 'password' ? password : undefined,
      privateKey: authMethod === 'key' ? privateKey : undefined,
    };

    const siteConfig: SiteConfig = {
      domain,
      siteTitle,
      adminUser,
      adminEmail,
      enableSSL,
      phpVersion,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (step: string, status: string, message: string, details?: string) => {
          const data = JSON.stringify({ step, status, message, details });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        let conn: Client | null = null;
        try {
          sendEvent('connecting', 'running', 'Connecting to server...');
          conn = await createSSHConnection(serverConfig);
          sendEvent('connecting', 'completed', 'Connected to server');

          const result = await installWordPress(conn, siteConfig, sendEvent);

          if (result.success) {
            const protocol = result.sslEnabled ? 'https' : 'http';
            const completionData = {
              step: 'done',
              status: 'completed',
              message: 'Installation complete!',
              result: {
                siteUrl: `${protocol}://${siteConfig.domain}`,
                adminUrl: `${protocol}://${siteConfig.domain}/wp-admin`,
                adminUser: siteConfig.adminUser,
                adminPassword: result.adminPassword,
                dbName: result.dbName,
                dbUser: result.dbUser,
                dbPassword: result.dbPassword,
                sslRequested: siteConfig.enableSSL,
                sslEnabled: result.sslEnabled,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`));
          } else {
            sendEvent('error', 'failed', result.error || 'Installation failed');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          sendEvent('error', 'failed', message);
        } finally {
          if (conn) conn.end();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
