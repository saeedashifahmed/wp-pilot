'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Database,
  Globe,
  User,
  KeyRound,
  RotateCcw,
} from 'lucide-react';

interface ResultData {
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

interface CopyButtonProps {
  text: string;
  label: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
}

interface Props {
  result: ResultData;
  onReset: () => void;
}

function CopyButton({ text, label, copied, onCopy }: CopyButtonProps) {
  return (
    <button
      onClick={() => onCopy(text, label)}
      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy"
    >
      {copied === label ? (
        <CheckCircle2 size={14} className="text-green-600" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  );
}

export default function CompletionCard({ result, onReset }: Props) {
  const [showPasswords, setShowPasswords] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-green-200 p-5 sm:p-6 shadow-sm">
      {/* Success Header */}
      <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-100">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100">
          <CheckCircle2 size={22} className="text-green-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">WordPress Installed!</h2>
          <p className="text-sm text-gray-500">Your site is ready to use</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <a
          href={result.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Globe size={16} />
          Visit Site
          <ExternalLink size={13} />
        </a>
        <a
          href={result.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          <User size={16} />
          WP Admin
          <ExternalLink size={13} />
        </a>
      </div>

      {result.sslRequested && !result.sslEnabled && (
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800">
            SSL could not be activated automatically. Your site is running on HTTP. Verify DNS and firewall rules, then run:
            <code className="mx-1 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-200">sudo certbot --nginx -d your-domain.com</code>
          </p>
        </div>
      )}

      {/* Toggle passwords */}
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowPasswords(!showPasswords)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
          {showPasswords ? 'Hide' : 'Show'} passwords
        </button>
      </div>

      {/* Credentials */}
      <div className="space-y-4">
        {/* WP Admin */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">
            <User size={13} />
            WordPress Admin
          </h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">URL</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border">{result.adminUrl}</code>
                <CopyButton text={result.adminUrl} label="adminUrl" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Username</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border">{result.adminUser}</code>
                <CopyButton text={result.adminUser} label="adminUser" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Password</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border font-mono">
                  {showPasswords ? result.adminPassword : '••••••••••••'}
                </code>
                <CopyButton text={result.adminPassword} label="adminPassword" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
          </div>
        </div>

        {/* Database */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">
            <Database size={13} />
            Database
          </h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Database</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border">{result.dbName}</code>
                <CopyButton text={result.dbName} label="dbName" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">User</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border">{result.dbUser}</code>
                <CopyButton text={result.dbUser} label="dbUser" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Password</span>
              <span className="flex items-center gap-1.5">
                <code className="text-sm text-gray-900 bg-white px-2 py-0.5 rounded border font-mono">
                  {showPasswords ? result.dbPassword : '••••••••••••'}
                </code>
                <CopyButton text={result.dbPassword} label="dbPassword" copied={copied} onCopy={copyToClipboard} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="mt-5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex gap-2">
          <KeyRound size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>Save these credentials now.</strong> They won&apos;t be shown again. Store them securely.
          </p>
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={onReset}
        className="w-full mt-5 py-2.5 px-4 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
      >
        <RotateCcw size={14} />
        Install Another Site
      </button>
    </div>
  );
}
