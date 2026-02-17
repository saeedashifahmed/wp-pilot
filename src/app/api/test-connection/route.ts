import { NextResponse } from 'next/server';
import { createSSHConnection, execCommand } from '@/lib/ssh';
import type { ServerConfig } from '@/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const config: ServerConfig = {
      host: body.host,
      port: body.port || 22,
      username: body.username,
      authMethod: body.authMethod || 'password',
      password: body.password,
      privateKey: body.privateKey,
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
