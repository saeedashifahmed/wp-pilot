import { Client } from 'ssh2';
import type { ServerConfig } from '@/types';

export function createSSHConnection(config: ServerConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

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
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect(connectionConfig);
  });
}

export function execCommand(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
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
      reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
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
