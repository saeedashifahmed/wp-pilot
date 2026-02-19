'use client';

import { useState, useCallback } from 'react';
import Header from '@/components/Header';
import ServerForm from '@/components/ServerForm';
import InstallProgress, { type StepInfo } from '@/components/InstallProgress';
import CompletionCard, { type ResultData } from '@/components/CompletionCard';

export default function Home() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateStep = useCallback((id: string, status: StepInfo['status'], message?: string, details?: string) => {
    setSteps((prev) => {
      const existing = prev.find((s) => s.id === id);
      if (existing) {
        return prev.map((s) => (s.id === id ? { ...s, status, message, details } : s));
      }
      return [...prev, { id, label: id, status, message, details }];
    });
  }, []);

  const handleInstall = useCallback(
    async (data: Record<string, unknown>) => {
      setIsInstalling(true);
      setSteps([]);
      setResult(null);
      setError(null);

      try {
        const response = await fetch('/api/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Installation request failed');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));

                if (parsed.step === 'done' && parsed.result) {
                  setResult(parsed.result);
                } else if (parsed.step === 'error') {
                  setError(parsed.message);
                } else {
                  updateStep(parsed.step, parsed.status, parsed.message, parsed.details);
                }
              } catch {
                // skip invalid JSON
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
      } finally {
        setIsInstalling(false);
      }
    },
    [updateStep]
  );

  const handleReset = () => {
    setIsInstalling(false);
    setSteps([]);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero text */}
        {!isInstalling && !result && (
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              Deploy WordPress in minutes
            </h2>
            <p className="text-gray-500 text-sm sm:text-base">
              Enter your server details and let WP Pilot handle the rest.
              <br className="hidden sm:block" />{' '}
              Installs Nginx, PHP, MariaDB, and WordPress automatically.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {/* Show form when not installing and no result */}
          {!isInstalling && !result && (
            <ServerForm onInstall={handleInstall} isInstalling={isInstalling} />
          )}

          {/* Show progress during installation */}
          {isInstalling && steps.length > 0 && <InstallProgress steps={steps} />}

          {/* Show error */}
          {error && !isInstalling && (
            <div className="bg-white rounded-xl border border-red-200 p-5 sm:p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-red-800 mb-2">Installation Failed</h3>
              <p className="text-sm text-red-700 mb-4">{error}</p>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Show result */}
          {result && <CompletionCard result={result} onReset={handleReset} />}
        </div>

      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="sm:col-span-2 lg:col-span-1">
              <p className="text-sm font-semibold text-gray-900">Rabbit Builds</p>
              <p className="text-xs text-gray-500 mt-1">A Rabbit Rank LLC Company</p>
              <a
                href="https://github.com/saeedashifahmed/wp-pilot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                <span>Open Source on GitHub</span>
              </a>
            </div>

            {/* Pages */}
            <div>
              <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">Pages</h4>
              <ul className="space-y-2">
                <li><a href="https://rabbitbuilds.com/" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Home</a></li>
                <li><a href="https://rabbitbuilds.com/about" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">About</a></li>
                <li><a href="https://rabbitbuilds.com/contact" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Contact</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">Legal</h4>
              <ul className="space-y-2">
                <li><a href="https://rabbitbuilds.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Privacy Policy</a></li>
                <li><a href="https://rabbitbuilds.com/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Terms of Service</a></li>
              </ul>
            </div>

            {/* Headquarters */}
            <div>
              <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">Headquarters</h4>
              <address className="not-italic text-sm text-gray-500 leading-relaxed">
                701 Tillery Street, Unit 12-2508<br />
                Austin, Texas 78702<br />
                United States
              </address>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 pt-6 border-t border-gray-100 text-center text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Rabbit Builds. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
