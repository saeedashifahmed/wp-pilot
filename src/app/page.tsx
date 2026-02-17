'use client';

import { useState, useCallback } from 'react';
import Header from '@/components/Header';
import ServerForm from '@/components/ServerForm';
import InstallProgress, { type StepInfo } from '@/components/InstallProgress';
import CompletionCard from '@/components/CompletionCard';

interface InstallResult {
  siteUrl: string;
  adminUrl: string;
  adminUser: string;
  adminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sslRequested: boolean;
  sslEnabled: boolean;
}

const INITIAL_INSTALL_STEP: StepInfo = {
  id: 'connecting',
  label: 'connecting',
  status: 'running',
  message: 'Starting installation...',
};

export default function Home() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [result, setResult] = useState<InstallResult | null>(null);
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
      setSteps([INITIAL_INSTALL_STEP]);
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
        let hasTerminalEvent = false;

        const processEventLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            const parsed = JSON.parse(line.slice(6));

            if (parsed.step === 'done' && parsed.result) {
              hasTerminalEvent = true;
              setResult(parsed.result);
            } else if (parsed.step === 'error') {
              hasTerminalEvent = true;
              setError(parsed.message);
            } else {
              updateStep(parsed.step, parsed.status, parsed.message, parsed.details);
            }
          } catch {
            // skip invalid JSON
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            processEventLine(line.trim());
          }
        }

        if (buffer.trim()) {
          processEventLine(buffer.trim());
        }

        if (!hasTerminalEvent) {
          throw new Error('Installer connection ended before completion. Check server SSH/network and retry.');
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
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-16">
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
          {isInstalling && <InstallProgress steps={steps} />}

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

        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-gray-400">
          WP Pilot — Open-source WordPress installer
        </footer>
      </main>
    </div>
  );
}
