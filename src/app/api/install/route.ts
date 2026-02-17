import { createSSHConnection } from '@/lib/ssh';
import { installWordPress } from '@/lib/wordpress';
import type { ServerConfig, SiteConfig } from '@/types';

export const maxDuration = 300; // 5 minutes for serverless platforms

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const serverConfig: ServerConfig = {
      host: body.host,
      port: body.port || 22,
      username: body.username,
      authMethod: body.authMethod || 'password',
      password: body.password,
      privateKey: body.privateKey,
    };

    const siteConfig: SiteConfig = {
      domain: body.domain,
      siteTitle: body.siteTitle || 'My WordPress Site',
      adminUser: body.adminUser || 'admin',
      adminEmail: body.adminEmail || `admin@${body.domain}`,
      enableSSL: body.enableSSL ?? false,
      phpVersion: body.phpVersion || '8.3',
    };

    if (!serverConfig.host || !serverConfig.username || !siteConfig.domain) {
      return new Response(
        JSON.stringify({ error: 'Host, username, and domain are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (step: string, status: string, message: string, details?: string) => {
          const data = JSON.stringify({ step, status, message, details });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        let conn;
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
