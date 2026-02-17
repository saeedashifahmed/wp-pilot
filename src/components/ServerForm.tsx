'use client';

import { useState } from 'react';
import {
  Server,
  KeyRound,
  Globe,
  Mail,
  User,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';

interface ServerInfo {
  os: string;
  memory: string;
  diskFree: string;
}

interface Props {
  onInstall: (data: Record<string, unknown>) => void;
  isInstalling: boolean;
}

export default function ServerForm({ onInstall, isInstalling }: Props) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [domain, setDomain] = useState('');
  const [siteTitle, setSiteTitle] = useState('My WordPress Site');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminEmail, setAdminEmail] = useState('');
  const [enableSSL, setEnableSSL] = useState(false);
  const [phpVersion, setPhpVersion] = useState('8.3');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [connectionError, setConnectionError] = useState('');

  const testConnection = async () => {
    setTesting(true);
    setConnectionStatus('idle');
    setConnectionError('');

    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, authMethod, password, privateKey }),
      });

      const data = await res.json();
      if (data.success) {
        setConnectionStatus('success');
        setServerInfo(data.server);
      } else {
        setConnectionStatus('error');
        setConnectionError(data.error || 'Connection failed');
      }
    } catch {
      setConnectionStatus('error');
      setConnectionError('Network error — unable to reach API');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onInstall({
      host,
      port: parseInt(port),
      username,
      authMethod,
      password,
      privateKey,
      domain,
      siteTitle,
      adminUser,
      adminEmail: adminEmail || `admin@${domain}`,
      enableSSL,
      phpVersion,
    });
  };

  const canInstall = host && username && domain && (authMethod === 'password' ? password : privateKey);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Server Connection */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <Server size={18} className="text-gray-700" />
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Server Connection</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Server IP / Hostname</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="203.0.113.1"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="root"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Authentication</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAuthMethod('password')}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                authMethod === 'password'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod('key')}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                authMethod === 'key'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <KeyRound size={14} /> SSH Key
              </span>
            </button>
          </div>
        </div>

        {authMethod === 'password' ? (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter server password"
                className="w-full px-3 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Private Key</label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Paste your private SSH key here..."
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow resize-none"
              required
            />
          </div>
        )}

        {/* Test Connection Button */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={testConnection}
            disabled={testing || !host || !username || (authMethod === 'password' ? !password : !privateKey)}
            className="px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Testing...
              </span>
            ) : (
              'Test Connection'
            )}
          </button>

          {connectionStatus === 'success' && serverInfo && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 size={16} />
              <span>{serverInfo.os} · {serverInfo.memory} RAM · {serverInfo.diskFree} free</span>
            </div>
          )}

          {connectionStatus === 'error' && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={16} />
              <span className="truncate max-w-xs">{connectionError}</span>
            </div>
          )}
        </div>
      </div>

      {/* WordPress Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <Globe size={18} className="text-gray-700" />
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">WordPress Settings</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Domain Name</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              required
            />
            <p className="mt-1 text-xs text-gray-500">DNS must point to your server&apos;s IP address</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site Title</label>
            <input
              type="text"
              value={siteTitle}
              onChange={(e) => setSiteTitle(e.target.value)}
              placeholder="My WordPress Site"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1"><User size={13} /> Admin Username</span>
              </label>
              <input
                type="text"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1"><Mail size={13} /> Admin Email</span>
              </label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder={domain ? `admin@${domain}` : 'admin@example.com'}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              />
            </div>
          </div>

          {/* SSL Toggle */}
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
            <input
              type="checkbox"
              checked={enableSSL}
              onChange={(e) => setEnableSSL(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-blue-600 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
            <div className="flex items-center gap-1.5 text-sm text-gray-700">
              <ShieldCheck size={15} />
              Enable SSL (Let&apos;s Encrypt)
            </div>
          </label>

          {/* Advanced Options */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced options
          </button>

          {showAdvanced && (
            <div className="pl-4 border-l-2 border-gray-100 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">PHP Version</label>
                <select
                  value={phpVersion}
                  onChange={(e) => setPhpVersion(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow bg-white"
                >
                  <option value="8.4">PHP 8.4</option>
                  <option value="8.3">PHP 8.3</option>
                  <option value="8.2">PHP 8.2</option>
                  <option value="8.1">PHP 8.1</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Install Button */}
      <button
        type="submit"
        disabled={!canInstall || isInstalling}
        className="w-full py-3.5 px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 outline-none"
      >
        {isInstalling ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Installing WordPress...
          </span>
        ) : (
          'Install WordPress'
        )}
      </button>
    </form>
  );
}
