"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>BLT Portfolio Manager</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        <label style={styles.label} htmlFor="username">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={styles.input}
          autoFocus
        />

        <label style={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5f5f4",
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    background: "#fff",
    borderRadius: 12,
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
    display: "flex",
    flexDirection: "column",
  },
  title: { fontSize: 20, fontWeight: 600, margin: 0, color: "#1c1917" },
  subtitle: { fontSize: 14, color: "#78716c", margin: "4px 0 24px" },
  label: { fontSize: 13, fontWeight: 500, color: "#44403c", marginBottom: 6 },
  input: {
    padding: "10px 12px",
    fontSize: 15,
    border: "1px solid #d6d3d1",
    borderRadius: 8,
    marginBottom: 16,
    outline: "none",
  },
  error: { fontSize: 13, color: "#b91c1c", marginBottom: 16, marginTop: -8 },
  button: {
    padding: "10px 12px",
    fontSize: 15,
    fontWeight: 600,
    background: "#1c1917",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
