import { NextResponse } from 'next/server';
import type { ServerConfig } from '@/types';
import {
  isValidHost,
  normalizeHost,
  normalizePrivateKey,
  parsePort,
} from '@/lib/validation';

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

  const host = normalizeHost(body.host);
  const port = parsePort(body.port);
  const username = String(body.username || '').trim();
  const authMethod = body.authMethod === 'key' ? 'key' : 'password';
  const password = typeof body.password === 'string' ? body.password : '';
  const privateKey = normalizePrivateKey(body.privateKey);

  if (!isValidHost(host) || !username) {
    return NextResponse.json(
      { success: false, error: 'Host and username are required' },
      { status: 400 }
    );
  }

  if (port === null) {
    return NextResponse.json(
      { success: false, error: 'Port must be an integer between 1 and 65535' },
      { status: 400 }
    );
  }

  if (authMethod === 'password' && !password) {
    return NextResponse.json(
      { success: false, error: 'Password is required for password authentication' },
      { status: 400 }
    );
  }

  if (authMethod === 'key' && !privateKey) {
    return NextResponse.json(
      { success: false, error: 'Private key is required for key authentication' },
      { status: 400 }
    );
  }

  let conn: Awaited<ReturnType<(typeof import('@/lib/ssh'))['createSSHConnection']>> | null = null;

  try {
    // Dynamic import to catch module load failures gracefully
    const { createSSHConnection, execCommand } = await import('@/lib/ssh');

    const config: ServerConfig = {
      host,
      port,
      username,
      authMethod,
      password: authMethod === 'password' ? password : undefined,
      privateKey: authMethod === 'key' ? privateKey : undefined,
    }

    conn = await createSSHConnection(config);
    
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
  } finally {
    try {
      if (conn) {
        conn.end();
      }
    } catch {
      // Ignore connection cleanup errors
    }
  }
}
