import type { ServerConfig, SiteConfig } from '@/types';

// Force Node.js runtime — ssh2 requires native modules not available in Edge
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for serverless platforms

export async function POST(request: Request) {
  // Step 1: Parse request body safely
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body. Please submit the form again.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Step 2: Validate required fields
  const host = String(body.host || '').trim();
  const username = String(body.username || '').trim();
  const domain = String(body.domain || '').trim();

  if (!host || !username || !domain) {
    return new Response(
      JSON.stringify({ error: 'Host, username, and domain are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const serverConfig: ServerConfig = {
    host,
    port: Number(body.port) || 22,
    username,
    authMethod: body.authMethod === 'key' ? 'key' : 'password',
    password: body.password ? String(body.password) : undefined,
    privateKey: body.privateKey ? String(body.privateKey) : undefined,
  };

  const siteConfig: SiteConfig = {
    domain,
    siteTitle: String(body.siteTitle || 'My WordPress Site'),
    adminUser: String(body.adminUser || 'admin'),
    adminEmail: String(body.adminEmail || `admin@${domain}`),
    enableSSL: Boolean(body.enableSSL),
    phpVersion: String(body.phpVersion || '8.3'),
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
    return new Response(
      JSON.stringify({ error: `Server setup error: ${msg}. The SSH module may not be compatible with this hosting platform.` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
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

        const result = await installWordPress(conn, siteConfig, sendEvent);

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
