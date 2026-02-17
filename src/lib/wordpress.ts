import { Client } from 'ssh2';
import { execCommand, execCommandWithTimeout } from './ssh';
import type { SiteConfig } from '@/types';
import crypto from 'crypto';

type ProgressCallback = (step: string, status: string, message: string, details?: string) => void;

function generatePassword(length: number = 24): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function sanitizeDomain(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
}

function sanitizeDbName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16);
}

export async function installWordPress(
  conn: Client,
  site: SiteConfig,
  onProgress: ProgressCallback
): Promise<{
  success: boolean;
  adminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  error?: string;
}> {
  const domain = sanitizeDomain(site.domain);
  const dbName = `wp_${sanitizeDbName(domain)}`;
  const dbUser = `wp_${sanitizeDbName(domain)}`.slice(0, 16);
  const dbPassword = generatePassword();
  const adminPassword = generatePassword(16);
  const phpVersion = site.phpVersion || '8.3';

  try {
    // Step 1: System update
    onProgress('system-update', 'running', 'Updating system packages...');
    const updateResult = await execCommandWithTimeout(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get update -y 2>&1',
      180000
    );
    if (updateResult.code !== 0) {
      throw new Error(`System update failed: ${updateResult.stderr || updateResult.stdout}`);
    }
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
      if (nginxResult.code !== 0) {
        throw new Error(`Nginx installation failed: ${nginxResult.stderr}`);
      }
    }
    await execCommand(conn, 'sudo systemctl enable nginx && sudo systemctl start nginx');
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
      if (dbResult.code !== 0) {
        throw new Error(`MariaDB installation failed: ${dbResult.stderr}`);
      }
    }
    await execCommand(conn, 'sudo systemctl enable mariadb && sudo systemctl start mariadb');
    onProgress('database', 'completed', 'MariaDB installed and running');

    // Step 4: Install PHP
    onProgress('php', 'running', `Installing PHP ${phpVersion} and extensions...`);
    
    // Add PHP PPA
    await execCommandWithTimeout(
      conn,
      'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y software-properties-common 2>&1 && sudo add-apt-repository -y ppa:ondrej/php 2>&1 && sudo apt-get update -y 2>&1',
      120000
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

    const phpResult = await execCommandWithTimeout(
      conn,
      `export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y ${phpExtensions} 2>&1`,
      180000
    );
    if (phpResult.code !== 0) {
      throw new Error(`PHP installation failed: ${phpResult.stderr}`);
    }
    await execCommand(conn, `sudo systemctl enable php${phpVersion}-fpm && sudo systemctl start php${phpVersion}-fpm`);
    onProgress('php', 'completed', `PHP ${phpVersion} installed with extensions`);

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
      if (result.code !== 0) {
        throw new Error(`Database setup failed: ${result.stderr}`);
      }
    }
    onProgress('db-config', 'completed', 'Database and user created');

    // Step 6: Download WordPress
    onProgress('wordpress', 'running', 'Downloading latest WordPress...');
    const wpDir = `/var/www/${domain}`;
    const wpCommands = [
      `sudo mkdir -p ${wpDir}`,
      `cd /tmp && sudo curl -sS -o wordpress.tar.gz https://wordpress.org/latest.tar.gz`,
      `cd /tmp && sudo tar -xzf wordpress.tar.gz`,
      `sudo cp -a /tmp/wordpress/. ${wpDir}/`,
      `sudo rm -rf /tmp/wordpress /tmp/wordpress.tar.gz`,
    ];
    for (const cmd of wpCommands) {
      const result = await execCommandWithTimeout(conn, cmd, 120000);
      if (result.code !== 0) {
        throw new Error(`WordPress download failed: ${result.stderr}`);
      }
    }
    onProgress('wordpress', 'completed', 'WordPress downloaded');

    // Step 7: Configure WordPress
    onProgress('wp-config', 'running', 'Configuring WordPress...');
    
    // Generate WordPress salts
    const saltKeys = [
      'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'
    ];
    const salts = saltKeys.map(key => {
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
    const writeConfigCmd = `sudo tee ${wpDir}/wp-config.php > /dev/null << 'WPEOF'
${wpConfig}
WPEOF`;
    
    const configResult = await execCommand(conn, writeConfigCmd);
    if (configResult.code !== 0) {
      throw new Error(`WordPress config failed: ${configResult.stderr}`);
    }

    // Set permissions
    await execCommand(conn, `sudo chown -R www-data:www-data ${wpDir}`);
    await execCommand(conn, `sudo find ${wpDir} -type d -exec chmod 755 {} \\;`);
    await execCommand(conn, `sudo find ${wpDir} -type f -exec chmod 644 {} \\;`);
    
    onProgress('wp-config', 'completed', 'WordPress configured');

    // Step 8: Configure Nginx
    onProgress('nginx-config', 'running', 'Setting up Nginx virtual host...');
    const nginxConfig = `server {
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
        include snippets/fastcgi-params.conf;
        fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
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

    const writeNginxCmd = `sudo tee /etc/nginx/sites-available/${domain} > /dev/null << 'NGINXEOF'
${nginxConfig}
NGINXEOF`;
    
    await execCommand(conn, writeNginxCmd);
    await execCommand(conn, `sudo ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}`);
    await execCommand(conn, `sudo rm -f /etc/nginx/sites-enabled/default`);
    
    // Test and reload Nginx
    const nginxTest = await execCommand(conn, 'sudo nginx -t 2>&1');
    if (nginxTest.code !== 0 && !nginxTest.stderr.includes('test is successful') && !nginxTest.stdout.includes('test is successful')) {
      // Try alternate fastcgi include path
      const altNginxConfig = nginxConfig.replace(
        'include snippets/fastcgi-params.conf;',
        '# fastcgi-params included via fastcgi_params below'
      );
      const altWriteCmd = `sudo tee /etc/nginx/sites-available/${domain} > /dev/null << 'NGINXEOF'
${altNginxConfig}
NGINXEOF`;
      await execCommand(conn, altWriteCmd);
      
      const retestResult = await execCommand(conn, 'sudo nginx -t 2>&1');
      if (retestResult.code !== 0 && !retestResult.stderr.includes('test is successful') && !retestResult.stdout.includes('test is successful')) {
        throw new Error(`Nginx configuration test failed: ${retestResult.stderr || retestResult.stdout}`);
      }
    }
    
    await execCommand(conn, 'sudo systemctl reload nginx');
    onProgress('nginx-config', 'completed', 'Nginx virtual host configured');

    // Step 9: Install WP-CLI and run WordPress install
    onProgress('wp-install', 'running', 'Running WordPress installation...');
    
    // Install WP-CLI
    await execCommandWithTimeout(
      conn,
      'curl -sS -o /tmp/wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && sudo mv /tmp/wp-cli.phar /usr/local/bin/wp && sudo chmod +x /usr/local/bin/wp',
      60000
    );

    const protocol = site.enableSSL ? 'https' : 'http';
    const siteUrl = `${protocol}://${domain}`;
    
    const wpInstallCmd = `sudo -u www-data wp core install --path="${wpDir}" --url="${siteUrl}" --title="${site.siteTitle.replace(/"/g, '\\"')}" --admin_user="${site.adminUser}" --admin_password="${adminPassword}" --admin_email="${site.adminEmail}" --skip-email 2>&1`;
    
    const installResult = await execCommandWithTimeout(conn, wpInstallCmd, 60000);
    if (installResult.code !== 0 && !installResult.stdout.includes('Success')) {
      throw new Error(`WordPress core install failed: ${installResult.stderr || installResult.stdout}`);
    }

    onProgress('wp-install', 'completed', 'WordPress installed successfully');

    // Step 10: SSL (optional)
    if (site.enableSSL) {
      onProgress('ssl', 'running', 'Setting up SSL with Let\'s Encrypt...');
      
      await execCommandWithTimeout(
        conn,
        'export DEBIAN_FRONTEND=noninteractive && sudo apt-get install -y certbot python3-certbot-nginx 2>&1',
        120000
      );

      const certResult = await execCommandWithTimeout(
        conn,
        `sudo certbot --nginx -d ${domain} -d www.${domain} --non-interactive --agree-tos --email ${site.adminEmail} --redirect 2>&1`,
        120000
      );
      
      if (certResult.code !== 0) {
        onProgress('ssl', 'completed', 'SSL setup skipped — ensure DNS points to this server first, then run: sudo certbot --nginx');
      } else {
        onProgress('ssl', 'completed', 'SSL certificate installed');
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
      error: errorMessage,
    };
  }
}
