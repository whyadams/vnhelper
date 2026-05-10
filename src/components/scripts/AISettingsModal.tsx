import { useEffect, useState } from "react";
import {
  listModels,
  loadAISettings,
  saveAISettings,
  type AISettings,
  type ModelInfo,
} from "../../lib/aiClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const MODEL_NONE = "__none__";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AISettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSettings(loadAISettings());
      setTestResult(null);
      setTestError(null);
    }
  }, [open]);

  if (!open) return null;

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const list = await listModels(settings);
      setModels(list);
      setTestResult(
        list.length === 0
          ? "Connected, but no models loaded. Load a model in LM Studio."
          : `Connected. ${list.length} model(s) available.`,
      );
      // Auto-pick first if model field is empty
      if (!settings.model && list[0]) {
        setSettings({ ...settings, model: list[0].id });
      }
    } catch (e) {
      setTestError(
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    saveAISettings(settings);
    onClose();
  };

  return (
    <div className="members-overlay" onClick={onClose}>
      <div
        className="members-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(480px, 92vw)" }}
      >
        <div className="members-head">
          <span>AI settings (LM Studio)</span>
          <button className="members-close" onClick={onClose}>
            ×
          </button>
        </div>

        <p
          style={{
            margin: 0,
            color: "var(--text-3)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Run LM Studio locally, load a model, and start its server (Local
          Server tab → Start Server). Default endpoint is{" "}
          <code style={{ fontSize: 11.5 }}>http://localhost:1234/v1</code>.
        </p>

        <label className="auth-field">
          <span>Base URL</span>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={(e) =>
              setSettings({ ...settings, baseUrl: e.target.value })
            }
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
          />
        </label>

        <label className="auth-field">
          <span>Model</span>
          {models.length > 0 ? (
            <Select
              value={settings.model || MODEL_NONE}
              onValueChange={(v) =>
                setSettings({
                  ...settings,
                  model: v === MODEL_NONE ? "" : v,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="— pick one —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MODEL_NONE}>— pick one —</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              type="text"
              value={settings.model}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value })
              }
              placeholder="e.g. llama-3-8b-instruct"
              spellCheck={false}
            />
          )}
        </label>

        <label className="auth-field">
          <span>API key (optional)</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) =>
              setSettings({ ...settings, apiKey: e.target.value })
            }
            placeholder="LM Studio usually doesn't need one"
            spellCheck={false}
          />
        </label>

        {testResult && (
          <div className="auth-info">{testResult}</div>
        )}
        {testError && (
          <div className="auth-error">
            {testError}
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--text-3)",
              }}
            >
              Common issues: LM Studio not running, server not started
              (Local Server → Start), wrong port, or no model loaded.
            </div>
          </div>
        )}

        <div className="ev-actions">
          <button
            type="button"
            className="ev-cancel-btn"
            onClick={() => void test()}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" onClick={onClose} className="ev-cancel-btn">
            Cancel
          </button>
          <button type="button" className="auth-submit" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
