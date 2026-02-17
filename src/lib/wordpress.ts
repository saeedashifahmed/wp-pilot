import crypto from 'crypto';
import { Client } from 'ssh2';
import type { SiteConfig } from '@/types';
import { execCommand, execCommandWithTimeout } from './ssh';

type ProgressCallback = (step: string, status: string, message: string, details?: string) => void;
type CommandResult = { stdout: string; stderr: string; code: number };
type InstallResult = {
  success: boolean;
  adminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sslEnabled: boolean;
  error?: string;
};

function generatePassword(length: number = 24): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function sanitizeDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase();
  normalized = normalized.replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/.+$/, '');
  normalized = normalized.replace(/\.$/, '');
  return normalized.replace(/[^a-z0-9.-]/g, '');
}

function sanitizeDbName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getErrorOutput(result: CommandResult): string {
  return result.stderr || result.stdout || 'No output';
}

function ensureSuccess(result: CommandResult, context: string): void {
  if (result.code !== 0) {
    throw new Error(`${context}: ${getErrorOutput(result)}`);
  }
}

export async function installWordPress(
  conn: Client,
  site: SiteConfig,
  onProgress: ProgressCallback
): Promise<InstallResult> {
  const domain = sanitizeDomain(site.domain);
  if (!domain) {
    return {
      success: false,
      adminPassword: '',
      dbName: '',
      dbUser: '',
      dbPassword: '',
      sslEnabled: false,
      error: 'Invalid domain provided',
    };
  }

  const dbName = `wp_${sanitizeDbName(domain)}`;
  const dbUser = `wp_${sanitizeDbName(domain)}`.slice(0, 16);
  const dbPassword = generatePassword();
  const adminPassword = generatePassword(16);
  const phpVersion = site.phpVersion || '8.3';
  const safeTitle = site.siteTitle.trim() || 'My WordPress Site';
  const safeAdminUser = site.adminUser.trim() || 'admin';
  const safeAdminEmail = site.adminEmail.trim() || `admin@${domain}`;
  const wpDir = `/var/www/${domain}`;
  const wpDirQuoted = shellQuote(wpDir);
  let sslEnabled = false;

  try {
    // Step 1: System update
    onProgress('system-update', 'running', 'Updating system packages...');
    const updateResult = await execCommandWithTimeout(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get update 2>&1',
      180000
    );
    ensureSuccess(updateResult, 'System update failed');

    const baseTools = await execCommandWithTimeout(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y curl tar ca-certificates software-properties-common 2>&1',
      180000
    );
    ensureSuccess(baseTools, 'Base package installation failed');

    onProgress('system-update', 'completed', 'System packages updated');

    // Step 2: Install Nginx
    onProgress('nginx', 'running', 'Installing Nginx...');
    const nginxCheck = await execCommand(conn, 'which nginx 2>/dev/null');
    if (nginxCheck.code !== 0) {
      const nginxResult = await execCommandWithTimeout(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y nginx 2>&1',
        120000
      );
      ensureSuccess(nginxResult, 'Nginx installation failed');
    }
    ensureSuccess(await execCommand(conn, 'sudo systemctl enable nginx && sudo systemctl start nginx'), 'Nginx startup failed');
    onProgress('nginx', 'completed', 'Nginx installed and running');

    // Step 3: Install MariaDB
    onProgress('database', 'running', 'Installing MariaDB...');
    const dbCheck = await execCommand(conn, 'which mariadb 2>/dev/null || which mysql 2>/dev/null');
    if (dbCheck.code !== 0) {
      const dbResult = await execCommandWithTimeout(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y mariadb-server mariadb-client 2>&1',
        180000
      );
      ensureSuccess(dbResult, 'MariaDB installation failed');
    }
    ensureSuccess(await execCommand(conn, 'sudo systemctl enable mariadb && sudo systemctl start mariadb'), 'MariaDB startup failed');
    onProgress('database', 'completed', 'MariaDB installed and running');

    // Step 4: Install PHP
    onProgress('php', 'running', `Installing PHP ${phpVersion} and extensions...`);

    const phpPackageProbe = await execCommand(conn, `apt-cache show php${phpVersion}-fpm >/dev/null 2>&1`);
    if (phpPackageProbe.code !== 0) {
      const repoResult = await execCommandWithTimeout(
        conn,
        'sudo add-apt-repository -y ppa:ondrej/php 2>&1 && sudo apt-get update 2>&1',
        180000
      );
      ensureSuccess(repoResult, 'PHP repository setup failed');
    }

    const requiredPhpPackages = [
      `php${phpVersion}-fpm`,
      `php${phpVersion}-cli`,
      `php${phpVersion}-mysql`,
      `php${phpVersion}-curl`,
      `php${phpVersion}-gd`,
      `php${phpVersion}-mbstring`,
      `php${phpVersion}-xml`,
      `php${phpVersion}-zip`,
      `php${phpVersion}-intl`,
    ].join(' ');

    const requiredPhpResult = await execCommandWithTimeout(
      conn,
      `export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y ${requiredPhpPackages} 2>&1`,
      240000
    );
    ensureSuccess(requiredPhpResult, 'PHP installation failed');

    const optionalPhpPackages = [
      `php${phpVersion}-soap`,
      `php${phpVersion}-bcmath`,
      `php${phpVersion}-imagick`,
    ];

    const skippedOptional: string[] = [];
    for (const pkg of optionalPhpPackages) {
      const optionalResult = await execCommandWithTimeout(
        conn,
        `export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y ${pkg} 2>&1`,
        120000
      );
      if (optionalResult.code !== 0) {
        skippedOptional.push(pkg);
      }
    }

    ensureSuccess(
      await execCommand(conn, `sudo systemctl enable php${phpVersion}-fpm && sudo systemctl start php${phpVersion}-fpm`),
      'PHP-FPM startup failed'
    );
    onProgress(
      'php',
      'completed',
      `PHP ${phpVersion} installed with extensions`,
      skippedOptional.length > 0 ? `Skipped optional extensions: ${skippedOptional.join(', ')}` : undefined
    );

    // Step 5: Configure database
    onProgress('db-config', 'running', 'Creating WordPress database and user...');
    const dbCommands = [
      `sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`,
      `sudo mariadb -e "CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}';"`,
      `sudo mariadb -e "GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'localhost';"`,
      `sudo mariadb -e "FLUSH PRIVILEGES;"`,
    ];
    for (const cmd of dbCommands) {
      const result = await execCommand(conn, cmd);
      ensureSuccess(result, 'Database setup failed');
    }
    onProgress('db-config', 'completed', 'Database and user created');

    // Step 6: Download WordPress
    onProgress('wordpress', 'running', 'Downloading latest WordPress...');
    const wpCommands = [
      `sudo mkdir -p ${wpDirQuoted}`,
      `sudo find ${wpDirQuoted} -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true`,
      `cd /tmp && sudo rm -rf wordpress wordpress.tar.gz && sudo curl -fsSL -o wordpress.tar.gz https://wordpress.org/latest.tar.gz`,
      `cd /tmp && sudo tar -xzf wordpress.tar.gz`,
      `sudo cp -a /tmp/wordpress/. ${shellQuote(`${wpDir}/`)}`,
      `sudo rm -rf /tmp/wordpress /tmp/wordpress.tar.gz`,
    ];
    for (const cmd of wpCommands) {
      const result = await execCommandWithTimeout(conn, cmd, 120000);
      ensureSuccess(result, 'WordPress download failed');
    }
    onProgress('wordpress', 'completed', 'WordPress downloaded');

    // Step 7: Configure WordPress
    onProgress('wp-config', 'running', 'Configuring WordPress...');

    // Generate WordPress salts
    const saltKeys = [
      'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'
    ];
    const salts = saltKeys.map((key) => {
      const salt = generatePassword(64);
      return `define('${key}', '${salt}');`;
    }).join('\n');

    const wpConfig = `<?php
define('DB_NAME', '${dbName}');
define('DB_USER', '${dbUser}');
define('DB_PASSWORD', '${dbPassword}');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

${salts}

\$table_prefix = 'wp_';

define('WP_DEBUG', false);
define('WP_MEMORY_LIMIT', '256M');
define('WP_MAX_MEMORY_LIMIT', '512M');
define('FS_METHOD', 'direct');
define('DISALLOW_FILE_EDIT', true);

if ( ! defined('ABSPATH') ) {
    define('ABSPATH', __DIR__ . '/');
}

require_once ABSPATH . 'wp-settings.php';
`;

    // Write wp-config.php using heredoc to avoid escaping issues
    const writeConfigCmd = `sudo tee ${shellQuote(`${wpDir}/wp-config.php`)} > /dev/null << 'WPEOF'
${wpConfig}
WPEOF`;

    const configResult = await execCommand(conn, writeConfigCmd);
    ensureSuccess(configResult, 'WordPress configuration failed');

    // Set permissions
    ensureSuccess(await execCommand(conn, `sudo chown -R www-data:www-data ${wpDirQuoted}`), 'WordPress ownership update failed');
    ensureSuccess(await execCommand(conn, `sudo find ${wpDirQuoted} -type d -exec chmod 755 {} \\;`), 'Directory permissions update failed');
    ensureSuccess(await execCommand(conn, `sudo find ${wpDirQuoted} -type f -exec chmod 644 {} \\;`), 'File permissions update failed');

    onProgress('wp-config', 'completed', 'WordPress configured');

    // Step 8: Configure Nginx
    onProgress('nginx-config', 'running', 'Setting up Nginx virtual host...');
    const buildNginxConfig = (useSnippet: boolean) => `server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};
    root ${wpDir};
    index index.php index.html;

    client_max_body_size 64M;

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \\.php$ {
${useSnippet ? '        include snippets/fastcgi-php.conf;' : '        include fastcgi_params;\n        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;'}
        fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
    }

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
    const writeNginxConfig = async (useSnippet: boolean) => {
      const writeNginxCmd = `sudo tee ${shellQuote(nginxSitePath)} > /dev/null << 'NGINXEOF'
${buildNginxConfig(useSnippet)}
NGINXEOF`;
      ensureSuccess(await execCommand(conn, writeNginxCmd), 'Nginx configuration write failed');
    };

    await writeNginxConfig(true);
    ensureSuccess(
      await execCommand(conn, `sudo ln -sf ${shellQuote(nginxSitePath)} ${shellQuote(`/etc/nginx/sites-enabled/${domain}`)}`),
      'Nginx site enable failed'
    );
    ensureSuccess(await execCommand(conn, 'sudo rm -f /etc/nginx/sites-enabled/default'), 'Nginx default site cleanup failed');

    // Test and reload Nginx
    let nginxTest = await execCommand(conn, 'sudo nginx -t 2>&1');
    if (nginxTest.code !== 0) {
      const output = getErrorOutput(nginxTest);
      if (output.includes('snippets/fastcgi-php.conf')) {
        await writeNginxConfig(false);
        nginxTest = await execCommand(conn, 'sudo nginx -t 2>&1');
      }
      if (nginxTest.code !== 0) {
        throw new Error(`Nginx configuration test failed: ${getErrorOutput(nginxTest)}`);
      }
    }

    ensureSuccess(await execCommand(conn, 'sudo systemctl reload nginx'), 'Nginx reload failed');
    onProgress('nginx-config', 'completed', 'Nginx virtual host configured');

    // Step 9: Install WP-CLI and run WordPress install
    onProgress('wp-install', 'running', 'Running WordPress installation...');

    const wpCliInstall = await execCommandWithTimeout(
      conn,
      'curl -fsSL -o /tmp/wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && sudo install -m 0755 /tmp/wp-cli.phar /usr/local/bin/wp && rm -f /tmp/wp-cli.phar',
      90000
    );
    ensureSuccess(wpCliInstall, 'WP-CLI installation failed');

    const wpCliCheck = await execCommand(conn, 'wp --info 2>&1');
    if (wpCliCheck.code !== 0) {
      throw new Error(`WP-CLI check failed. This usually means PHP CLI is missing: ${getErrorOutput(wpCliCheck)}`);
    }

    const protocol = site.enableSSL ? 'https' : 'http';
    const siteUrl = `${protocol}://${domain}`;
    const existingInstall = await execCommand(
      conn,
      `sudo -u www-data wp core is-installed --path=${wpDirQuoted} 2>&1`
    );
    if (existingInstall.code === 0) {
      onProgress('wp-install', 'completed', 'WordPress is already installed in this directory');
    } else {
      const wpInstallCmd = [
        'sudo -u www-data wp core install',
        `--path=${wpDirQuoted}`,
        `--url=${shellQuote(siteUrl)}`,
        `--title=${shellQuote(safeTitle)}`,
        `--admin_user=${shellQuote(safeAdminUser)}`,
        `--admin_password=${shellQuote(adminPassword)}`,
        `--admin_email=${shellQuote(safeAdminEmail)}`,
        '--skip-email',
        '2>&1',
      ].join(' ');

      const installResult = await execCommandWithTimeout(conn, wpInstallCmd, 120000);
      const installOutput = getErrorOutput(installResult);
      if (installResult.code !== 0 && !installOutput.includes('Success') && !installOutput.includes('already installed')) {
        throw new Error(`WordPress core install failed: ${installOutput}`);
      }

      onProgress('wp-install', 'completed', 'WordPress installed successfully');
    }

    // Step 10: SSL (optional)
    if (site.enableSSL) {
      onProgress('ssl', 'running', 'Setting up SSL with Let\'s Encrypt...');

      const certbotPackages = await execCommandWithTimeout(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y certbot python3-certbot-nginx 2>&1',
        120000
      );
      if (certbotPackages.code !== 0) {
        onProgress('ssl', 'completed', 'SSL setup skipped — failed to install certbot', getErrorOutput(certbotPackages));
      } else {
        const certResult = await execCommandWithTimeout(
          conn,
          `sudo certbot --nginx -d ${shellQuote(domain)} -d ${shellQuote(`www.${domain}`)} --non-interactive --agree-tos --email ${shellQuote(safeAdminEmail)} --redirect 2>&1`,
          180000
        );

        if (certResult.code !== 0) {
          onProgress(
            'ssl',
            'completed',
            'SSL setup skipped — ensure DNS points to this server first, then rerun certbot',
            getErrorOutput(certResult)
          );
        } else {
          sslEnabled = true;
          onProgress('ssl', 'completed', 'SSL certificate installed');
        }
      }
    }

    // Step 11: Security hardening
    onProgress('security', 'running', 'Applying security hardening...');

    // Configure UFW firewall
    await execCommand(conn, 'sudo ufw allow OpenSSH 2>/dev/null; sudo ufw allow "Nginx Full" 2>/dev/null; echo "y" | sudo ufw enable 2>/dev/null || true');

    // Harden PHP
    await execCommand(conn, `sudo sed -i 's/upload_max_filesize = .*/upload_max_filesize = 64M/' /etc/php/${phpVersion}/fpm/php.ini 2>/dev/null || true`);
    await execCommand(conn, `sudo sed -i 's/post_max_size = .*/post_max_size = 64M/' /etc/php/${phpVersion}/fpm/php.ini 2>/dev/null || true`);
    await execCommand(conn, `sudo sed -i 's/max_execution_time = .*/max_execution_time = 300/' /etc/php/${phpVersion}/fpm/php.ini 2>/dev/null || true`);
    await execCommand(conn, `sudo sed -i 's/memory_limit = .*/memory_limit = 256M/' /etc/php/${phpVersion}/fpm/php.ini 2>/dev/null || true`);
    await execCommand(conn, `sudo systemctl restart php${phpVersion}-fpm`);

    onProgress('security', 'completed', 'Security hardening applied');

    // Final
    onProgress('complete', 'completed', 'WordPress installation complete!');

    return {
      success: true,
      adminPassword,
      dbName,
      dbUser,
      dbPassword,
      sslEnabled,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    onProgress('error', 'failed', errorMessage);
    return {
      success: false,
      adminPassword: '',
      dbName: '',
      dbUser: '',
      dbPassword: '',
      sslEnabled: false,
      error: errorMessage,
    };
  }
}
