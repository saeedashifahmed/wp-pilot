# WP Pilot

One-click WordPress installer for Ubuntu servers. Deploys a complete WordPress stack (Nginx, PHP, MariaDB) with a clean, modern web interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4)

## Features

- **One-click install** — Full LEMP stack + WordPress from a single button
- **Real-time progress** — Stream-based progress updates during installation
- **SSH connectivity** — Password or SSH key authentication
- **SSL support** — Optional Let's Encrypt certificate setup
- **Security hardening** — UFW firewall, PHP tuning, file permissions
- **Modern UI** — Clean, responsive interface built with Tailwind CSS
- **Configurable** — PHP version selection, admin credentials, domain setup

## What Gets Installed

| Component | Details |
|-----------|---------|
| **Nginx** | Lightweight web server with optimized WordPress config |
| **PHP** | 8.1–8.4 with all required WordPress extensions |
| **MariaDB** | Database server with dedicated WordPress user |
| **WordPress** | Latest version from wordpress.org |
| **WP-CLI** | Command-line WordPress management tool |
| **Certbot** | Let's Encrypt SSL (optional) |

## Prerequisites

- An **Ubuntu server** (20.04, 22.04, or 24.04) with root or sudo access
- A **domain name** pointing to the server's IP address
- **SSH access** to the server (password or key)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/wp-pilot.git
cd wp-pilot

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter your server details.

## Deployment

WP Pilot is a standard Next.js application that can be deployed to any platform supporting Node.js:

### Vercel

```bash
npm i -g vercel
vercel
```

### Netlify

```bash
npm i -g netlify-cli
netlify deploy --build
```

### DigitalOcean App Platform

Connect your GitHub repository in the DigitalOcean dashboard and deploy.

### Docker

```bash
docker build -t wp-pilot .
docker run -p 3000:3000 wp-pilot
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **SSH**: ssh2 (Node.js SSH client)
- **Icons**: Lucide React

## Security Notes

- Server credentials are **never stored** — they're only used during the installation session
- All passwords (WordPress admin, database) are **randomly generated** with cryptographic randomness
- WordPress `DISALLOW_FILE_EDIT` is enabled by default
- UFW firewall is configured to allow only SSH, HTTP, and HTTPS

## Acknowledgements

This tool is developed by [Rabbit Builds](https://rabbitbuilds.com/).

## License

MIT
