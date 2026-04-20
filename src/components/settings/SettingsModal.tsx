import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings-store";
import { useModels } from "@/hooks/useModels";
import { ipc } from "@/lib/ipc";
import { toast } from "sonner";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, selectedModel, setSelectedModel } =
    useSettingsStore();
  const { data: models = [] } = useModels();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsOpen) {
      ipc.getApiKey().then(setApiKey).catch(() => {});
    }
  }, [settingsOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.setApiKey(apiKey);
      await ipc.updateSettings({ defaultModel: selectedModel });
      toast.success("Settings saved");
      setSettingsOpen(false);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your GHchat experience.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* API Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Hugging Face API Key</label>
            <Input
              type="password"
              placeholder="hf_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Free at{" "}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                hf.co/settings/tokens
                <ExternalLink className="h-3 w-3" />
              </a>
              . Stored securely via OS keychain.
            </p>
          </div>

          <Separator />

          {/* Model */}
          <div className="space-y-2">
            <label className="text-sm font-medium">AI Model</label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div>
                      <div className="font-medium">{m.name}</div>
                      {m.description && (
                        <div className="text-xs text-muted-foreground">{m.description}</div>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Theme placeholder */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">Theme</label>
            <p className="text-xs text-muted-foreground">Dark mode only (light mode coming soon).</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
