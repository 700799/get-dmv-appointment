"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Office {
  id: number;
  name: string;
  address?: string;
  enabled: boolean;
}

interface Schedule {
  enabled: boolean;
  timezone: string;
  activeDays: number[];
  startHour: number;
  endHour: number;
  minIntervalMinutes: number;
}

interface Scan {
  maxAttempts: number;
  notifyCooldownMinutes: number;
  perOfficeDelayMinMs: number;
  perOfficeDelayMaxMs: number;
}

interface ConfigResponse {
  offices: Office[];
  schedule: Schedule;
  scan: Scan;
  personalConfigured: boolean;
  personalSource: "config" | "env" | "none";
  updatedAt: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const emptyPersonal = {
  firstName: "",
  lastName: "",
  dlNumber: "",
  birthMonth: "",
  birthDay: "",
  birthYear: "",
};

export default function Admin() {
  const router = useRouter();
  const [offices, setOffices] = useState<Office[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [personalSource, setPersonalSource] = useState<string>("none");
  const [personal, setPersonal] = useState({ ...emptyPersonal });
  const [editPersonal, setEditPersonal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // office discovery
  const [discoverQuery, setDiscoverQuery] = useState("Pleasanton");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/config");
    if (res.status === 401) {
      router.push("/");
      return;
    }
    const data: ConfigResponse = await res.json();
    setOffices(data.offices);
    setSchedule(data.schedule);
    setScan(data.scan);
    setPersonalSource(data.personalSource);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    if (kind === "ok") setTimeout(() => setMsg(null), 4000);
  }

  // ── Office editing ──────────────────────────────────────────────────────────
  function updateOffice(i: number, patch: Partial<Office>) {
    setOffices((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function removeOffice(i: number) {
    setOffices((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addOffice(o?: { id: number; name: string; address?: string }) {
    setOffices((prev) => [
      ...prev,
      { id: o?.id ?? 0, name: o?.name ?? "", address: o?.address, enabled: true },
    ]);
  }

  async function runDiscover() {
    setDiscovering(true);
    setDiscovered([]);
    try {
      const res = await fetch(`/api/discover-offices?q=${encodeURIComponent(discoverQuery)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Discovery failed");
      setDiscovered(data.offices ?? []);
      if ((data.offices ?? []).length === 0) flash("err", "No matching offices found.");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  function addDiscovered(d: { id: string; name: string }) {
    const id = Number(d.id);
    if (offices.some((o) => o.id === id)) {
      flash("err", `${d.name} is already in the list.`);
      return;
    }
    addOffice({ id, name: d.name });
    flash("ok", `Added ${d.name}.`);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function save() {
    if (!schedule || !scan) return;
    setSaving(true);
    setMsg(null);

    const payload: Record<string, unknown> = { offices, schedule, scan };
    if (editPersonal) {
      payload.personal = personal;
    }

    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      flash("ok", "Settings saved.");
      if (editPersonal) {
        setEditPersonal(false);
        setPersonal({ ...emptyPersonal });
        setPersonalSource("config");
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runCheckNow() {
    flash("ok", "Triggering a check… this can take up to a minute.");
    try {
      const res = await fetch("/api/check?force=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      if (data.scanned) {
        flash("ok", `Check complete — ${data.slotsFound} slot(s) found.`);
      } else {
        flash("ok", `Check skipped: ${data.reason}`);
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Check failed");
    }
  }

  if (loading || !schedule || !scan) {
    return (
      <main style={s.main}>
        <div style={s.container}>
          <p style={{ textAlign: "center", color: "#888" }}>Loading settings…</p>
        </div>
      </main>
    );
  }

  return (
    <main style={s.main}>
      <div style={s.container}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>⚙️ Admin</h1>
            <p style={s.subtitle}>Configure schedules, scans, and DMV locations</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => router.push("/dashboard")} style={s.ghostBtn}>
              ← Dashboard
            </button>
          </div>
        </div>

        {msg && (
          <div style={{ ...s.banner, ...(msg.kind === "ok" ? s.bannerOk : s.bannerErr) }}>
            {msg.text}
          </div>
        )}

        {/* ── Monitoring schedule ── */}
        <section style={s.card}>
          <h2 style={s.sectionTitle}>Monitoring schedule</h2>

          <label style={s.toggleRow}>
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
            />
            <span>
              <strong>Monitoring {schedule.enabled ? "enabled" : "paused"}</strong>
              <br />
              <span style={s.hint}>Master switch — when off, no scans run.</span>
            </span>
          </label>

          <div style={s.field}>
            <label style={s.label}>Active days</label>
            <div style={s.dayRow}>
              {DAY_LABELS.map((d, idx) => {
                const on = schedule.activeDays.includes(idx);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setSchedule({
                        ...schedule,
                        activeDays: on
                          ? schedule.activeDays.filter((x) => x !== idx)
                          : [...schedule.activeDays, idx].sort(),
                      })
                    }
                    style={{ ...s.dayChip, ...(on ? s.dayChipOn : {}) }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Start hour (0–23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={schedule.startHour}
                onChange={(e) => setSchedule({ ...schedule, startHour: Number(e.target.value) })}
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>End hour (1–24)</label>
              <input
                type="number"
                min={1}
                max={24}
                value={schedule.endHour}
                onChange={(e) => setSchedule({ ...schedule, endHour: Number(e.target.value) })}
                style={s.input}
              />
            </div>
          </div>

          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Timezone (IANA)</label>
              <input
                type="text"
                value={schedule.timezone}
                onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })}
                style={s.input}
                placeholder="America/Los_Angeles"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Min minutes between scans</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={schedule.minIntervalMinutes}
                onChange={(e) =>
                  setSchedule({ ...schedule, minIntervalMinutes: Number(e.target.value) })
                }
                style={s.input}
              />
            </div>
          </div>
          <p style={s.hint}>
            The cron fires on a fixed schedule; scans only run inside this window and no more
            often than the minimum interval.
          </p>
        </section>

        {/* ── Scan behavior ── */}
        <section style={s.card}>
          <h2 style={s.sectionTitle}>Scan behavior</h2>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Max retry attempts (1–6)</label>
              <input
                type="number"
                min={1}
                max={6}
                value={scan.maxAttempts}
                onChange={(e) => setScan({ ...scan, maxAttempts: Number(e.target.value) })}
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Re-notify cooldown (min)</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={scan.notifyCooldownMinutes}
                onChange={(e) =>
                  setScan({ ...scan, notifyCooldownMinutes: Number(e.target.value) })
                }
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Delay between offices — min (ms)</label>
              <input
                type="number"
                min={0}
                max={60000}
                value={scan.perOfficeDelayMinMs}
                onChange={(e) =>
                  setScan({ ...scan, perOfficeDelayMinMs: Number(e.target.value) })
                }
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Delay between offices — max (ms)</label>
              <input
                type="number"
                min={0}
                max={120000}
                value={scan.perOfficeDelayMaxMs}
                onChange={(e) =>
                  setScan({ ...scan, perOfficeDelayMaxMs: Number(e.target.value) })
                }
                style={s.input}
              />
            </div>
          </div>
        </section>

        {/* ── DMV locations ── */}
        <section style={s.card}>
          <h2 style={s.sectionTitle}>DMV locations</h2>
          {offices.length === 0 && (
            <p style={s.hint}>No offices configured. Add one below or load from the DMV.</p>
          )}
          {offices.map((o, i) => (
            <div key={i} style={s.officeRow}>
              <input
                type="checkbox"
                checked={o.enabled}
                onChange={(e) => updateOffice(i, { enabled: e.target.checked })}
                title="Enabled"
              />
              <input
                type="number"
                value={o.id || ""}
                onChange={(e) => updateOffice(i, { id: Number(e.target.value) })}
                style={{ ...s.input, width: "5rem" }}
                placeholder="ID"
              />
              <input
                type="text"
                value={o.name}
                onChange={(e) => updateOffice(i, { name: e.target.value })}
                style={{ ...s.input, flex: 1 }}
                placeholder="Office name"
              />
              <button onClick={() => removeOffice(i)} style={s.removeBtn} title="Remove">
                ✕
              </button>
            </div>
          ))}

          <button onClick={() => addOffice()} style={s.actionBtn}>
            + Add office manually
          </button>

          <div style={s.discoverBox}>
            <label style={s.label}>Find CA DMV offices (live lookup)</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                style={{ ...s.input, flex: 1 }}
                placeholder="City or office name, e.g. Pleasanton"
              />
              <button onClick={runDiscover} disabled={discovering} style={s.actionBtn}>
                {discovering ? "Searching…" : "Search DMV"}
              </button>
            </div>
            {discovered.length > 0 && (
              <div style={s.discoverList}>
                {discovered.map((d) => (
                  <div key={d.id} style={s.discoverItem}>
                    <span>
                      <strong>{d.name}</strong>{" "}
                      <span style={s.hint}>#{d.id}</span>
                    </span>
                    <button onClick={() => addDiscovered(d)} style={s.smallBtn}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Personal info ── */}
        <section style={s.card}>
          <h2 style={s.sectionTitle}>DMV form details</h2>
          <p style={s.hint}>
            Source:{" "}
            <strong>
              {personalSource === "config"
                ? "saved in admin"
                : personalSource === "env"
                  ? "environment variables"
                  : "not set"}
            </strong>
            . The DMV requires these to return availability. Values are stored securely and never
            shown back here.
          </p>

          {!editPersonal ? (
            <button onClick={() => setEditPersonal(true)} style={s.actionBtn}>
              {personalSource === "none" ? "Set details" : "Update details"}
            </button>
          ) : (
            <>
              <div style={s.grid2}>
                <div style={s.field}>
                  <label style={s.label}>First name</label>
                  <input
                    style={s.input}
                    value={personal.firstName}
                    onChange={(e) => setPersonal({ ...personal, firstName: e.target.value })}
                  />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Last name</label>
                  <input
                    style={s.input}
                    value={personal.lastName}
                    onChange={(e) => setPersonal({ ...personal, lastName: e.target.value })}
                  />
                </div>
                <div style={s.field}>
                  <label style={s.label}>DL / permit number</label>
                  <input
                    style={s.input}
                    value={personal.dlNumber}
                    placeholder="B1234567"
                    onChange={(e) => setPersonal({ ...personal, dlNumber: e.target.value })}
                  />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Birth month / day / year</label>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input
                      style={{ ...s.input, width: "3.5rem" }}
                      value={personal.birthMonth}
                      placeholder="MM"
                      onChange={(e) => setPersonal({ ...personal, birthMonth: e.target.value })}
                    />
                    <input
                      style={{ ...s.input, width: "3.5rem" }}
                      value={personal.birthDay}
                      placeholder="DD"
                      onChange={(e) => setPersonal({ ...personal, birthDay: e.target.value })}
                    />
                    <input
                      style={{ ...s.input, width: "5rem" }}
                      value={personal.birthYear}
                      placeholder="YYYY"
                      onChange={(e) => setPersonal({ ...personal, birthYear: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setEditPersonal(false);
                  setPersonal({ ...emptyPersonal });
                }}
                style={s.ghostBtn}
              >
                Cancel
              </button>
            </>
          )}
        </section>

        {/* ── Save bar ── */}
        <div style={s.saveBar}>
          <button onClick={runCheckNow} style={s.ghostBtn}>
            Run check now
          </button>
          <button onClick={save} disabled={saving} style={s.saveBtn}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: { minHeight: "100vh", padding: "1.5rem 1rem 4rem" },
  container: { maxWidth: "680px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700 },
  subtitle: { margin: "0.25rem 0 0", color: "#666", fontSize: "0.85rem" },
  card: { background: "#fff", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  sectionTitle: { margin: "0 0 1rem", fontSize: "1.05rem", fontWeight: 600, color: "#222" },
  field: { display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.75rem" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" },
  label: { fontSize: "0.8rem", fontWeight: 600, color: "#444" },
  hint: { fontSize: "0.78rem", color: "#888" },
  input: { padding: "0.5rem 0.7rem", fontSize: "0.9rem", border: "1.5px solid #ddd", borderRadius: "0.45rem", outline: "none" },
  toggleRow: { display: "flex", gap: "0.6rem", alignItems: "flex-start", marginBottom: "1rem", fontSize: "0.9rem" },
  dayRow: { display: "flex", gap: "0.35rem", flexWrap: "wrap" },
  dayChip: { padding: "0.4rem 0.6rem", border: "1.5px solid #ddd", borderRadius: "0.4rem", background: "#fff", cursor: "pointer", fontSize: "0.8rem", color: "#555" },
  dayChipOn: { background: "#0070f3", borderColor: "#0070f3", color: "#fff", fontWeight: 600 },
  officeRow: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" },
  removeBtn: { border: "none", background: "#fee2e2", color: "#b91c1c", borderRadius: "0.4rem", width: "2rem", height: "2rem", cursor: "pointer", fontSize: "0.9rem" },
  actionBtn: { padding: "0.5rem 0.9rem", background: "#f1f5f9", border: "none", borderRadius: "0.45rem", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, color: "#334155", marginTop: "0.25rem" },
  smallBtn: { padding: "0.3rem 0.7rem", background: "#0070f3", color: "#fff", border: "none", borderRadius: "0.4rem", cursor: "pointer", fontSize: "0.8rem" },
  discoverBox: { marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: "0.5rem" },
  discoverList: { display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem", maxHeight: "260px", overflowY: "auto" },
  discoverItem: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.7rem", background: "#f8fafc", borderRadius: "0.4rem", fontSize: "0.85rem" },
  ghostBtn: { background: "none", border: "1px solid #ddd", borderRadius: "0.45rem", padding: "0.5rem 0.9rem", cursor: "pointer", fontSize: "0.85rem", color: "#555" },
  saveBar: { display: "flex", justifyContent: "space-between", gap: "0.75rem", position: "sticky", bottom: "1rem" },
  saveBtn: { flex: 1, padding: "0.75rem", background: "#0070f3", color: "#fff", border: "none", borderRadius: "0.5rem", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer" },
  banner: { padding: "0.7rem 1rem", borderRadius: "0.5rem", fontSize: "0.85rem" },
  bannerOk: { background: "#dcfce7", color: "#166534" },
  bannerErr: { background: "#fee2e2", color: "#b91c1c" },
};
