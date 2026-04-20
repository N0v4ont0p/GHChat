"use client";

import { Info, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSettings, BackendStatus } from "@/types";

interface SettingsSheetProps {
  settings: AppSettings;
  status: BackendStatus;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onAutoDetect: () => Promise<void>;
}

export function SettingsSheet({
  settings,
  status,
  onClose,
  onSave,
  onAutoDetect,
}: SettingsSheetProps) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-slate-700/80 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Settings</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-300">Backend host</label>
            <Input
              value={local.backendHost}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setLocal((previous) => ({
                  ...previous,
                  backendHost: value,
                }));
              }}
              placeholder="http://localhost:11434"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void onAutoDetect();
                }}
              >
                <RefreshCw size={14} className="mr-1" />
                Auto-detect
              </Button>
              <span className="text-xs text-slate-400">Current status: {status}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">Theme</label>
            <select
              value={local.theme}
              className="h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setLocal((previous) => ({
                  ...previous,
                  theme: value as AppSettings["theme"],
                }));
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">GHchat data directory</label>
            <Input
              value={local.dataDirectory}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setLocal((previous) => ({
                  ...previous,
                  dataDirectory: value,
                }));
              }}
              placeholder="/Volumes/ExternalSSD/ghchat-data"
            />
            <p className="mt-1 text-xs text-slate-500">
              Set GHCHAT_DATA_DIR in your shell to fully move data at launch.
            </p>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
            <span>
              <span className="block text-sm">Performance mode</span>
              <span className="text-xs text-slate-400">
                Reduces animated polish for quieter thermals.
              </span>
            </span>
            <input
              type="checkbox"
              checked={local.performanceMode}
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setLocal((previous) => ({
                  ...previous,
                  performanceMode: checked,
                }));
              }}
              className="h-4 w-4"
            />
          </label>

          <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3 text-sm text-slate-300">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Info size={15} /> About / system info
            </div>
            <p>Provider: Ollama (v1)</p>
            <p>Target hardware: Apple Silicon (M2 class)</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(local);
              setSaving(false);
              onClose();
            }}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
