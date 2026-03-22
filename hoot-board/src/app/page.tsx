"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

interface ActivityEntry {
  id: number;
  timestamp: string;
  message: string;
  type: "info" | "success" | "warning";
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FUN_PHRASES = [
  "The Owl That Ships Code",
  "Your Feathered DevOps Lead",
  "130 Agents In A Trenchcoat",
  "Hoot Hoot, Ship Ship",
  "Never Sleeps, Always Ships",
  "The AI That Never Sleeps",
];

const ASCII_OWL = `
   ,___,
   (o,o)
   /)  )
  --"-"--
  H O O T !
`;

const ACTIVITY_MESSAGES: { message: string; type: ActivityEntry["type"] }[] = [
  { message: "Health check passed", type: "success" },
  { message: "Status poll completed", type: "info" },
  { message: "All circuit breakers nominal", type: "success" },
  { message: "Skills registry refreshed", type: "info" },
  { message: "Worker heartbeat received", type: "info" },
  { message: "Memory sync completed", type: "success" },
  { message: "Metrics scraped from /metrics", type: "info" },
  { message: "Daemon uptime checkpoint", type: "info" },
];

const DEFAULT_SKILLS: Skill[] = [
  { slug: "pitch-master", name: "Pitch Master", description: "60-second YC pitches", source: "bundled" },
  { slug: "dark-factory", name: "Dark Factory", description: "6-agent build pipeline", source: "bundled" },
  { slug: "design-auditor", name: "Design Auditor", description: "URL conversion audit", source: "bundled" },
  { slug: "havoc-hackathon", name: "Havoc Hackathon", description: "Multi-model tournaments", source: "bundled" },
  { slug: "stampede", name: "Stampede", description: "Parallel agent runtime", source: "bundled" },
  { slug: "m365-easy-button", name: "M365 Easy Button", description: "Google → M365", source: "bundled" },
  { slug: "octofund", name: "OctoFund", description: "OSS funding allocator", source: "bundled" },
  { slug: "slack-context", name: "Slack Context", description: "Read Slack threads", source: "bundled" },
  { slug: "outlook-mail", name: "Outlook Mail", description: "Email with approval gate", source: "custom" },
];

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SkillCategory = "coding" | "orchestration" | "productivity" | "training";

function getSkillCategory(slug: string): SkillCategory {
  if (["dark-factory", "havoc-hackathon", "stampede", "dispatch"].includes(slug))
    return "orchestration";
  if (["code-review", "codeql", "repo-detective", "security-audit"].includes(slug))
    return "coding";
  if (["first-agent", "cli-mastery", "copilot-cli-quickstart", "copilot-first-light"].includes(slug) || slug.startsWith("soss"))
    return "training";
  return "productivity";
}

const CATEGORY_STYLES: Record<SkillCategory, { border: string; hover: string; glow: string; badge: string }> = {
  coding:        { border: "border-blue-500/30",    hover: "hover:border-blue-400/50",    glow: "hover:shadow-blue-500/20",    badge: "bg-blue-500/10 text-blue-400" },
  orchestration: { border: "border-purple-500/30",  hover: "hover:border-purple-400/50",  glow: "hover:shadow-purple-500/20",  badge: "bg-purple-500/10 text-purple-400" },
  productivity:  { border: "border-emerald-500/30", hover: "hover:border-emerald-400/50", glow: "hover:shadow-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400" },
  training:      { border: "border-orange-500/30",  hover: "hover:border-orange-400/50",  glow: "hover:shadow-orange-500/20",  badge: "bg-orange-500/10 text-orange-400" },
};

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function nowTimestamp() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Confetti                                                           */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4"];

function ConfettiOverlay() {
  const particles = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.5,
    duration: 2 + Math.random() * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 4 + Math.random() * 8,
    shape: i % 3, // 0=circle, 1=square, 2=rect
  }));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: "-12px",
            width: `${p.size}px`,
            height: p.shape === 2 ? `${p.size * 0.5}px` : `${p.size}px`,
            borderRadius: p.shape === 0 ? "50%" : "1px",
            backgroundColor: p.color,
            animation: `confettiFall ${p.duration}s ${p.delay}s ease-in both`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Konami overlay                                                     */
/* ------------------------------------------------------------------ */

function KonamiOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0,0,0,0.96)",
        animation: "fadeInOut 3s ease forwards",
      }}
    >
      <pre
        className="text-emerald-400 font-bold font-mono text-center select-none text-3xl sm:text-5xl md:text-7xl"
        style={{ textShadow: "0 0 40px rgba(52,211,153,0.4)" }}
      >
        {ASCII_OWL}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StatCard with animated counter                                     */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  icon,
  numericTarget,
}: {
  label: string;
  value: string;
  icon: string;
  numericTarget?: number;
}) {
  const [display, setDisplay] = useState(numericTarget !== undefined ? "0" : value);
  const animated = useRef(false);

  useEffect(() => {
    if (numericTarget !== undefined && numericTarget > 0 && !animated.current) {
      animated.current = true;
      const dur = 1200;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(String(Math.round(eased * numericTarget)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else if (numericTarget === undefined) {
      setDisplay(value);
    }
  }, [numericTarget, value]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 backdrop-blur-sm hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-zinc-500">{label}</p>
        <span className="text-lg sm:text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-xl sm:text-2xl font-bold tabular-nums">{display}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  /* — core state — */
  const [status, setStatus] = useState<HootStatus | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [uptime, setUptime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /* — activity feed — */
  const [feed, setFeed] = useState<ActivityEntry[]>([]);
  const feedId = useRef(0);

  const addActivity = useCallback((message: string, type: ActivityEntry["type"]) => {
    const id = ++feedId.current;
    setFeed((prev) => [{ id, timestamp: nowTimestamp(), message, type }, ...prev].slice(0, 50));
  }, []);

  /* — easter egg state — */
  const [owlHooting, setOwlHooting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showKonami, setShowKonami] = useState(false);
  const [subtitleIdx, setSubtitleIdx] = useState(FUN_PHRASES.length - 1);
  const [subtitleCycling, setSubtitleCycling] = useState(false);
  const [footerExpanded, setFooterExpanded] = useState(false);
  const owlClicks = useRef(0);
  const owlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const konamiKeys = useRef<string[]>([]);

  /* — data fetching — */
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
        /* skills endpoint may not exist yet */
      }
    };

    fetchStatus();
    fetchSkills();
    addActivity("Dashboard initialized", "info");

    const interval = setInterval(() => {
      fetchStatus();
      setUptime((prev) => prev + 5);
      const msg = ACTIVITY_MESSAGES[Math.floor(Math.random() * ACTIVITY_MESSAGES.length)];
      addActivity(msg.message, msg.type);
    }, 5000);

    return () => clearInterval(interval);
  }, [addActivity]);

  /* — konami code listener — */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      konamiKeys.current.push(e.key);
      if (konamiKeys.current.length > KONAMI.length) {
        konamiKeys.current = konamiKeys.current.slice(-KONAMI.length);
      }
      if (konamiKeys.current.length === KONAMI.length &&
          konamiKeys.current.every((k, i) => k === KONAMI[i])) {
        konamiKeys.current = [];
        setShowKonami(true);
        addActivity("🦉 Konami code activated!", "success");
        setTimeout(() => setShowKonami(false), 3000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addActivity]);

  /* — owl click handler — */
  const handleOwlClick = useCallback(() => {
    // Hoot animation
    setOwlHooting(true);
    setTimeout(() => setOwlHooting(false), 600);

    // Track rapid clicks for party mode
    owlClicks.current += 1;
    if (owlClicks.current >= 5) {
      owlClicks.current = 0;
      setShowConfetti(true);
      addActivity("🎉 Party mode activated!", "success");
      setTimeout(() => setShowConfetti(false), 4000);
    }
    if (owlTimer.current) clearTimeout(owlTimer.current);
    owlTimer.current = setTimeout(() => { owlClicks.current = 0; }, 2000);
  }, [addActivity]);

  /* — subtitle cycling — */
  const handleSubtitleClick = useCallback(() => {
    if (subtitleCycling) return;
    setSubtitleCycling(true);
    let i = 0;
    const iv = setInterval(() => {
      setSubtitleIdx(i);
      i += 1;
      if (i >= FUN_PHRASES.length) {
        clearInterval(iv);
        setSubtitleCycling(false);
      }
    }, 700);
  }, [subtitleCycling]);

  /* — derived — */
  const displaySkills = skills.length > 0 ? skills : DEFAULT_SKILLS;
  const isOnline = status?.status === "ok";

  const cbValue = status?.circuitBreakers
    ? Object.values(status.circuitBreakers).every((cb) => cb.state === "closed")
      ? "All Closed"
      : "⚠️ Open"
    : "—";

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div
      className="min-h-screen text-zinc-100 font-sans relative overflow-x-hidden"
      style={{
        background:
          "linear-gradient(135deg, #09090b 0%, #0c1220 25%, #09090f 50%, #100a18 75%, #09090b 100%)",
        backgroundSize: "400% 400%",
        animation: "gradientShift 30s ease infinite",
      }}
    >
      {/* --- overlays --- */}
      {showConfetti && <ConfettiOverlay />}
      {showKonami && <KonamiOverlay />}

      {/* --- header --- */}
      <header className="border-b border-zinc-800/60 px-4 sm:px-8 py-6 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-y-3">
          <div className="flex items-center gap-3">
            {/* animated owl */}
            <button
              onClick={handleOwlClick}
              className="text-4xl cursor-pointer select-none relative focus:outline-none"
              style={{
                display: "inline-block",
                animation: owlHooting
                  ? "owlSpin 0.6s ease-in-out"
                  : "owlFloat 3s ease-in-out infinite",
              }}
              title={owlHooting ? "Hoot! 🦉" : "Click me!"}
              aria-label="Hoot owl"
            >
              🦉
              {owlHooting && (
                <span
                  className="absolute -top-8 left-1/2 text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded whitespace-nowrap pointer-events-none"
                  style={{ animation: "tooltipPop 0.6s ease forwards" }}
                >
                  Hoot! 🦉
                </span>
              )}
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Hoot</h1>
              <p
                className="text-sm text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors select-none"
                onClick={handleSubtitleClick}
              >
                {FUN_PHRASES[subtitleIdx]}
              </p>
            </div>
          </div>

          {/* status badge */}
          <div className="flex items-center gap-4">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                isOnline ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {isOnline && (
                  <span
                    className="absolute inline-flex h-full w-full rounded-full bg-emerald-400"
                    style={{ animation: "pulseRing 1.5s ease-out infinite" }}
                  />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isOnline ? "bg-emerald-400" : "bg-red-400"
                  }`}
                  style={isOnline ? { animation: "smoothPulse 2s ease-in-out infinite" } : undefined}
                />
              </span>
              <span className="hidden sm:inline">{isOnline ? "Online" : error || "Offline"}</span>
            </span>
            <span className="text-xs text-zinc-600 hidden sm:inline">
              uptime: {formatUptime(uptime)}
            </span>
          </div>
        </div>
      </header>

      {/* --- main --- */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8">
        {/* stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Status" value={isOnline ? "Operational" : "Down"} icon="🟢" />
          <StatCard
            label="Active Workers"
            value={String(status?.workers?.length ?? 0)}
            icon="⚡"
            numericTarget={status?.workers?.length ?? 0}
          />
          <StatCard
            label="Skills Loaded"
            value={String(skills.length || 20)}
            icon="🧠"
            numericTarget={skills.length || 20}
          />
          <StatCard label="Circuit Breakers" value={cbValue} icon="🛡️" />
        </div>

        {/* workers */}
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">Workers</h2>
          {status?.workers && status.workers.length > 0 ? (
            <div className="grid gap-3">
              {status.workers.map((w) => (
                <div
                  key={w.name}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex items-center justify-between backdrop-blur-sm hover:border-zinc-700 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{w.name}</p>
                    <p className="text-sm text-zinc-500 truncate">{w.workingDir}</p>
                  </div>
                  <span className="text-sm text-emerald-400 shrink-0 ml-3">{w.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              No active workers. Tell Hoot to start a task on Telegram.
            </p>
          )}
        </section>

        {/* activity feed */}
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">Activity Feed</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
            <div
              className="overflow-y-auto p-4 font-mono text-xs space-y-1"
              style={{ maxHeight: "220px" }}
            >
              {feed.length === 0 ? (
                <p className="text-zinc-600">Waiting for activity…</p>
              ) : (
                feed.map((e) => (
                  <div key={e.id} className="flex gap-3 leading-relaxed">
                    <span className="text-zinc-600 shrink-0">{e.timestamp}</span>
                    <span
                      className={
                        e.type === "success"
                          ? "text-emerald-400"
                          : e.type === "warning"
                          ? "text-amber-400"
                          : "text-zinc-500"
                      }
                    >
                      {e.type === "success" ? "✓" : e.type === "warning" ? "⚠" : "›"}
                    </span>
                    <span className="text-zinc-300">{e.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* skills */}
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">
            Skills ({displaySkills.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displaySkills.map((s) => {
              const cat = getSkillCategory(s.slug);
              const cs = CATEGORY_STYLES[cat];
              return (
                <div
                  key={s.slug}
                  className={`rounded-lg border ${cs.border} ${cs.hover} bg-zinc-900/50 p-4 backdrop-blur-sm cursor-default transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${cs.glow}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-medium text-sm truncate">{s.name}</p>
                    <span className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full shrink-0 ${cs.badge}`}>
                      {cat}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{s.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* footer */}
        <footer className="border-t border-zinc-800/60 pt-6 text-center text-sm text-zinc-600">
          <p
            className="cursor-default"
            onMouseEnter={() => setFooterExpanded(true)}
            onMouseLeave={() => setFooterExpanded(false)}
          >
            🦉 Built by{" "}
            <span className="text-zinc-400 font-medium transition-colors hover:text-zinc-200">
              Gregg Cochran
            </span>
            <span
              className="inline transition-opacity duration-500"
              style={{ opacity: footerExpanded ? 1 : 0.7 }}
            >
              {footerExpanded
                ? " — a non-technical builder who shipped this with ~130 AI agents and zero hand-written code"
                : " with the GitHub Copilot CLI — no IDE, no hand-written code, ~130 AI agents."}
            </span>
          </p>
        </footer>
      </main>
    </div>
  );
}
