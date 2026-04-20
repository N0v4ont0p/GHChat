"use client";

import { Settings, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BackendStatus, ModelInfo } from "@/types";

interface TopBarProps {
  title: string;
  status: BackendStatus;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  onOpenSettings: () => void;
}

function statusConfig(status: BackendStatus) {
  switch (status) {
    case "online":
      return { label: "Ollama connected", variant: "success" as const };
    case "not_running":
      return { label: "Ollama installed, not running", variant: "warning" as const };
    case "unreachable":
      return { label: "Host unreachable", variant: "danger" as const };
    default:
      return { label: "Ollama not detected", variant: "danger" as const };
  }
}

export function TopBar({
  title,
  status,
  models,
  selectedModel,
  onModelChange,
  onOpenSettings,
}: TopBarProps) {
  const config = statusConfig(status);

  return (
    <header className="glass-panel mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/80 px-4 py-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-slate-400">Premium local-first chat powered by Ollama</p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={config.variant} className="gap-1">
          {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
          {config.label}
        </Badge>

        <select
          className="h-9 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200"
          value={selectedModel}
          onChange={(event) => onModelChange(event.currentTarget.value)}
          disabled={models.length === 0}
        >
          <option value="">Select model</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>

        <Button size="icon" variant="ghost" onClick={onOpenSettings}>
          <Settings size={16} />
        </Button>
      </div>
    </header>
  );
}
