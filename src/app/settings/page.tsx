"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StatusPayload = {
  configured: boolean;
  lastUpdatedAt: string | null;
};

type TestPayload = {
  ok: boolean;
  models?: {
    nanobananaPro: boolean;
    flashImage: boolean;
  };
  error?: string;
};

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    const response = await fetch("/api/settings/api-key/status");
    const payload = (await response.json()) as StatusPayload;
    setStatus(payload);
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "保存に失敗しました。");
      }

      setApiKey("");
      setMessage("APIキーを暗号化保存しました。");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/settings/api-key/test", {
        method: "POST",
      });
      const payload = (await response.json()) as TestPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "接続テストに失敗しました。");
      }

      setMessage(
        `接続成功: Pro=${payload.models?.nanobananaPro ? "OK" : "NG"}, Flash=${payload.models?.flashImage ? "OK" : "NG"}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "接続テストに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">設定</div>
        <Link href="/" className="navLink">
          メインへ戻る
        </Link>
      </header>

      <section className="card" style={{ maxWidth: 720 }}>
        <h2 className="sectionTitle">Gemini APIキー</h2>
        <p className="small">
          キーはWindows DPAPIで暗号化保存され、フロント側には返しません。
        </p>

        <div className="row">
          <label className="fieldLabel" htmlFor="apiKey">
            APIキーを入力
          </label>
          <input
            id="apiKey"
            className="input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="AIza..."
          />
        </div>

        <div className="buttonRow">
          <button className="btn btnPrimary" disabled={loading || !apiKey.trim()} onClick={handleSave}>
            保存する
          </button>
          <button className="btn" disabled={loading} onClick={handleTest}>
            接続テスト
          </button>
        </div>

        {status ? (
          <p className="small">
            保存状態: {status.configured ? "設定済み" : "未設定"}
            {status.lastUpdatedAt ? ` / 更新: ${new Date(status.lastUpdatedAt).toLocaleString()}` : ""}
          </p>
        ) : null}

        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
