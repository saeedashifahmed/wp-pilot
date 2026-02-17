import { Client, type ConnectConfig } from 'ssh2';
import type { ServerConfig } from '@/types';

export function createSSHConnection(config: ServerConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const resolveOnce = (client: Client) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(client);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const timeout = setTimeout(() => {
      try {
        conn.end();
      } catch {
        // Ignore timeout cleanup errors
      }
      rejectOnce(new Error('SSH connection timed out after 20 seconds'));
    }, 20000);

    const connectionConfig: ConnectConfig = {
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
      .once('ready', () => {
        resolveOnce(conn);
      })
      .once('error', (err) => {
        rejectOnce(err instanceof Error ? err : new Error('SSH connection error'));
      })
      .once('close', () => {
        if (!settled) {
          rejectOnce(new Error('SSH connection closed before becoming ready'));
        }
      })
      .connect(connectionConfig);
  });
}

export function execCommand(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const resolveOnce = (result: { stdout: string; stderr: string; code: number }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      stream
        .on('close', (code: number) => {
          resolveOnce({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
        })
        .on('data', (data: Buffer) => {
          stdout += data.toString();
        })
        .on('error', (err: Error) => {
          rejectOnce(err);
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
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        conn.end();
      } catch {
        // Ignore timeout cleanup errors
      }
      reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command.slice(0, 80)}...`));
    }, timeoutMs);

    execCommand(conn, command)
      .then((result) => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (timedOut) return;
        reject(err);
      });
  });
}
