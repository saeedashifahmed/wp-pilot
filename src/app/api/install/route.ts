import type { ServerConfig, SiteConfig } from '@/types';
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

// Force Node.js runtime — ssh2 requires native modules not available in Edge
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for serverless platforms

function jsonError(message: string, status: number = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  // Step 1: Parse request body safely
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body. Please submit the form again.');
  }

  // Step 2: Validate required fields
  const host = normalizeHost(body.host);
  const username = String(body.username || '').trim();
  const domain = normalizeDomain(body.domain);
  const port = parsePort(body.port);
  const authMethod = body.authMethod === 'key' ? 'key' : 'password';

  const password = typeof body.password === 'string' ? body.password : '';
  const privateKey = normalizePrivateKey(body.privateKey);
  const siteTitle = String(body.siteTitle || 'My WordPress Site').trim() || 'My WordPress Site';
  const adminUser = String(body.adminUser || 'admin').trim() || 'admin';
  const adminEmail = String(body.adminEmail || `admin@${domain}`).trim().toLowerCase();
  const phpVersion = parsePhpVersion(body.phpVersion);

  if (!isValidHost(host) || !username || !domain) {
    return jsonError('Host, username, and domain are required.');
  }
  if (!isValidDomain(domain)) {
    return jsonError('Domain format is invalid. Use a fully qualified domain like example.com.');
  }
  if (port === null) {
    return jsonError('Port must be an integer between 1 and 65535.');
  }
  if (authMethod === 'password' && !password) {
    return jsonError('Password is required for password authentication.');
  }
  if (authMethod === 'key' && !privateKey) {
    return jsonError('Private key is required for key authentication.');
  }
  if (!isValidWpUsername(adminUser)) {
    return jsonError('Admin username must be 1-60 characters using letters, numbers, dots, underscores, or hyphens.');
  }
  if (!isValidEmail(adminEmail)) {
    return jsonError('Admin email format is invalid.');
  }
  if (!phpVersion) {
    return jsonError('Unsupported PHP version. Supported versions: 8.1, 8.2, 8.3, 8.4.');
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
    enableSSL: Boolean(body.enableSSL),
    phpVersion,
  };

  // Step 3: Dynamically import ssh2-dependent modules to catch load failures
  let createSSHConnection: typeof import('@/lib/ssh').createSSHConnection;
  let installWordPress: typeof import('@/lib/wordpress').installWordPress;
  try {
    const sshModule = await import('@/lib/ssh');
    const wpModule = await import('@/lib/wordpress');
    createSSHConnection = sshModule.createSSHConnection;
    installWordPress = wpModule.installWordPress;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown module error';
    return jsonError(
      `Server setup error: ${msg}. The SSH module may not be compatible with this hosting platform.`,
      500
    );
  }

  // Step 4: Create SSE stream
  const encoder = new TextEncoder();
  let controllerClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (step: string, status: string, message: string, details?: string) => {
        if (controllerClosed) return;
        try {
          const data = JSON.stringify({ step, status, message, details });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller is no longer writable (client disconnected)
          controllerClosed = true;
        }
      };

      let conn: Awaited<ReturnType<typeof createSSHConnection>> | null = null;

      try {
        sendEvent('connecting', 'running', 'Connecting to server...');
        conn = await createSSHConnection(serverConfig);
        sendEvent('connecting', 'completed', 'Connected to server');

        const result = await installWordPress(conn, siteConfig, sendEvent, serverConfig.port);

        if (result.success) {
          const protocol = result.sslInstalled ? 'https' : 'http';
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
              sslEnabled: result.sslInstalled,
            },
          };
          if (!controllerClosed) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`));
            } catch {
              controllerClosed = true;
            }
          }
        } else {
          sendEvent('error', 'failed', result.error || 'Installation failed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        sendEvent('error', 'failed', message);
      } finally {
        try { if (conn) conn.end(); } catch { /* ignore */ }
        if (!controllerClosed) {
          try { controller.close(); } catch { /* ignore */ }
        }
        controllerClosed = true;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
