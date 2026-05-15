"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Slot {
  date: string;
  time: string;
  officeName: string;
}

interface Status {
  lastChecked: string | null;
  available: boolean;
  slots: Slot[];
  errors?: string[];
  message?: string;
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmailSent, setTestEmailSent] = useState(false);
  const router = useRouter();

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.status === 401) {
      router.push("/");
      return;
    }
    const data = await res.json();
    setStatus(data);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/");
  }

  async function sendTestEmail() {
    await fetch("/api/test-notify", { method: "POST" });
    setTestEmailSent(true);
    setTimeout(() => setTestEmailSent(false), 3000);
  }

  function formatTime(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>🚗 DMV Monitor</h1>
            <p style={styles.subtitle}>
              Pleasanton · Behind-the-Wheel Test · Checks every 10 min
            </p>
          </div>
          <button onClick={logout} style={styles.logoutBtn}>
            Sign out
          </button>
        </div>

        {/* Status card */}
        {loading ? (
          <div style={styles.card}>
            <p style={{ color: "#888", textAlign: "center" }}>Loading…</p>
          </div>
        ) : status?.message ? (
          <div style={styles.card}>
            <p style={{ color: "#666", textAlign: "center" }}>{status.message}</p>
          </div>
        ) : (
          <>
            <div
              style={{
                ...styles.card,
                borderLeft: `4px solid ${status?.available ? "#22c55e" : "#94a3b8"}`,
              }}
            >
              <div style={styles.statusRow}>
                <span
                  style={{
                    ...styles.statusBadge,
                    background: status?.available ? "#dcfce7" : "#f1f5f9",
                    color: status?.available ? "#166534" : "#475569",
                  }}
                >
                  {status?.available ? "✓ Slots available!" : "No slots right now"}
                </span>
                <span style={styles.lastChecked}>
                  Last checked: {formatTime(status?.lastChecked ?? null)}
                </span>
              </div>

              {status?.available && status.slots.length > 0 && (
                <div style={styles.slotList}>
                  {status.slots.map((s, i) => (
                    <div key={i} style={styles.slot}>
                      <strong>{s.officeName}</strong>
                      <span>
                        {s.date}
                        {s.time ? ` · ${s.time}` : ""}
                      </span>
                    </div>
                  ))}
                  <a
                    href="https://www.dmv.ca.gov/wasapp/foa/driveTest.do"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.bookBtn}
                  >
                    Book now →
                  </a>
                </div>
              )}

              {status?.errors && status.errors.length > 0 && (
                <div style={styles.errorBox}>
                  {status.errors.map((e, i) => (
                    <p key={i} style={{ margin: 0 }}>
                      ⚠ {e}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Offices being monitored */}
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Monitored offices</h2>
              <div style={styles.officeList}>
                <div style={styles.officeItem}>
                  <span>📍</span>
                  <span>Pleasanton — Los Positas (6300 W Las Positas Blvd)</span>
                </div>
                <div style={styles.officeItem}>
                  <span>📍</span>
                  <span>Pleasanton — Stoneridge (2621 Stoneridge Mall)</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Actions</h2>
          <div style={styles.actions}>
            <button onClick={sendTestEmail} style={styles.actionBtn}>
              {testEmailSent ? "✓ Sent!" : "Send test email"}
            </button>
            <button onClick={fetchStatus} style={styles.actionBtn}>
              Refresh status
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: { minHeight: "100vh", padding: "1.5rem 1rem" },
  container: { maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "0.5rem",
  },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700 },
  subtitle: { margin: "0.25rem 0 0", color: "#666", fontSize: "0.85rem" },
  logoutBtn: {
    background: "none",
    border: "1px solid #ddd",
    borderRadius: "0.4rem",
    padding: "0.4rem 0.8rem",
    cursor: "pointer",
    fontSize: "0.85rem",
    color: "#555",
  },
  card: {
    background: "#fff",
    borderRadius: "0.75rem",
    padding: "1.25rem 1.5rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  statusBadge: {
    padding: "0.35rem 0.75rem",
    borderRadius: "99px",
    fontSize: "0.875rem",
    fontWeight: 600,
  },
  lastChecked: { fontSize: "0.8rem", color: "#888" },
  slotList: { marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" },
  slot: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.6rem 0.75rem",
    background: "#f0fdf4",
    borderRadius: "0.4rem",
    fontSize: "0.875rem",
  },
  bookBtn: {
    display: "inline-block",
    marginTop: "0.5rem",
    padding: "0.6rem 1rem",
    background: "#22c55e",
    color: "#fff",
    borderRadius: "0.5rem",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.9rem",
  },
  errorBox: {
    marginTop: "0.75rem",
    padding: "0.6rem 0.75rem",
    background: "#fffbeb",
    borderRadius: "0.4rem",
    fontSize: "0.8rem",
    color: "#92400e",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  sectionTitle: { margin: "0 0 0.75rem", fontSize: "1rem", fontWeight: 600, color: "#333" },
  officeList: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  officeItem: {
    display: "flex",
    gap: "0.5rem",
    fontSize: "0.875rem",
    color: "#555",
    alignItems: "flex-start",
  },
  actions: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  actionBtn: {
    padding: "0.5rem 1rem",
    background: "#f1f5f9",
    border: "none",
    borderRadius: "0.4rem",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#334155",
  },
};
