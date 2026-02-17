import { Client } from 'ssh2';
import type { ServerConfig } from '@/types';

export function createSSHConnection(config: ServerConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timed out after 20 seconds'));
    }, 20000);

    const connectionConfig: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    };

    if (config.authMethod === 'password') {
      connectionConfig.password = config.password;
    } else {
      connectionConfig.privateKey = config.privateKey;
    }

    conn
      .on('ready', () => {
        clearTimeout(timeout);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .on('close', () => {
        clearTimeout(timeout);
      })
      .connect(connectionConfig);
  });
}

export function execCommand(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (!conn || !(conn as { _sock?: unknown })._sock) {
      return reject(new Error('SSH connection is closed'));
    }

    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream
        .on('close', (code: number) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
        })
        .on('data', (data: Buffer) => {
          stdout += data.toString();
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

export function execCommandWithTimeout(
  conn: Client,
  command: string,
  timeoutMs: number = 120000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command.slice(0, 80)}...`));
    }, timeoutMs);

    execCommand(conn, command)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
