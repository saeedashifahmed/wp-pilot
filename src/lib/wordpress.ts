import { Client } from 'ssh2';
import crypto from 'crypto';
import { execCommandWithTimeout } from './ssh';
import { isValidDomain, normalizeDomain, parsePhpVersion } from './validation';
import type { SiteConfig } from '@/types';

type ProgressStatus = 'running' | 'completed' | 'failed';
type ProgressCallback = (step: string, status: ProgressStatus, message: string, details?: string) => void;

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function generatePassword(length: number = 24): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function sanitizeDbName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '').slice(0, 28);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandErrorOutput(result: CommandResult): string {
  return (result.stderr || result.stdout || `exit code ${result.code}`).trim();
}

async function runCheckedCommand(
  conn: Client,
  command: string,
  context: string,
  timeoutMs: number = 120000
): Promise<CommandResult> {
  const result = await execCommandWithTimeout(conn, command, timeoutMs);
  if (result.code !== 0) {
    throw new Error(`${context}: ${commandErrorOutput(result)}`);
  }

  return result;
}

export async function installWordPress(
  conn: Client,
  site: SiteConfig,
  onProgress: ProgressCallback,
  sshPort: number = 22
): Promise<{
  success: boolean;
  sslInstalled: boolean;
  adminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  error?: string;
}> {
  const domain = normalizeDomain(site.domain);
  const parsedPhpVersion = parsePhpVersion(site.phpVersion);

  if (!isValidDomain(domain)) {
    throw new Error('Domain format is invalid. Use a fully qualified domain like example.com.');
  }

  if (!parsedPhpVersion) {
    throw new Error('Unsupported PHP version. Supported versions: 8.1, 8.2, 8.3, 8.4.');
  }

  const phpVersion = parsedPhpVersion;
  const dbSuffix = sanitizeDbName(domain) || 'site';
  const dbName = `wp_${dbSuffix}`.slice(0, 64);
  const dbUser = `wp_${dbSuffix}`.slice(0, 32);
  const dbPassword = generatePassword(32);
  const adminPassword = generatePassword(20);
  const siteTitle = site.siteTitle.trim() || 'My WordPress Site';
  const adminUser = site.adminUser.trim() || 'admin';
  const adminEmail = site.adminEmail.trim().toLowerCase();
  const wpDir = `/var/www/${domain}`;
  const wpDirArg = shellEscape(wpDir);
  const wpConfigPathArg = shellEscape(`${wpDir}/wp-config.php`);
  const effectiveSshPort = Number.isInteger(sshPort) && sshPort >= 1 && sshPort <= 65535 ? sshPort : 22;
  let sslInstalled = false;

  try {
    onProgress('system-update', 'running', 'Updating system packages...');
    await runCheckedCommand(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get update 2>&1',
      'System update failed',
      180000
    );
    onProgress('system-update', 'completed', 'System packages updated');

    onProgress('nginx', 'running', 'Installing Nginx...');
    const nginxCheck = await execCommandWithTimeout(conn, 'command -v nginx >/dev/null 2>&1', 15000);
    if (nginxCheck.code !== 0) {
      await runCheckedCommand(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y nginx 2>&1',
        'Nginx installation failed',
        120000
      );
    }
    await runCheckedCommand(conn, 'sudo systemctl enable nginx && sudo systemctl start nginx', 'Nginx service setup failed');
    onProgress('nginx', 'completed', 'Nginx installed and running');

    onProgress('database', 'running', 'Installing MariaDB...');
    const dbCheck = await execCommandWithTimeout(conn, 'command -v mariadb >/dev/null 2>&1 || command -v mysql >/dev/null 2>&1', 15000);
    if (dbCheck.code !== 0) {
      await runCheckedCommand(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y mariadb-server mariadb-client 2>&1',
        'MariaDB installation failed',
        180000
      );
    }
    await runCheckedCommand(conn, 'sudo systemctl enable mariadb && sudo systemctl start mariadb', 'MariaDB service setup failed');
    onProgress('database', 'completed', 'MariaDB installed and running');

    onProgress('php', 'running', `Installing PHP ${phpVersion} and extensions...`);
    await runCheckedCommand(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y software-properties-common 2>&1',
      'PHP prerequisite installation failed'
    );
    await runCheckedCommand(
      conn,
      'if ! grep -Rqs "ondrej/php" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then sudo add-apt-repository -y ppa:ondrej/php; fi',
      'PHP repository setup failed',
      120000
    );
    await runCheckedCommand(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get update 2>&1',
      'Package index refresh failed after PHP repository setup',
      180000
    );

    const phpExtensions = [
      `php${phpVersion}-fpm`,
      `php${phpVersion}-mysql`,
      `php${phpVersion}-curl`,
      `php${phpVersion}-gd`,
      `php${phpVersion}-mbstring`,
      `php${phpVersion}-xml`,
      `php${phpVersion}-zip`,
      `php${phpVersion}-intl`,
      `php${phpVersion}-soap`,
      `php${phpVersion}-bcmath`,
      `php${phpVersion}-imagick`,
    ].join(' ');

    await runCheckedCommand(
      conn,
      `export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y ${phpExtensions} 2>&1`,
      'PHP installation failed',
      180000
    );
    await runCheckedCommand(
      conn,
      `sudo systemctl enable php${phpVersion}-fpm && sudo systemctl start php${phpVersion}-fpm`,
      'PHP-FPM service setup failed'
    );
    onProgress('php', 'completed', `PHP ${phpVersion} installed with extensions`);

    onProgress('db-config', 'running', 'Creating WordPress database and user...');
    const dbCommands = [
      `sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`,
      `sudo mariadb -e "CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}';"`,
      `sudo mariadb -e "GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'localhost';"`,
      'sudo mariadb -e "FLUSH PRIVILEGES;"',
    ];

    for (const cmd of dbCommands) {
      await runCheckedCommand(conn, cmd, 'Database setup failed');
    }
    onProgress('db-config', 'completed', 'Database and user created');

    onProgress('wordpress', 'running', 'Downloading latest WordPress...');
    const wpCommands = [
      'sudo rm -rf /tmp/wordpress /tmp/wordpress.tar.gz',
      `sudo mkdir -p ${wpDirArg}`,
      'cd /tmp && sudo curl -fsSL --retry 3 --retry-delay 2 -o wordpress.tar.gz https://wordpress.org/latest.tar.gz',
      'cd /tmp && sudo tar -xzf wordpress.tar.gz',
      `sudo cp -a /tmp/wordpress/. ${wpDirArg}`,
      'sudo rm -rf /tmp/wordpress /tmp/wordpress.tar.gz',
    ];

    for (const cmd of wpCommands) {
      await runCheckedCommand(conn, cmd, 'WordPress download failed', 120000);
    }
    onProgress('wordpress', 'completed', 'WordPress downloaded');

    onProgress('wp-config', 'running', 'Configuring WordPress...');
    const saltKeys = [
      'AUTH_KEY',
      'SECURE_AUTH_KEY',
      'LOGGED_IN_KEY',
      'NONCE_KEY',
      'AUTH_SALT',
      'SECURE_AUTH_SALT',
      'LOGGED_IN_SALT',
      'NONCE_SALT',
    ];

    const salts = saltKeys
      .map((key) => {
        const salt = generatePassword(64);
        return `define('${key}', '${salt}');`;
      })
      .join('\n');

    const wpConfig = `<?php
 define('DB_NAME', '${dbName}');
 define('DB_USER', '${dbUser}');
 define('DB_PASSWORD', '${dbPassword}');
 define('DB_HOST', 'localhost');
 define('DB_CHARSET', 'utf8mb4');
 define('DB_COLLATE', '');
 
 ${salts}
 
 $table_prefix = 'wp_';
 
 define('WP_DEBUG', false);
 define('WP_MEMORY_LIMIT', '256M');
 define('WP_MAX_MEMORY_LIMIT', '512M');
 define('FS_METHOD', 'direct');
 define('DISALLOW_FILE_EDIT', true);
 
 if (!defined('ABSPATH')) {
   define('ABSPATH', __DIR__ . '/');
 }
 
 require_once ABSPATH . 'wp-settings.php';
`;

    const writeConfigCmd = `sudo tee ${wpConfigPathArg} > /dev/null << 'WPEOF'
${wpConfig}
WPEOF`;

    await runCheckedCommand(conn, writeConfigCmd, 'WordPress config write failed', 60000);
    await runCheckedCommand(conn, `sudo chown -R www-data:www-data ${wpDirArg}`, 'WordPress ownership update failed', 60000);
    await runCheckedCommand(conn, `sudo find ${wpDirArg} -type d -exec chmod 755 {} \\;`, 'Directory permission update failed', 60000);
    await runCheckedCommand(conn, `sudo find ${wpDirArg} -type f -exec chmod 644 {} \\;`, 'File permission update failed', 60000);
    onProgress('wp-config', 'completed', 'WordPress configured');

    onProgress('nginx-config', 'running', 'Setting up Nginx virtual host...');
    const fastcgiSnippetCheck = await execCommandWithTimeout(conn, 'test -f /etc/nginx/snippets/fastcgi-php.conf', 10000);
    const phpLocationBlock = fastcgiSnippetCheck.code === 0
      ? `location ~ \\.php$ {
         include snippets/fastcgi-php.conf;
         fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
       }`
      : `location ~ \\.php$ {
         include fastcgi_params;
         fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
         fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
       }`;

    const nginxConfig = `server {
     listen 80;
     listen [::]:80;
     server_name ${domain} www.${domain};
     root ${wpDir};
     index index.php index.html;
 
     client_max_body_size 64M;
 
     location / {
       try_files $uri $uri/ /index.php?$args;
     }
 
     ${phpLocationBlock}
 
     location ~ /\\.ht {
       deny all;
     }
 
     location = /favicon.ico {
       log_not_found off;
       access_log off;
     }
 
     location = /robots.txt {
       allow all;
       log_not_found off;
       access_log off;
     }
 
     location ~* \\.(css|gif|ico|jpeg|jpg|js|png|svg|woff|woff2|ttf|eot)$ {
       expires 30d;
       add_header Cache-Control "public, immutable";
     }
   }`;

    const nginxSitePath = `/etc/nginx/sites-available/${domain}`;
    const writeNginxCmd = `sudo tee ${shellEscape(nginxSitePath)} > /dev/null << 'NGINXEOF'
${nginxConfig}
NGINXEOF`;

    await runCheckedCommand(conn, writeNginxCmd, 'Nginx configuration write failed', 60000);
    await runCheckedCommand(
      conn,
      `sudo ln -sfn ${shellEscape(nginxSitePath)} ${shellEscape(`/etc/nginx/sites-enabled/${domain}`)}`,
      'Nginx site enable failed'
    );
    await runCheckedCommand(conn, 'sudo rm -f /etc/nginx/sites-enabled/default', 'Nginx default site cleanup failed');
    await runCheckedCommand(conn, 'sudo nginx -t 2>&1', 'Nginx configuration test failed', 30000);
    await runCheckedCommand(conn, 'sudo systemctl reload nginx', 'Nginx reload failed', 30000);
    onProgress('nginx-config', 'completed', 'Nginx virtual host configured');

    onProgress('wp-install', 'running', 'Running WordPress installation...');
    const wpCliCheck = await execCommandWithTimeout(conn, 'command -v wp >/dev/null 2>&1', 10000);
    if (wpCliCheck.code !== 0) {
      await runCheckedCommand(
        conn,
        'curl -fsSL --retry 3 --retry-delay 2 -o /tmp/wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
        'WP-CLI download failed',
        60000
      );
      await runCheckedCommand(conn, 'php /tmp/wp-cli.phar --info >/dev/null', 'WP-CLI PHAR validation failed', 30000);
      await runCheckedCommand(conn, 'sudo install -m 0755 /tmp/wp-cli.phar /usr/local/bin/wp', 'WP-CLI installation failed', 30000);
      await runCheckedCommand(conn, 'rm -f /tmp/wp-cli.phar', 'WP-CLI cleanup failed', 15000);
    }

    const siteUrl = `http://${domain}`;
    const wpInstallCmd = [
      'sudo -u www-data wp core install',
      `--path=${shellEscape(wpDir)}`,
      `--url=${shellEscape(siteUrl)}`,
      `--title=${shellEscape(siteTitle)}`,
      `--admin_user=${shellEscape(adminUser)}`,
      `--admin_password=${shellEscape(adminPassword)}`,
      `--admin_email=${shellEscape(adminEmail)}`,
      '--skip-email',
      '2>&1',
    ].join(' ');

    await runCheckedCommand(conn, wpInstallCmd, 'WordPress core install failed', 120000);
    onProgress('wp-install', 'completed', 'WordPress installed successfully');

    onProgress('security', 'running', 'Applying security hardening...');
    const ufwCheck = await execCommandWithTimeout(conn, 'command -v ufw >/dev/null 2>&1', 10000);
    if (ufwCheck.code !== 0) {
      await runCheckedCommand(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y ufw 2>&1',
        'UFW installation failed',
        120000
      );
    }

    await runCheckedCommand(conn, `sudo ufw allow ${effectiveSshPort}/tcp`, 'Firewall SSH rule setup failed', 30000);
    await runCheckedCommand(conn, 'sudo ufw allow 80/tcp', 'Firewall HTTP rule setup failed', 30000);
    await runCheckedCommand(conn, 'sudo ufw allow 443/tcp', 'Firewall HTTPS rule setup failed', 30000);
    await runCheckedCommand(conn, 'sudo ufw --force enable', 'Firewall enable failed', 30000);

    const phpIniPath = shellEscape(`/etc/php/${phpVersion}/fpm/php.ini`);
    const phpTuningCommands = [
      `sudo sed -i -E "s~^;?upload_max_filesize\\s*=.*$~upload_max_filesize = 64M~" ${phpIniPath}`,
      `sudo sed -i -E "s~^;?post_max_size\\s*=.*$~post_max_size = 64M~" ${phpIniPath}`,
      `sudo sed -i -E "s~^;?max_execution_time\\s*=.*$~max_execution_time = 300~" ${phpIniPath}`,
      `sudo sed -i -E "s~^;?memory_limit\\s*=.*$~memory_limit = 256M~" ${phpIniPath}`,
    ];

    for (const cmd of phpTuningCommands) {
      await runCheckedCommand(conn, cmd, 'PHP hardening configuration failed', 30000);
    }

    await runCheckedCommand(conn, `sudo systemctl restart php${phpVersion}-fpm`, 'PHP-FPM restart failed', 30000);
    onProgress('security', 'completed', 'Security hardening applied');

    if (site.enableSSL) {
      onProgress('ssl', 'running', 'Setting up SSL with Let\'s Encrypt...');

      await runCheckedCommand(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y certbot python3-certbot-nginx 2>&1',
        'Certbot installation failed',
        120000
      );

      const apexDns = await execCommandWithTimeout(
        conn,
        `getent ahostsv4 ${shellEscape(domain)} | awk '{print $1}' | head -1`,
        15000
      );
      const wwwDns = await execCommandWithTimeout(
        conn,
        `getent ahostsv4 ${shellEscape(`www.${domain}`)} | awk '{print $1}' | head -1`,
        15000
      );

      let certDomains = `-d ${shellEscape(domain)}`;
      if (wwwDns.stdout.trim() && apexDns.stdout.trim() && wwwDns.stdout.trim() === apexDns.stdout.trim()) {
        certDomains += ` -d ${shellEscape(`www.${domain}`)}`;
      }

      const certCmd = [
        'sudo certbot --nginx',
        certDomains,
        '--non-interactive',
        '--agree-tos',
        `--email ${shellEscape(adminEmail)}`,
        '--redirect',
        '2>&1',
      ].join(' ');

      const certResult = await execCommandWithTimeout(conn, certCmd, 240000);
      if (certResult.code !== 0) {
        const certError = commandErrorOutput(certResult).slice(0, 240);
        onProgress('ssl', 'failed', `SSL setup failed. ${certError}`);
      } else {
        await runCheckedCommand(conn, 'sudo systemctl reload nginx', 'Nginx reload after SSL failed', 30000);

        const siteUrlUpdate = await execCommandWithTimeout(
          conn,
          `sudo -u www-data wp option update siteurl ${shellEscape(`https://${domain}`)} --path=${shellEscape(wpDir)} 2>&1`,
          30000
        );
        const homeUrlUpdate = await execCommandWithTimeout(
          conn,
          `sudo -u www-data wp option update home ${shellEscape(`https://${domain}`)} --path=${shellEscape(wpDir)} 2>&1`,
          30000
        );

        sslInstalled = true;

        if (siteUrlUpdate.code === 0 && homeUrlUpdate.code === 0) {
          onProgress('ssl', 'completed', 'SSL certificate installed and WordPress updated to HTTPS');
        } else {
          onProgress(
            'ssl',
            'completed',
            'SSL certificate installed. Update siteurl/home manually if WordPress still uses HTTP.'
          );
        }
      }
    }

    onProgress('complete', 'completed', 'WordPress installation complete!');

    return {
      success: true,
      sslInstalled,
      adminPassword,
      dbName,
      dbUser,
      dbPassword,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    onProgress('error', 'failed', errorMessage);

    return {
      success: false,
      sslInstalled: false,
      adminPassword: '',
      dbName: '',
      dbUser: '',
      dbPassword: '',
      error: errorMessage,
    };
  }
}
