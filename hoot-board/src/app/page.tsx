"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/* ---------------------------------------------
   Data
   --------------------------------------------- */

const TYPING_PHRASES_STATIC = [
  "The AI That Never Sleeps",
  "Message Me From Your Phone",
  "I Ship While You Sleep",
  "Powered by Awesome Copilot",
];

const SKILL_CATEGORIES = [
  {
    icon: "\u{1F4BB}",
    title: "Code & Build",
    tagClass: "tag-purple",
    glowColor: "rgba(124,58,237,.15)",
    skills: ["Create Implementation Plan", "Refactor", "Web Coder", "Multi-Stage Dockerfile", "Premium Frontend UI"],
  },
  {
    icon: "\u{1F9EA}",
    title: "Testing & QA",
    tagClass: "tag-blue",
    glowColor: "rgba(37,99,235,.15)",
    skills: ["Playwright Generate Test", "Polyglot Test Agent", "Pytest Coverage", "ScoutQA Test"],
  },
  {
    icon: "\u{1F4DD}",
    title: "Docs & Planning",
    tagClass: "tag-cyan",
    glowColor: "rgba(6,182,212,.15)",
    skills: [
      "Create README",
      "Documentation Writer",
      "Create Specification",
      "PRD",
      "Meeting Minutes",
    ],
  },
  {
    icon: "\u{1F527}",
    title: "DevOps & Cloud",
    tagClass: "tag-green",
    glowColor: "rgba(16,185,129,.15)",
    skills: [
      "Azure Deployment Preflight",
      "Import Infrastructure as Code",
      "DevOps Rollout Plan",
      "Dependabot",
      "GitHub Actions Workflow",
    ],
  },
  {
    icon: "\u{1F916}",
    title: "AI & Agents",
    tagClass: "tag-purple",
    glowColor: "rgba(124,58,237,.15)",
    skills: ["Copilot SDK", "MCP Server Generators", "Declarative Agents", "Semantic Kernel", "Agent Governance"],
  },
];

const PROJECTS = [
  {
    icon: "\u{1F4AC}",
    title: "Telegram Bot",
    desc: "Message Hoot from your phone. Dispatch coding tasks, get notified when done.",
    gradient: "linear-gradient(135deg,#1a0a3b,#0d1f4a)",
    radial:
      "radial-gradient(circle at 30% 60%,rgba(124,58,237,.25),transparent 60%)",
    tags: [
      { label: "grammY", cls: "tag-purple" },
      { label: "TypeScript", cls: "tag-blue" },
      { label: "Copilot SDK", cls: "tag-cyan" },
    ],
  },
  {
    icon: "\u26A1",
    title: "Parallel Processing",
    desc: "Hoot works on 5 things at once. Ask it to build, research, and write — all at the same time.",
    gradient: "linear-gradient(135deg,#081c1c,#0a2030)",
    radial:
      "radial-gradient(circle at 70% 40%,rgba(6,182,212,.2),transparent 60%)",
    tags: [
      { label: "Multi-tasking", cls: "tag-cyan" },
      { label: "Fast", cls: "tag-blue" },
      { label: "Always Ready", cls: "tag-green" },
    ],
  },
  {
    icon: "\u{1F9E9}",
    title: "Community Superpowers",
    desc: "Connected to the awesome-copilot community. New abilities sync automatically every day.",
    gradient: "linear-gradient(135deg,#0a1a0c,#0d2818)",
    radial:
      "radial-gradient(circle at 50% 50%,rgba(16,185,129,.2),transparent 60%)",
    tags: [
      { label: "Auto-Sync", cls: "tag-green" },
      { label: "Community", cls: "tag-cyan" },
      { label: "Growing Daily", cls: "tag-purple" },
    ],
  },
];

const TIMELINE = [
  {
    icon: "\u{1F3DF}\uFE0F",
    when: "14 AI models competed",
    title: "Havoc Hackathon",
    desc: "A tournament of AI models produced the winning design for Hoot.",
  },
  {
    icon: "\u{1F3ED}",
    when: "6 specialist agents",
    title: "Dark Factory",
    desc: "Specialist AI agents built and tested every piece of Hoot automatically.",
  },
  {
    icon: "\u26A1",
    when: "Superpowers connected",
    title: "Awesome Copilot",
    desc: "Connected to the open source community's library of skills, tools, and agents.",
  },
  {
    icon: "\u{1F989}",
    when: "Always on",
    title: "Hoot Goes Live",
    desc: "Running 24/7, auto-syncing new abilities daily, reachable from your phone.",
  },
];

const KONAMI_SEQ = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
];

const ASCII_OWL = `    ._____.
    | o o |
    |  V  |
    | === |
    |_____|
   /|     |\\
  / |     | \\
 /__|_____|__\\
  HOOT HOOT! \u{1F989}`;

/* ---------------------------------------------
   Hooks
   --------------------------------------------- */

function useTypingEffect(phrases: string[]) {
  const [text, setText] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const phrase = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting) {
      if (charIdx < phrase.length) {
        timeout = setTimeout(() => {
          setText(phrase.slice(0, charIdx + 1));
          setCharIdx(charIdx + 1);
        }, 80);
      } else {
        timeout = setTimeout(() => setDeleting(true), 1800);
      }
    } else {
      if (charIdx > 0) {
        timeout = setTimeout(() => {
          setText(phrase.slice(0, charIdx - 1));
          setCharIdx(charIdx - 1);
        }, 45);
      } else {
        setDeleting(false);
        setPhraseIdx((phraseIdx + 1) % phrases.length);
        timeout = setTimeout(() => {}, 400);
      }
    }

    return () => clearTimeout(timeout);
  }, [charIdx, deleting, phraseIdx, phrases]);

  return text;
}

/* ---------------------------------------------
   Sub-components
   --------------------------------------------- */

function Confetti() {
  const colors = [
    "#7c3aed", "#2563eb", "#06b6d4", "#10b981",
    "#f59e0b", "#ec4899", "#a78bfa",
  ];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
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

/* ---------------------------------------------
   Main Page
   --------------------------------------------- */

export default function Home() {
  const mainRef = useRef<HTMLDivElement>(null);
  const owlTimes = useRef<number[]>([]);
  const konamiBuffer = useRef<string[]>([]);
  const cursorRef = useRef<HTMLDivElement>(null);

  const [showConfetti, setShowConfetti] = useState(false);
  const [showAscii, setShowAscii] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [dashboardData, setDashboardData] = useState<{
    status: string;
    workers: { name: string; status: string; workingDir: string }[];
    circuitBreakers: Record<string, { state: string; failures: number }>;
    skillCount: number;
  }>({ status: "unknown", workers: [], circuitBreakers: {}, skillCount: 0 });

  const [awesomeCopilotCount, setAwesomeCopilotCount] = useState(0);
  const skillCount = dashboardData.skillCount || awesomeCopilotCount || 0;
  const skillLabel = skillCount > 0 ? `${skillCount} Superpowers and Growing` : "Superpowers from awesome-copilot";
  const typingPhrases = [
    TYPING_PHRASES_STATIC[0],
    skillLabel,
    ...TYPING_PHRASES_STATIC.slice(1),
  ];
  const typedText = useTypingEffect(typingPhrases);

  /* Fetch skill count from GitHub API (always available, no daemon needed) */
  useEffect(() => {
    const fetchAwesomeCount = async () => {
      try {
        const res = await fetch("https://api.github.com/repos/github/awesome-copilot/contents/skills");
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items)) setAwesomeCopilotCount(items.length);
        }
      } catch { /* ignore */ }
    };
    fetchAwesomeCount();
  }, []);

  /* Dashboard polling (local daemon) */
  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await fetch("http://127.0.0.1:7777/status", { mode: "cors" });
        if (res.ok) {
          const data = await res.json();
          setDashboardData((prev) => ({ ...prev, ...data, status: data.status || "ok" }));
        } else {
          setDashboardData((prev) => ({ ...prev, status: "down" }));
        }
      } catch {
        setDashboardData((prev) => ({ ...prev, status: "down" }));
      }
      try {
        const res = await fetch("http://127.0.0.1:7777/skills", { mode: "cors" });
        if (res.ok) {
          const skills = await res.json();
          if (Array.isArray(skills)) setDashboardData((prev) => ({ ...prev, skillCount: skills.length }));
        }
      } catch { /* ignore */ }
    };
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000);
    return () => clearInterval(interval);
  }, []);

  /* Scroll effects */
  useEffect(() => {
    const onScroll = () => {
      setNavScrolled(window.scrollY > 20);
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Scroll-reveal observer */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        }),
      { threshold: 0.12 },
    );
    mainRef.current
      ?.querySelectorAll(".reveal")
      .forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* Cursor glow */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (cursorRef.current) {
        cursorRef.current.style.left = e.clientX + "px";
        cursorRef.current.style.top = e.clientY + "px";
      }
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  /* Konami code */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      konamiBuffer.current.push(e.key);
      if (konamiBuffer.current.length > KONAMI_SEQ.length)
        konamiBuffer.current.shift();
      if (konamiBuffer.current.join(",") === KONAMI_SEQ.join(",")) {
        setShowAscii(true);
        konamiBuffer.current = [];
        setTimeout(() => setShowAscii(false), 3000);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* 5x owl click -> confetti */
  const handleOwlClick = useCallback(() => {
    const now = Date.now();
    owlTimes.current = [...owlTimes.current, now].filter(
      (t) => now - t < 2000,
    );
    if (owlTimes.current.length >= 5) {
      owlTimes.current = [];
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3500);
    }
  }, []);

  return (
    <div ref={mainRef}>
      {showConfetti && <Confetti />}

      {showAscii && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none",
            background: "rgba(0,0,0,.6)",
          }}
        >
          <pre
            className="animate-ascii-flash"
            style={{
              color: "#10b981",
              fontSize: "clamp(1rem,3vw,2rem)",
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              textAlign: "center",
              whiteSpace: "pre",
            }}
          >
            {ASCII_OWL}
          </pre>
        </div>
      )}

      {/* Cursor glow */}
      <div ref={cursorRef} className="cursor-glow" aria-hidden="true" />

      {/* Back to top */}
      <button
        className={`back-top ${showBackTop ? "visible" : ""}`}
        aria-label="Back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>

      {/* NAV */}
      <nav className={`hoot-nav ${navScrolled ? "scrolled" : ""}`}>
        <a href="#hero" className="nav-logo">
          Hoot {"\u{1F989}"}
        </a>
        <ul className={`nav-links ${mobileMenuOpen ? "open" : ""}`}>
          <li>
            <a href="#skills" onClick={() => setMobileMenuOpen(false)}>
              Superpowers
            </a>
          </li>
          <li>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>
              How It Works
            </a>
          </li>
          <li>
            <a href="#dashboard" onClick={() => setMobileMenuOpen(false)}>
              Dashboard
            </a>
          </li>
          <li>
            <a
              href="https://github.com/DUBSOpenHub/hoot"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileMenuOpen(false)}
            >
              GitHub
            </a>
          </li>
        </ul>
        <button
          className={`nav-burger ${mobileMenuOpen ? "open" : ""}`}
          aria-label="Toggle navigation"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      {/* HERO */}
      <section id="hero" className="hero-section">
        <div className="orb orb-1" aria-hidden="true" />
        <div className="orb orb-2" aria-hidden="true" />
        <div className="orb orb-3" aria-hidden="true" />
        <div className="grid-lines" aria-hidden="true" />

        <div className="hero-content fade-in-up">
          <div className="hero-badge">
            <span className="badge-dot" aria-hidden="true" />
            Always Online {"\u00B7"} Your Personal AI
          </div>

          <h1
            className="hero-name"
            onClick={handleOwlClick}
            role="button"
            tabIndex={0}
            aria-label="Click 5 times fast for a surprise"
          >
            <span>Hoot 🦉</span>
          </h1>

          <div className="hero-typing-wrap">
            <span className="typed-text">{typedText}</span>
            <span className="cursor-blink" />
          </div>

          <p className="hero-desc">
            Your personal AI that runs 24/7 and reaches you on Telegram.
            Hoot builds, writes, researches, and automates {"\u2014"} powered
            by {skillCount > 0 ? `${skillCount}` : ""} community superpowers from{" "}
            <a href="https://github.com/github/awesome-copilot" target="_blank" rel="noopener noreferrer"
               style={{ color: "var(--accent3)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
              awesome-copilot
            </a>.
          </p>

          <div className="hero-actions">
            <a
              href="https://github.com/DUBSOpenHub/hoot"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
              </svg>
              View on GitHub {"\u2192"}
            </a>
            <a href="#" className="btn-outline">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Read the Docs
            </a>
          </div>
        </div>

        <div className="scroll-indicator" aria-hidden="true">
          <div className="scroll-line" />
          <span>SCROLL</span>
        </div>
      </section>

      {/* AGENT POWER BAR */}
      <section className="hoot-section" style={{ paddingTop: "4rem", paddingBottom: "4rem" }}>
        <div className="reveal" style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <span className="section-label" style={{ justifyContent: "center" }}>The Scale</span>
          <h2 className="section-title" style={{ textAlign: "center", marginBottom: "1rem" }}>
            <em>5 agents</em>, {skillCount} superpowers, <em>growing daily</em>
          </h2>
          <p className="section-sub" style={{ margin: "0 auto 3rem", textAlign: "center", maxWidth: 600 }}>
            Hoot runs 5 AI agents in parallel {"\u2014"} each with its own
            context window, all ready the moment you message. Every agent
            has access to every superpower in the library.
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1.5rem",
            maxWidth: 800,
            margin: "0 auto",
          }}>
            {/* 5 Agents */}
            <div className="stat-card" style={{ textAlign: "center", position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", inset: 0, opacity: 0.07,
                background: "radial-gradient(circle at 50% 50%, var(--accent1), transparent 70%)",
              }} />
              <div className="stat-number" style={{ fontSize: "3rem", position: "relative" }}>5</div>
              <div className="stat-label" style={{ position: "relative" }}>Parallel Agents</div>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: ".5rem", lineHeight: 1.5, position: "relative" }}>
                Five AI sessions, each with its own context window
              </p>
            </div>

            {/* Superpowers */}
            <div className="stat-card" style={{
              textAlign: "center", position: "relative", overflow: "hidden",
              borderColor: "rgba(124,58,237,.4)",
              boxShadow: "0 0 40px rgba(124,58,237,.1)",
            }}>
              <div style={{
                position: "absolute", inset: 0, opacity: 0.1,
                background: "radial-gradient(circle at 50% 50%, var(--accent1), transparent 70%)",
              }} />
              <div className="stat-number" style={{ fontSize: "3rem", position: "relative" }}>{skillCount}</div>
              <div className="stat-label" style={{ position: "relative" }}>Superpowers</div>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: ".5rem", lineHeight: 1.5, position: "relative" }}>
                Skills, tools, and agents from the community
              </p>
            </div>

            {/* Daily Sync */}
            <div className="stat-card" style={{ textAlign: "center", position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", inset: 0, opacity: 0.07,
                background: "radial-gradient(circle at 50% 50%, var(--accent2), transparent 70%)",
              }} />
              <div className="stat-number" style={{ fontSize: "3rem", position: "relative" }}>6am</div>
              <div className="stat-label" style={{ position: "relative" }}>Daily Auto-Sync</div>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: ".5rem", lineHeight: 1.5, position: "relative" }}>
                New abilities added every morning
              </p>
            </div>
          </div>

          {/* Stampede callout — honest, optional */}
          <div className="reveal" style={{
            marginTop: "2.5rem",
            padding: "1.25rem 2rem",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            maxWidth: 600,
            margin: "2.5rem auto 0",
          }}>
            <p style={{
              fontSize: ".88rem",
              color: "var(--subtle)",
              lineHeight: 1.7,
              margin: 0,
            }}>
              <span style={{ color: "var(--accent3)", fontWeight: 600 }}>Need even more power?</span>{" "}
              Ask Hoot to use skills like{" "}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: ".82rem",
                color: "#c4b5fd",
                background: "rgba(124,58,237,.12)",
                padding: ".1rem .4rem",
                borderRadius: "4px",
              }}>Stampede</span>{" "}
              or{" "}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: ".82rem",
                color: "#c4b5fd",
                background: "rgba(124,58,237,.12)",
                padding: ".1rem .4rem",
                borderRadius: "4px",
              }}>Dispatch</span>{" "}
              to spin up additional sub-agents for complex jobs.
            </p>
          </div>

          {/* Visual flow arrow */}
          <div className="reveal" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "1rem", marginTop: "2rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: ".82rem", color: "var(--muted)",
            flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--accent1)" }}>You message Hoot</span>
            <span style={{ color: "var(--accent3)" }}>{"\u2192"}</span>
            <span style={{ color: "var(--accent2)" }}>Agents activate</span>
            <span style={{ color: "var(--accent3)" }}>{"\u2192"}</span>
            <span style={{ color: "var(--green)" }}>Results delivered</span>
          </div>
        </div>
      </section>

      {/* ABOUT / STATS */}
      <section id="about" className="hoot-section alt-bg">
        <div className="about-grid">
          <div className="reveal">
            <span className="section-label">About</span>
            <h2 className="section-title">
              Your AI that
              <br />
              <em>never sleeps</em>
            </h2>
            <p className="section-sub">
              Hoot is a personal AI that runs around the clock on your computer.
              Message it from your phone, ask it anything, and it gets to work
              immediately {"\u2014"} handling up to 5 tasks at the same time.
            </p>

            <div className="about-stats">
              <div className="stat-card">
                <div className="stat-number">{skillCount}</div>
                <div className="stat-label">Superpowers</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">5</div>
                <div className="stat-label">Parallel Tasks</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">3s</div>
                <div className="stat-label">Avg Response</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">24/7</div>
                <div className="stat-label">Always On</div>
              </div>
            </div>
          </div>

          <div className="reveal" style={{ transitionDelay: ".15s" }}>
            <div className="code-block">
              <div className="code-titlebar">
                <span className="dot dot-r" aria-hidden="true" />
                <span className="dot dot-y" aria-hidden="true" />
                <span className="dot dot-g" aria-hidden="true" />
                <span className="code-file">hoot.config</span>
              </div>
              <div className="code-body">
                <pre>
                  <span className="cm">{"// what makes Hoot tick"}</span>
                  {"\n"}
                  <span className="kw">const</span>{" "}
                  <span className="fn">hoot</span>{" "}
                  <span className="br">=</span>{" "}
                  <span className="br">{"{"}</span>
                  {"\n"}
                  {"  "}superpowers<span className="br">:</span>{" "}
                  <span className="num">{skillCount || "..."}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}source<span className="br">:</span>{" "}
                  <span className="str">{'"awesome-copilot"'}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}reachVia<span className="br">:</span>{" "}
                  <span className="br">[</span>
                  <span className="str">{'"telegram"'}</span>
                  <span className="br">,</span>{" "}
                  <span className="str">{'"web"'}</span>
                  <span className="br">],</span>
                  {"\n"}
                  {"  "}parallelTasks<span className="br">:</span>{" "}
                  <span className="num">5</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}autoSync<span className="br">:</span>{" "}
                  <span className="str">{'"daily @ 6am"'}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}alwaysOn<span className="br">:</span>{" "}
                  <span className="num">true</span>
                  <span className="br">,</span>
                  {"\n"}
                  <span className="br">{"}"}</span>
                  <span className="br">;</span>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SKILLS */}
      <section id="skills" className="hoot-section">
        <div className="skills-header reveal">
          <span className="section-label">Superpowers</span>
          <h2 className="section-title">
            {skillCount} Superpowers, <em>One Owl</em>
          </h2>
          <p className="section-sub">
            Hoot is connected to{" "}
            <a href="https://github.com/github/awesome-copilot" target="_blank" rel="noopener noreferrer"
               style={{ color: "var(--accent3)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
              github/awesome-copilot
            </a>{" "}
            {"\u2014"} the open source community{"\u2019"}s growing collection of skills,
            tools, and agents. New superpowers sync automatically every morning.
          </p>
        </div>

        <div className="skills-grid">
          {SKILL_CATEGORIES.map((cat, i) => (
            <div
              key={cat.title}
              className="skill-category reveal"
              style={{ transitionDelay: `${i * 0.05}s` }}
            >
              <div
                className="skill-category-icon"
                aria-hidden="true"
                style={{ background: cat.glowColor }}
              >
                {cat.icon}
              </div>
              <h3>{cat.title}</h3>
              <div className="skill-tags">
                {cat.skills.map((skill) => (
                  <span
                    key={skill}
                    className={`skill-tag ${cat.tagClass}`}
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ARCHITECTURE / PROJECTS */}
      <section id="architecture" className="hoot-section alt-bg">
        <div
          style={{ maxWidth: 1100, margin: "0 auto 4rem" }}
          className="reveal"
        >
          <span className="section-label">How It Works</span>
          <h2 className="section-title">
            Three ways Hoot <em>helps you</em>
          </h2>
          <p className="section-sub">
            Message Hoot from Telegram, let it juggle multiple tasks at once,
            and watch its abilities grow every day from the community.
          </p>
        </div>

        <div className="projects-grid">
          {PROJECTS.map((p, i) => (
            <div
              key={p.title}
              className="project-card reveal"
              style={{ transitionDelay: `${i * 0.05}s` }}
            >
              <div
                className="project-card-header"
                style={{ background: p.gradient }}
              >
                <div className="project-icon" aria-hidden="true">
                  {p.icon}
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: p.radial,
                  }}
                />
              </div>
              <div className="project-card-body">
                <div className="project-tags">
                  {p.tags.map((t) => (
                    <span
                      key={t.label}
                      className={`project-tag ${t.cls}`}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE DASHBOARD */}
      <section id="dashboard" className="hoot-section">
        <div
          style={{ maxWidth: 700, margin: "0 auto 4rem" }}
          className="reveal"
        >
          <span className="section-label">Live Status</span>
          <h2 className="section-title">
            Hoot <em>Right Now</em>
          </h2>
          <p className="section-sub">
            {dashboardData.status === "ok"
              ? "Real-time status of your personal AI. The lights are green."
              : "When you install Hoot, this dashboard connects to your local daemon and shows live stats."}
          </p>
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Status + Model Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }} className="reveal">
            <div className="stat-card">
              <div className="stat-number" style={{ color: dashboardData.status === "ok" ? "var(--green)" : "var(--accent3)" }}>
                {dashboardData.status === "ok" ? "● Online" : "● Ready to Install"}
              </div>
              <div className="stat-label">Hoot Status</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{dashboardData.status === "ok" ? dashboardData.workers.length : 5}</div>
              <div className="stat-label">Parallel Agents</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{skillCount}</div>
              <div className="stat-label">Superpowers</div>
            </div>
            <div className="stat-card">
              <div className="stat-number" style={{ fontSize: "1.4rem" }}>
                {dashboardData.status === "ok" && Object.keys(dashboardData.circuitBreakers).length > 0 ? (
                  <span style={{ color: Object.values(dashboardData.circuitBreakers).every((cb: { state: string }) => cb.state === "closed") ? "var(--green)" : "#ef4444" }}>
                    {Object.values(dashboardData.circuitBreakers).every((cb: { state: string }) => cb.state === "closed") ? "✓ All Healthy" : "⚠ Issue Detected"}
                  </span>
                ) : <span style={{ color: "var(--green)" }}>✓ All Systems Go</span>}
              </div>
              <div className="stat-label">System Health</div>
            </div>
          </div>

          {/* Workers List — only when live */}
          {dashboardData.status === "ok" && dashboardData.workers.length > 0 && (
            <div className="reveal" style={{ marginBottom: "2rem" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--subtle)" }}>Active Agents</h3>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {dashboardData.workers.map((w) => (
                  <div key={w.name} style={{
                    padding: "1rem 1.5rem",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{w.name}</span>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem", marginLeft: "1rem" }}>{w.workingDir}</span>
                    </div>
                    <span style={{ color: "var(--green)", fontSize: "0.85rem", fontFamily: "'JetBrains Mono', monospace" }}>{w.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status log */}
          <div className="reveal" style={{
            padding: "1.5rem",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.82rem",
            lineHeight: 1.8,
            color: "var(--subtle)",
            maxHeight: "200px",
            overflow: "auto",
          }}>
            <div style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>// hoot status</div>
            {dashboardData.status === "ok" ? (
              <>
                <div><span style={{ color: "var(--green)" }}>✓</span> Hoot is online and listening</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> {skillCount} superpowers loaded</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> {dashboardData.workers.length} agents ready</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> All systems healthy</div>
                <div><span style={{ color: "var(--accent3)" }}>→</span> Waiting for your message...</div>
              </>
            ) : (
              <>
                <div><span style={{ color: "var(--green)" }}>✓</span> {skillCount} superpowers synced from awesome-copilot</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> 5 parallel agents available</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> Auto-sync runs daily at 6am</div>
                <div><span style={{ color: "var(--green)" }}>✓</span> Telegram, TUI, and HTTP channels ready</div>
                <div><span style={{ color: "var(--accent3)" }}>→</span> Install Hoot to connect this dashboard to your daemon</div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* BECOME AI NATIVE — Install CTA */}
      <section className="hoot-section alt-bg" style={{ textAlign: "center" }}>
        <div className="reveal" style={{ maxWidth: 700, margin: "0 auto" }}>
          <span className="section-label" style={{ justifyContent: "center" }}>Get Started</span>
          <h2 className="section-title" style={{ textAlign: "center" }}>
            Become <em>AI Native</em>
          </h2>
          <p className="section-sub" style={{ margin: "0 auto 2.5rem", textAlign: "center", maxWidth: 520 }}>
            One command. That{"\u2019"}s it. Copy, paste, and Hoot is yours.
          </p>

          {/* Install command */}
          <div style={{
            position: "relative",
            maxWidth: 600,
            margin: "0 auto 2rem",
          }}>
            <div className="code-block" style={{ textAlign: "left" }}>
              <div className="code-titlebar">
                <span className="dot dot-r" aria-hidden="true" />
                <span className="dot dot-y" aria-hidden="true" />
                <span className="dot dot-g" aria-hidden="true" />
                <span className="code-file">terminal</span>
              </div>
              <div className="code-body" style={{ padding: "1.25rem 1.5rem", position: "relative" }}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  <span className="cm">{"# install Hoot with one command"}</span>
                  {"\n"}
                  <span className="fn">{"curl -fsSL"}</span>{" "}
                  <span className="str">{"https://raw.githubusercontent.com/DUBSOpenHub/hoot/main/install.sh"}</span>{" "}
                  <span className="br">{"|"}</span>{" "}
                  <span className="fn">{"bash"}</span>
                </pre>
              </div>
            </div>
          </div>


          <a
            href="https://github.com/DUBSOpenHub/hoot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{ fontSize: "1.05rem", padding: "1rem 2.5rem" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
            </svg>
            Get Hoot on GitHub {"\u2192"}
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="hoot-footer">
        <p style={{ fontSize: "1.6rem" }}>
          Built by{" "}
          <span className="footer-gradient">Gregg Cochran</span>
        </p>
        <p className="footer-tagline">
          🤖 Built by 109 AI agents across 10 models — shipped with the GitHub Copilot
          CLI. No IDE. No hand-written code.
        </p>
        <p className="footer-mantra">
          If you can describe what you want, you can build it.{" "}
          {"\u{1F989}"}
        </p>
        <div className="footer-links">
          <a
            href="https://github.com/DUBSOpenHub/hoot"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://docs.github.com/en/copilot/github-copilot-in-the-cli"
            target="_blank"
            rel="noopener noreferrer"
          >
            Copilot CLI
          </a>
          <a
            href="https://github.com/DUBSOpenHub"
            target="_blank"
            rel="noopener noreferrer"
          >
            DUBSOpenHub
          </a>
        </div>
        <p className="footer-copy">
          {"\u00A9"} 2026 Hoot. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
