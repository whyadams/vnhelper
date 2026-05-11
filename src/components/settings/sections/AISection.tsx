import { useEffect, useState } from "react";
import {
  listModels,
  loadAISettings,
  saveAISettings,
  type AISettings,
  type ModelInfo,
} from "../../../lib/aiClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { SectionHead } from "./shared";

const MODEL_NONE = "__none__";

export function AISection() {
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadAISettings());
  }, []);

  const test = async () => {
    setTesting(true);
    setInfo(null);
    setError(null);
    try {
      const list = await listModels(settings);
      setModels(list);
      setInfo(
        list.length === 0
          ? "Connected, but no models loaded. Load a model in LM Studio."
          : `Connected. ${list.length} model(s) available.`,
      );
      if (!settings.model && list[0]) {
        setSettings({ ...settings, model: list[0].id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    saveAISettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <>
      <SectionHead
        title="AI"
        subtitle="LM Studio (OpenAI-совместимый локальный сервер). Запусти LM Studio, выбери модель и старт Local Server. Дефолтный endpoint — http://localhost:1234/v1."
      />
      <div className="set-card">
        <div className="set-field">
          <label className="set-field-label">Base URL</label>
          <input
            className="set-input"
            type="text"
            value={settings.baseUrl}
            onChange={(e) =>
              setSettings({ ...settings, baseUrl: e.target.value })
            }
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
          />
        </div>

        <div className="set-field">
          <label className="set-field-label">Model</label>
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
              className="set-input"
              type="text"
              value={settings.model}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value })
              }
              placeholder="e.g. llama-3-8b-instruct"
              spellCheck={false}
            />
          )}
        </div>

        <div className="set-field">
          <label className="set-field-label">API key (optional)</label>
          <input
            className="set-input"
            type="password"
            value={settings.apiKey}
            onChange={(e) =>
              setSettings({ ...settings, apiKey: e.target.value })
            }
            placeholder="LM Studio usually doesn't need one"
            spellCheck={false}
          />
        </div>

        {info && <div className="set-info">{info}</div>}
        {error && <div className="set-error">{error}</div>}

        <div className="set-actions">
          <button
            type="button"
            className="set-btn"
            onClick={() => void test()}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="set-btn is-primary" onClick={save}>
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
