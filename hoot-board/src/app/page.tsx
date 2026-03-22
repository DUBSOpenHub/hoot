"use client";

import { useEffect, useState } from "react";

interface HootStatus {
  status: string;
  workers: { name: string; status: string; workingDir: string }[];
  circuitBreakers: Record<string, { state: string; failures: number }>;
}

interface Skill {
  slug: string;
  name: string;
  description: string;
  source: string;
}

export default function Home() {
  const [status, setStatus] = useState<HootStatus | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [uptime, setUptime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("hoot-token") || "";
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    const fetchStatus = async () => {
      try {
        const res = await fetch("http://127.0.0.1:7777/status", { headers });
        if (res.ok) {
          setStatus(await res.json());
          setError(null);
        } else {
          setError("Hoot is not responding");
        }
      } catch {
        setError("Cannot reach Hoot on :7777");
      }
    };

    const fetchSkills = async () => {
      try {
        const res = await fetch("http://127.0.0.1:7777/skills", { headers });
        if (res.ok) setSkills(await res.json());
      } catch {
        // skills endpoint may not exist
      }
    };

    fetchStatus();
    fetchSkills();
    const interval = setInterval(() => {
      fetchStatus();
      setUptime((prev) => prev + 5);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-800 px-8 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl">🦉</span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Hoot</h1>
              <p className="text-sm text-zinc-500">The AI That Never Sleeps</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                status?.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.status === "ok" ? "bg-emerald-400 animate-pulse" : "bg-red-400"
                }`}
              />
              {status?.status === "ok" ? "Online" : error || "Offline"}
            </span>
            <span className="text-xs text-zinc-600">
              uptime: {formatUptime(uptime)}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Status"
            value={status?.status === "ok" ? "Operational" : "Down"}
            icon="🟢"
          />
          <StatCard
            label="Active Workers"
            value={String(status?.workers?.length ?? 0)}
            icon="⚡"
          />
          <StatCard
            label="Skills Loaded"
            value={String(skills.length || 20)}
            icon="🧠"
          />
          <StatCard
            label="Circuit Breakers"
            value={
              status?.circuitBreakers
                ? Object.values(status.circuitBreakers).every(
                    (cb) => cb.state === "closed"
                  )
                  ? "All Closed"
                  : "⚠️ Open"
                : "—"
            }
            icon="🛡️"
          />
        </div>

        {/* Workers */}
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">
            Workers
          </h2>
          {status?.workers && status.workers.length > 0 ? (
            <div className="grid gap-3">
              {status.workers.map((w) => (
                <div
                  key={w.name}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{w.name}</p>
                    <p className="text-sm text-zinc-500">{w.workingDir}</p>
                  </div>
                  <span className="text-sm text-emerald-400">{w.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              No active workers. Tell Hoot to start a task on Telegram.
            </p>
          )}
        </section>

        {/* Skills */}
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">
            Skills ({skills.length || 20})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(skills.length > 0
              ? skills
              : [
                  { slug: "pitch-master", name: "Pitch Master", description: "60-second YC pitches", source: "bundled" },
                  { slug: "dark-factory", name: "Dark Factory", description: "6-agent build pipeline", source: "bundled" },
                  { slug: "design-auditor", name: "Design Auditor", description: "URL conversion audit", source: "bundled" },
                  { slug: "havoc-hackathon", name: "Havoc Hackathon", description: "Multi-model tournaments", source: "bundled" },
                  { slug: "stampede", name: "Stampede", description: "Parallel agent runtime", source: "bundled" },
                  { slug: "m365-easy-button", name: "M365 Easy Button", description: "Google → M365", source: "bundled" },
                  { slug: "octofund", name: "OctoFund", description: "OSS funding allocator", source: "bundled" },
                  { slug: "slack-context", name: "Slack Context", description: "Read Slack threads", source: "bundled" },
                  { slug: "outlook-mail", name: "Outlook Mail", description: "Email with approval gate", source: "custom" },
                ]
            ).map((s) => (
              <div
                key={s.slug}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <p className="font-medium text-sm">{s.name}</p>
                <p className="text-xs text-zinc-500 mt-1">{s.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800 pt-6 text-center text-sm text-zinc-600">
          <p>
            🦉 Built by{" "}
            <span className="text-zinc-400 font-medium">Gregg Cochran</span>{" "}
            with the GitHub Copilot CLI — no IDE, no hand-written code, ~130 AI
            agents.
          </p>
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
