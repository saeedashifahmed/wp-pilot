'use client';

import { Rocket } from 'lucide-react';

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white">
          <Rocket size={20} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900 leading-tight">WP Pilot</h1>
          <p className="text-xs text-gray-500">One-click WordPress installer</p>
        </div>
      </div>
    </header>
  );
}
