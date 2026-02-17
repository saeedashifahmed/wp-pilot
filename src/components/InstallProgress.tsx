'use client';

import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
} from 'lucide-react';

export interface StepInfo {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

interface Props {
  steps: StepInfo[];
}

const STEP_LABELS: Record<string, string> = {
  connecting: 'Server Connection',
  'system-update': 'System Update',
  nginx: 'Nginx Web Server',
  database: 'MariaDB Database',
  php: 'PHP Runtime',
  'db-config': 'Database Configuration',
  wordpress: 'WordPress Download',
  'wp-config': 'WordPress Configuration',
  'nginx-config': 'Virtual Host Setup',
  'wp-install': 'WordPress Installation',
  ssl: 'SSL Certificate',
  security: 'Security Hardening',
  complete: 'Complete',
};

export default function InstallProgress({ steps }: Props) {
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Installation Progress</h2>
        <span className="text-xs text-gray-500 font-medium">
          {completedCount} / {totalSteps} steps
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-5">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-start gap-3 py-2 px-3 rounded-lg transition-colors ${
              step.status === 'running' ? 'bg-blue-50' : step.status === 'failed' ? 'bg-red-50' : ''
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.status === 'pending' && <Circle size={16} className="text-gray-300" />}
              {step.status === 'running' && <Loader2 size={16} className="text-blue-600 animate-spin" />}
              {step.status === 'completed' && <CheckCircle2 size={16} className="text-green-600" />}
              {step.status === 'failed' && <XCircle size={16} className="text-red-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  step.status === 'running'
                    ? 'text-blue-900'
                    : step.status === 'completed'
                    ? 'text-gray-600'
                    : step.status === 'failed'
                    ? 'text-red-800'
                    : 'text-gray-400'
                }`}
              >
                {STEP_LABELS[step.id] || step.id}
              </p>
              {step.message && step.status !== 'pending' && (
                <p
                  className={`text-xs mt-0.5 ${
                    step.status === 'failed' ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  {step.message}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
