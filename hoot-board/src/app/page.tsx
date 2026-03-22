"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────
   Data
   ───────────────────────────────────────────────────────────── */

const SUBTITLES = [
  "The AI That Never Sleeps",
  "The Owl That Ships Code",
  "Your Feathered DevOps Lead",
  "130 Agents In A Trenchcoat",
  "Hoot Hoot Ship Ship",
  "Never Sleeps Always Ships",
];

interface SkillDef {
  name: string;
  category: string;
  emoji: string;
  desc: string;
  link: string;
}

const SKILLS: SkillDef[] = [
  { name: "Dark Factory", category: "Build", emoji: "🏭", desc: "6-agent sealed-envelope build pipeline", link: "https://github.com/DUBSOpenHub/dark-factory" },
  { name: "Havoc Hackathon", category: "Orchestration", emoji: "🏟️", desc: "Multi-model tournament arena", link: "https://github.com/DUBSOpenHub/havoc-hackathon" },
  { name: "Stampede", category: "Orchestration", emoji: "⚡", desc: "20 parallel agents in tmux", link: "https://github.com/DUBSOpenHub/terminal-stampede" },
  { name: "Dispatch", category: "Orchestration", emoji: "📡", desc: "Cross-terminal multi-agent dispatch", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Pitch Master", category: "Productivity", emoji: "🎤", desc: "60-second YC pitch generator", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Design Auditor", category: "Intelligence", emoji: "🔍", desc: "URL conversion audit", link: "https://github.com/DUBSOpenHub/design-auditor" },
  { name: "M365 Easy Button", category: "Productivity", emoji: "🟢", desc: "Google → Microsoft 365 translator", link: "https://github.com/DUBSOpenHub/m365-easy-button" },
  { name: "OctoFund", category: "Intelligence", emoji: "🐙", desc: "OSS funding allocator", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Slack Context", category: "Productivity", emoji: "💬", desc: "Read Slack threads", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Outlook Mail", category: "Productivity", emoji: "📧", desc: "Email with approval gate", link: "#" },
  { name: "CLI Mastery", category: "Training", emoji: "🎓", desc: "Copilot CLI interactive training", link: "https://github.com/DUBSOpenHub/copilot-cli-mastery" },
  { name: "First Light", category: "Training", emoji: "✨", desc: "Build your first agent in 5 min", link: "https://github.com/DUBSOpenHub/copilot-first-light" },
  { name: "CLI Quickstart", category: "Training", emoji: "🚀", desc: "Interactive CLI tutor", link: "https://github.com/DUBSOpenHub/copilot-cli-quickstart" },
  { name: "First Agent", category: "Training", emoji: "🎓", desc: "Non-dev agent building", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "CodeQL Mastery", category: "Intelligence", emoji: "🛡️", desc: "Security scanning expert", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Headcount Zero", category: "Build", emoji: "👔", desc: "AI executive team sim", link: "https://github.com/DUBSOpenHub/headcount-zero" },
  { name: "GDoc Converter", category: "Productivity", emoji: "📄", desc: "Google Docs → Office", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Swarm", category: "Orchestration", emoji: "🐝", desc: "Multi-agent swarm coordination", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "Agent Company", category: "Build", emoji: "🏢", desc: "Full company agent simulation", link: "https://github.com/DUBSOpenHub/copilot-skills" },
  { name: "SOSS Template", category: "Training", emoji: "🛡️", desc: "Security training template", link: "https://github.com/DUBSOpenHub/copilot-skills" },
];

const CATEGORIES = ["All", "Orchestration", "Build", "Productivity", "Intelligence", "Training"];

const MILESTONES = [
  { icon: "��️", when: "Design", title: "Havoc Hackathon", desc: "14 AI models competed in tournament elimination to design the architecture" },
  { icon: "🏭", when: "Build", title: "Dark Factory", desc: "6 specialist agents built it through checkpoint-gated sealed-envelope testing" },
  { icon: "🔧", when: "Ship Night", title: "Tonight", desc: "Copilot CLI wired 20 skills, fixed 2 bugs, and shipped to Telegram in one session" },
  { icon: "📱", when: "Now", title: "Always On", desc: "Hoot runs 24/7 — talk to it from your phone, terminal, or browser" },
];

const KONAMI_SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

const THEMES = ["midnight", "purple", "forest"];

const ASCII_OWL = `    ._____.
    | o o |
    |  V  |
    | === |
    |_____|
   /|     |\\
  / |     | \\
 /__|_____|__\\
  HOOT HOOT! 🦉`;

const ARCH_CHANNELS = [
  { emoji: "💬", label: "Telegram", tip: "Chat with Hoot from anywhere — primary conversational channel" },
  { emoji: "🖥️", label: "TUI", tip: "Terminal interface for power users — direct CLI interaction" },
  { emoji: "🌐", label: "HTTP API", tip: "RESTful API on :7777 — status, skills, metrics, memory" },
];

const ARCH_BOTTOM = [
  { emoji: "🔧", label: "Skills", tip: "20 pluggable capabilities — from Pitch Master to Dark Factory" },
  { emoji: "💾", label: "Memory", tip: "Persistent memory store — context, preferences, conversation history" },
  { emoji: "👷", label: "Workers", tip: "Autonomous agents that execute tasks in isolated environments" },
];

/* ─────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────── */

interface HootStatus {
  status: string;
  workers: { name: string; status: string; workingDir: string }[];
  circuitBreakers: Record<string, { state: string; failures: number }>;
}

/* ─────────────────────────────────────────────────────────────
   Hooks
   ───────────────────────────────────────────────────────────── */

function useCounter(target: number, duration = 2000): number {
  const [count, setCount] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return count;
}

/* ─────────────────────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────────────────────── */

function Confetti() {
  const colors = ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#a78bfa", "#ec4899", "#06b6d4"];
  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {Array.from({ length: 60 }, (_, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: colors[i % colors.length],
            width: `${Math.random() * 8 + 4}px`,
            height: `${Math.random() * 8 + 4}px`,
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${Math.random() * 2 + 2}s`,
            borderRadius: i % 3 === 0 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

function AnimatedStat({ label, value, icon }: { label: string; value: number; icon: string }) {
  const displayed = useCounter(value);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 font-medium">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold font-mono">{displayed}</p>
    </div>
  );
}

function ArchBox({ emoji, label, tip, className = "" }: { emoji: string; label: string; tip: string; className?: string }) {
  return (
    <div className={`arch-box relative rounded-xl bg-zinc-900/80 backdrop-blur-sm px-4 py-3 sm:px-5 sm:py-4 text-center cursor-default ${className}`}>
      <span className="text-2xl">{emoji}</span>
      <p className="text-sm font-semibold mt-1">{label}</p>
      <div className="arch-tooltip absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-zinc-800 text-xs text-zinc-300 rounded-lg px-3 py-2 w-52 z-20 shadow-xl border border-zinc-700">
        {tip}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main Page
   ───────────────────────────────────────────────────────────── */

export default function Home() {
  const [isOnline, setIsOnline] = useState(false);
  const [workerCount, setWorkerCount] = useState(0);
  const [skillCount, setSkillCount] = useState(20);
  const [uptime, setUptime] = useState(0);
  const [subtitleIdx, setSubtitleIdx] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showAscii, setShowAscii] = useState(false);
  const [themeIdx, setThemeIdx] = useState(0);
  const [activeCategory, setActiveCategory] = useState("All");
  const [footerHover, setFooterHover] = useState(false);

  const owlTimes = useRef<number[]>([]);
  const konamiBuffer = useRef<string[]>([]);
  const mainRef = useRef<HTMLDivElement>(null);

  /* ── Fetch daemon status ─────────────────── */
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("hoot-token") || "" : "";
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const check = async () => {
      try {
        const r = await fetch("http://127.0.0.1:7777/status", { headers });
        if (r.ok) {
          const d: HootStatus = await r.json();
          setIsOnline(true);
          setWorkerCount(d.workers?.length ?? 0);
        } else setIsOnline(false);
      } catch {
        setIsOnline(false);
      }
      try {
        const r = await fetch("http://127.0.0.1:7777/skills", { headers });
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d) && d.length) setSkillCount(d.length);
        }
      } catch { /* daemon may be offline */ }
    };

    check();
    const iv = setInterval(() => { check(); setUptime(p => p + 5); }, 5000);
    return () => clearInterval(iv);
  }, []);

  /* ── Theme switcher ──────────────────────── */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", THEMES[themeIdx]);
  }, [themeIdx]);

  /* ── Scroll reveal observer ──────────────── */
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("visible"); }),
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );
    mainRef.current?.querySelectorAll(".reveal:not(.visible)").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [activeCategory]);

  /* ── Konami code ─────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      konamiBuffer.current.push(e.key);
      if (konamiBuffer.current.length > KONAMI_SEQ.length) konamiBuffer.current.shift();
      if (konamiBuffer.current.join(",") === KONAMI_SEQ.join(",")) {
        setShowAscii(true);
        konamiBuffer.current = [];
        setTimeout(() => setShowAscii(false), 3000);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ── Owl click → confetti ────────────────── */
  const handleOwlClick = useCallback(() => {
    const now = Date.now();
    owlTimes.current = [...owlTimes.current, now].filter(t => now - t < 2000);
    if (owlTimes.current.length >= 5) {
      owlTimes.current = [];
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3500);
    }
  }, []);

  const fmtUp = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  };

  const filtered = activeCategory === "All" ? SKILLS : SKILLS.filter(s => s.category === activeCategory);

  /* ── Render ──────────────────────────────── */
  return (
    <div ref={mainRef} className="min-h-screen text-zinc-100 font-sans relative overflow-x-hidden">
      {showConfetti && <Confetti />}

      {showAscii && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none bg-black/60">
          <pre className="animate-ascii-flash text-emerald-400 text-xl sm:text-3xl md:text-4xl font-mono font-bold text-center whitespace-pre">
            {ASCII_OWL}
          </pre>
        </div>
      )}

      {/* Theme toggle moon */}
      <button
        onClick={() => setThemeIdx(i => (i + 1) % THEMES.length)}
        className="fixed top-4 right-4 z-40 text-zinc-700 hover:text-zinc-300 transition-colors text-xl cursor-pointer"
        title={`Theme: ${THEMES[themeIdx]}`}
        aria-label="Toggle theme"
      >
        🌙
      </button>

      {/* ───────────── HERO ───────────── */}
      <section className="relative px-6 pt-20 pb-14 sm:pt-28 sm:pb-20 text-center">
        <div className="absolute top-8 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

        <div
          className="animate-float text-8xl sm:text-9xl cursor-pointer select-none relative z-10"
          onClick={handleOwlClick}
          role="button"
          tabIndex={0}
          aria-label="Click the owl 5 times fast for a surprise"
        >
          🦉
        </div>

        <h1 className="mt-6 text-5xl sm:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
          Hoot
        </h1>

        <button
          onClick={() => setSubtitleIdx(i => (i + 1) % SUBTITLES.length)}
          className="mt-3 text-lg sm:text-xl text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer block mx-auto"
        >
          {SUBTITLES[subtitleIdx]}
        </button>

        <div className="mt-8 flex items-center justify-center gap-4 flex-wrap">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
              isOnline ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? "bg-emerald-400 animate-pulse-glow" : "bg-red-400"
              }`}
            />
            {isOnline ? "Online" : "Offline"}
          </span>
          <a
            href="https://t.me/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 px-6 py-2 text-sm font-semibold text-white transition-colors"
          >
            Talk to Hoot →
          </a>
        </div>
      </section>

      {/* ───────────── LIVE STATS ───────────── */}
      <section className="px-6 pb-14">
        <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 backdrop-blur-sm">
            <p className="text-sm text-zinc-500 font-medium">Status</p>
            <p className="mt-2 text-2xl font-bold">{isOnline ? "🟢 Live" : "🔴 Down"}</p>
          </div>
          <AnimatedStat label="Workers Active" value={workerCount} icon="⚡" />
          <AnimatedStat label="Skills Loaded" value={skillCount} icon="🧠" />
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 backdrop-blur-sm">
            <p className="text-sm text-zinc-500 font-medium">Uptime</p>
            <p className="mt-2 text-2xl font-bold font-mono">{fmtUp(uptime)}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 backdrop-blur-sm col-span-2 sm:col-span-1">
            <p className="text-sm text-zinc-500 font-medium">Model</p>
            <p className="mt-2 text-lg font-bold">Claude Sonnet</p>
          </div>
        </div>
      </section>

      {/* ───────────── ARCHITECTURE ───────────── */}
      <section className="px-6 pb-16 reveal">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Architecture</h2>

          {/* Channels */}
          <div className="flex flex-wrap justify-center gap-3 sm:gap-6">
            {ARCH_CHANNELS.map(n => <ArchBox key={n.label} {...n} />)}
          </div>

          {/* Line down */}
          <div className="flex justify-center py-1"><div className="arch-line w-0.5 h-10" /></div>

          {/* Message Bus */}
          <div className="flex justify-center">
            <ArchBox emoji="📨" label="Message Bus" tip="Routes messages between channels and orchestrator with queue management" className="w-52 sm:w-60" />
          </div>

          <div className="flex justify-center py-1"><div className="arch-line w-0.5 h-10" /></div>

          {/* Orchestrator */}
          <div className="flex justify-center">
            <ArchBox emoji="🧠" label="Orchestrator" tip="The brain — routes tasks to the right worker, manages context and state" className="w-52 sm:w-60 animate-border-glow" />
          </div>

          <div className="flex justify-center py-1"><div className="arch-line w-0.5 h-10" /></div>

          {/* Bottom row */}
          <div className="flex flex-wrap justify-center gap-3 sm:gap-6">
            {ARCH_BOTTOM.map(n => <ArchBox key={n.label} {...n} />)}
          </div>
        </div>
      </section>

      {/* ───────────── SKILLS SHOWCASE ───────────── */}
      <section className="px-6 pb-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2 reveal">Skills Arsenal</h2>
          <p className="text-zinc-500 text-center mb-8 reveal">20 capabilities. Zero hand-written code. All shipped by AI.</p>

          {/* Filter bar */}
          <div className="flex flex-wrap justify-center gap-2 mb-8 reveal">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                  activeCategory === c
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                    : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((s, i) => (
              <div
                key={s.name}
                className="skill-card group rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm p-5 reveal"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{s.emoji}</span>
                  <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${catColor(s.category)}`}>
                    {s.category}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold text-zinc-100">{s.name}</h3>
                <p className="mt-1 text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
                <a
                  href={s.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Learn more →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── HOW IT WAS BUILT ───────────── */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2 reveal">How Hoot Was Built</h2>
          <p className="text-zinc-500 text-center mb-12 reveal">
            No IDE. No hand-written code. Just a human describing what they want.
          </p>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 sm:left-1/2 top-0 bottom-0 w-px bg-zinc-800 sm:-translate-x-px" />

            {MILESTONES.map((m, i) => (
              <div
                key={m.title}
                className={`reveal relative flex items-start mb-14 ${
                  i % 2 === 0 ? "sm:flex-row" : "sm:flex-row-reverse"
                }`}
                style={{ transitionDelay: `${i * 150}ms` }}
              >
                {/* Dot */}
                <div className="absolute left-5 sm:left-1/2 w-3 h-3 bg-emerald-500 rounded-full -translate-x-1/2 mt-6 z-10 shadow-lg shadow-emerald-500/30" />

                {/* Card */}
                <div className={`ml-10 sm:ml-0 sm:w-5/12 ${i % 2 === 0 ? "sm:pr-12 sm:text-right" : "sm:pl-12"}`}>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm p-6">
                    <span className="text-3xl">{m.icon}</span>
                    <p className="text-xs text-emerald-400 font-semibold mt-2 uppercase tracking-wider">{m.when}</p>
                    <h3 className="text-lg font-bold mt-1">{m.title}</h3>
                    <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{m.desc}</p>
                  </div>
                </div>

                <div className="hidden sm:block sm:w-5/12" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── FOOTER ───────────── */}
      <footer className="border-t border-zinc-800/50 px-6 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <div
            className="inline-block cursor-default"
            onMouseEnter={() => setFooterHover(true)}
            onMouseLeave={() => setFooterHover(false)}
          >
            <p className="text-zinc-500">
              Built by{" "}
              <span className="text-zinc-300 font-semibold">Gregg Cochran</span>{" "}
              — a non-technical builder who shipped this with the GitHub Copilot CLI and ~130 AI agents
            </p>

            <div
              className={`overflow-hidden transition-all duration-500 ${
                footerHover ? "max-h-44 opacity-100 mt-4" : "max-h-0 opacity-0"
              }`}
            >
              <p className="text-sm text-zinc-600 leading-relaxed max-w-lg mx-auto">
                Every line of code in this project was written by AI. Gregg described what he wanted
                in plain English, and ~130 AI agents across tools like Havoc Hackathon, Dark Factory,
                and Stampede collaborated to architect, build, test, and ship it. This is what happens
                when you remove the barrier between ideas and execution.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-center gap-6 text-sm">
            <a href="https://github.com/DUBSOpenHub" target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-300 transition-colors">
              GitHub
            </a>
            <a href="https://docs.github.com/en/copilot/github-copilot-in-the-cli" target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-300 transition-colors">
              Copilot CLI Docs
            </a>
            <a href="https://github.com/DUBSOpenHub" target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-300 transition-colors">
              DUBSOpenHub
            </a>
          </div>

          <p className="mt-8 text-zinc-700 text-sm">
            If you can describe what you want, you can build it. 🦉
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function catColor(cat: string): string {
  switch (cat) {
    case "Orchestration": return "bg-blue-500/15 text-blue-400";
    case "Build": return "bg-amber-500/15 text-amber-400";
    case "Productivity": return "bg-emerald-500/15 text-emerald-400";
    case "Intelligence": return "bg-purple-500/15 text-purple-400";
    case "Training": return "bg-cyan-500/15 text-cyan-400";
    default: return "bg-zinc-500/15 text-zinc-400";
  }
}
