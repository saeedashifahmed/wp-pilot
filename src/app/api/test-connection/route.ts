import { NextResponse } from 'next/server';
import type { Client } from 'ssh2';
import { createSSHConnection, execCommand } from '@/lib/ssh';
import { isValidHost, normalizeHost, normalizePrivateKey, parsePort } from '@/lib/validation';
import type { ServerConfig } from '@/types';

export async function POST(request: Request) {
  let conn: Client | null = null;
  try {
    const body = await request.json();
    const host = normalizeHost(body.host);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const port = parsePort(body.port, 22);
    const authMethod: ServerConfig['authMethod'] = body.authMethod === 'key' ? 'key' : 'password';
    const password = typeof body.password === 'string' ? body.password : '';
    const privateKey = normalizePrivateKey(body.privateKey);

    if (!host || !username) {
      return NextResponse.json(
        { success: false, error: 'Host and username are required' },
        { status: 400 }
      );
    }
    if (!isValidHost(host)) {
      return NextResponse.json(
        { success: false, error: 'Invalid host value' },
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

    const config: ServerConfig = {
      host,
      port,
      username,
      authMethod,
      password: authMethod === 'password' ? password : undefined,
      privateKey: authMethod === 'key' ? privateKey : undefined,
    };

    conn = await createSSHConnection(config);

    // Get basic server info
    const [osInfo, memInfo, diskInfo] = await Promise.all([
      execCommand(conn, 'lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''),
      execCommand(conn, "free -h | awk '/^Mem:/{print $2}'"),
      execCommand(conn, "df -h / | awk 'NR==2{print $4}'"),
    ]);

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
    if (conn) {
      conn.end();
    }
  }
}
