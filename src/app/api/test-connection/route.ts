import { NextResponse } from 'next/server';
import type { ServerConfig } from '@/types';

// Force Node.js runtime — ssh2 requires native modules
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  try {
    // Dynamic import to catch module load failures gracefully
    const { createSSHConnection, execCommand } = await import('@/lib/ssh');

    const config: ServerConfig = {
      host: String(body.host || '').trim(),
      port: Number(body.port) || 22,
      username: String(body.username || '').trim(),
      authMethod: body.authMethod === 'key' ? 'key' : 'password',
      password: body.password ? String(body.password) : undefined,
      privateKey: body.privateKey ? String(body.privateKey) : undefined,
    };

    if (!config.host || !config.username) {
      return NextResponse.json(
        { success: false, error: 'Host and username are required' },
        { status: 400 }
      );
    }

    const conn = await createSSHConnection(config);
    
    // Get basic server info
    const [osInfo, memInfo, diskInfo] = await Promise.all([
      execCommand(conn, 'lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''),
      execCommand(conn, "free -h | awk '/^Mem:/{print $2}'"),
      execCommand(conn, "df -h / | awk 'NR==2{print $4}'"),
    ]);

    conn.end();

    return NextResponse.json({
      success: true,
      server: {
        os: osInfo.stdout || 'Unknown',
        memory: memInfo.stdout || 'Unknown',
        diskFree: diskInfo.stdout || 'Unknown',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
