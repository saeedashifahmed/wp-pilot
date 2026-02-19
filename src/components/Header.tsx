'use client';

import { Rocket, Github } from 'lucide-react';

const navLinks = [
  { label: 'Home', href: 'https://rabbitbuilds.com/' },
  { label: 'About', href: 'https://rabbitbuilds.com/about' },
  { label: 'Contact', href: 'https://rabbitbuilds.com/contact' },
];

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white">
            <Rocket size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 leading-tight">WP Pilot</h1>
            <p className="text-xs text-gray-500">One-click WordPress installer</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="hidden sm:flex items-center gap-4">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <a
            href="https://github.com/saeedashifahmed/wp-pilot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="View source on GitHub"
            title="View source on GitHub"
          >
            <Github size={20} />
          </a>
        </div>
      </div>
    </header>
  );
}
