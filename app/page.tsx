"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/dashboard");
    } else {
      const data = await res.json();
      const raw = data.error ?? "Login failed";
      setError(
        raw.includes("No password configured")
          ? "No password set yet. Run the setup step (see README) to generate your first password."
          : raw
      );
      setLoading(false);
    }
  }

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <div style={styles.icon}>🚗</div>
        <h1 style={styles.title}>DMV Monitor</h1>
        <p style={styles.subtitle}>
          Checking Pleasanton BTW appointments
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label} htmlFor="password">
            Weekly password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter this week's password"
            style={styles.input}
            autoComplete="current-password"
            required
          />

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={styles.hint}>
          Check your email for this week&apos;s password.
        </p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  card: {
    background: "#fff",
    borderRadius: "1rem",
    padding: "2.5rem 2rem",
    width: "100%",
    maxWidth: "360px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center",
  },
  icon: { fontSize: "2.5rem", marginBottom: "0.5rem" },
  title: { margin: "0 0 0.25rem", fontSize: "1.5rem", fontWeight: 700 },
  subtitle: { margin: "0 0 2rem", color: "#666", fontSize: "0.9rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  label: { textAlign: "left", fontSize: "0.85rem", fontWeight: 600, color: "#333" },
  input: {
    padding: "0.75rem 1rem",
    fontSize: "1rem",
    border: "1.5px solid #ddd",
    borderRadius: "0.5rem",
    outline: "none",
    transition: "border-color 0.15s",
  },
  error: {
    margin: 0,
    padding: "0.6rem 0.8rem",
    background: "#fff0f0",
    color: "#c00",
    borderRadius: "0.4rem",
    fontSize: "0.875rem",
  },
  button: {
    padding: "0.75rem",
    background: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "0.25rem",
  },
  hint: { marginTop: "1.5rem", color: "#888", fontSize: "0.8rem" },
};
