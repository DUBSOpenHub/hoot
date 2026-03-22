"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/* ---------------------------------------------
   Data
   --------------------------------------------- */

const TYPING_PHRASES = [
  "The AI That Never Sleeps",
  "Your Feathered DevOps Lead",
  "130 Agents In A Trenchcoat",
  "Ships Code While You Sleep",
];

const SKILL_CATEGORIES = [
  {
    icon: "\u{1F3D7}\uFE0F",
    title: "Build",
    tagClass: "tag-purple",
    glowColor: "rgba(124,58,237,.15)",
    skills: ["Dark Factory", "Headcount Zero", "Agent Company"],
  },
  {
    icon: "\u26A1",
    title: "Orchestration",
    tagClass: "tag-blue",
    glowColor: "rgba(37,99,235,.15)",
    skills: ["Stampede", "Havoc Hackathon", "Dispatch", "Swarm"],
  },
  {
    icon: "\u{1F4CA}",
    title: "Productivity",
    tagClass: "tag-cyan",
    glowColor: "rgba(6,182,212,.15)",
    skills: [
      "Pitch Master",
      "M365 Easy Button",
      "Slack Context",
      "Outlook Mail",
      "GDoc Converter",
    ],
  },
  {
    icon: "\u{1F393}",
    title: "Training",
    tagClass: "tag-green",
    glowColor: "rgba(16,185,129,.15)",
    skills: [
      "First Light",
      "CLI Quickstart",
      "CLI Mastery",
      "First Agent",
      "CodeQL Mastery",
    ],
  },
  {
    icon: "\u{1F50D}",
    title: "Intelligence",
    tagClass: "tag-purple",
    glowColor: "rgba(124,58,237,.15)",
    skills: ["Design Auditor", "OctoFund", "SOSS Template"],
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
    title: "Worker Pool",
    desc: "Up to 5 concurrent AI sessions. Pre-warmed. Checkout/return pattern.",
    gradient: "linear-gradient(135deg,#081c1c,#0a2030)",
    radial:
      "radial-gradient(circle at 70% 40%,rgba(6,182,212,.2),transparent 60%)",
    tags: [
      { label: "Background Tasks", cls: "tag-cyan" },
      { label: "Circuit Breaker", cls: "tag-blue" },
      { label: "SQLite", cls: "tag-green" },
    ],
  },
  {
    icon: "\u{1F9E9}",
    title: "Skill System",
    desc: "Drop a SKILL.md, gain a capability. 20 skills loaded, hot-reload on change.",
    gradient: "linear-gradient(135deg,#0a1a0c,#0d2818)",
    radial:
      "radial-gradient(circle at 50% 50%,rgba(16,185,129,.2),transparent 60%)",
    tags: [
      { label: "Markdown", cls: "tag-green" },
      { label: "Extensible", cls: "tag-cyan" },
      { label: "Community", cls: "tag-purple" },
    ],
  },
];

const TIMELINE = [
  {
    icon: "\u{1F3DF}\uFE0F",
    when: "14 AI models competed",
    title: "Havoc Hackathon",
    desc: "Tournament elimination produced the winning architecture and PRD.",
  },
  {
    icon: "\u{1F3ED}",
    when: "6 specialist agents",
    title: "Dark Factory",
    desc: "Sealed-envelope testing built the daemon through checkpoint-gated pipeline.",
  },
  {
    icon: "\u26A1",
    when: "20 skills, 2 bug fixes",
    title: "Wiring Night",
    desc: "Copilot CLI wired all skills, fixed priority queue bug, shipped to Telegram.",
  },
  {
    icon: "\u{1F989}",
    when: "Always on",
    title: "Hoot Goes Live",
    desc: "Running 24/7 via launchd, auto-restart, 3-second responses from your phone.",
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

  const typedText = useTypingEffect(TYPING_PHRASES);

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
              Skills
            </a>
          </li>
          <li>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>
              Architecture
            </a>
          </li>
          <li>
            <a href="#journey" onClick={() => setMobileMenuOpen(false)}>
              Journey
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
            Always Online {"\u00B7"} Personal AI Daemon
          </div>

          <h1
            className="hero-name"
            onClick={handleOwlClick}
            role="button"
            tabIndex={0}
            aria-label="Click 5 times fast for a surprise"
          >
            <span>Hoot</span>
          </h1>

          <div className="hero-typing-wrap">
            <span className="typed-text">{typedText}</span>
            <span className="cursor-blink" />
          </div>

          <p className="hero-desc">
            Personal AI daemon with pluggable backends. Ships with Copilot
            SDK {"\u2014"} swap in Ollama, Anthropic, or OpenAI. Runs 24/7,
            remembers everything, reaches you on Telegram.
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

      {/* ABOUT / STATS */}
      <section id="about" className="hoot-section alt-bg">
        <div className="about-grid">
          <div className="reveal">
            <span className="section-label">About</span>
            <h2 className="section-title">
              One daemon to
              <br />
              <em>rule them all</em>
            </h2>
            <p className="section-sub">
              Hoot is a personal AI daemon that runs 24/7 on your Mac. It
              orchestrates up to 5 concurrent AI workers, routes messages
              from Telegram, and remembers every conversation in a local
              SQLite store.
            </p>

            <div className="about-stats">
              <div className="stat-card">
                <div className="stat-number">20</div>
                <div className="stat-label">Skills Loaded</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">5</div>
                <div className="stat-label">Max Workers</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">3s</div>
                <div className="stat-label">Avg Response</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">24/7</div>
                <div className="stat-label">Uptime</div>
              </div>
            </div>
          </div>

          <div className="reveal" style={{ transitionDelay: ".15s" }}>
            <div className="code-block">
              <div className="code-titlebar">
                <span className="dot dot-r" aria-hidden="true" />
                <span className="dot dot-y" aria-hidden="true" />
                <span className="dot dot-g" aria-hidden="true" />
                <span className="code-file">hoot.config.ts</span>
              </div>
              <div className="code-body">
                <pre>
                  <span className="cm">{"// hoot.config"}</span>
                  {"\n"}
                  <span className="kw">const</span>{" "}
                  <span className="fn">hoot</span>{" "}
                  <span className="br">=</span>{" "}
                  <span className="br">{"{"}</span>
                  {"\n"}
                  {"  "}model<span className="br">:</span>{" "}
                  <span className="str">{'"gpt-4.1"'}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}channels<span className="br">:</span>{" "}
                  <span className="br">[</span>
                  <span className="str">{'"telegram"'}</span>
                  <span className="br">,</span>{" "}
                  <span className="str">{'"tui"'}</span>
                  <span className="br">,</span>{" "}
                  <span className="str">{'"http"'}</span>
                  <span className="br">],</span>
                  {"\n"}
                  {"  "}skills<span className="br">:</span>{" "}
                  <span className="num">20</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}workers<span className="br">:</span>{" "}
                  <span className="br">{"{"}</span>{" "}
                  warm<span className="br">:</span>{" "}
                  <span className="num">2</span>
                  <span className="br">,</span>{" "}
                  max<span className="br">:</span>{" "}
                  <span className="num">5</span>{" "}
                  <span className="br">{"}"}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}memory<span className="br">:</span>{" "}
                  <span className="str">{'"sqlite"'}</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}autoRoute<span className="br">:</span>{" "}
                  <span className="num">false</span>
                  <span className="br">,</span>
                  {"\n"}
                  {"  "}timeout<span className="br">:</span>{" "}
                  <span className="num">30_000</span>
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
          <span className="section-label">Capabilities</span>
          <h2 className="section-title">
            20 Skills, <em>One Owl</em>
          </h2>
          <p className="section-sub">
            Drop a SKILL.md into the skills folder and Hoot picks it up on
            the next message.
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
          <span className="section-label">Architecture</span>
          <h2 className="section-title">
            How Hoot <em>works</em>
          </h2>
          <p className="section-sub">
            Three pillars make up the daemon {"\u2014"} a Telegram bot, a
            worker pool, and a pluggable skill system.
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

      {/* JOURNEY / TIMELINE */}
      <section id="journey" className="hoot-section">
        <div
          style={{ maxWidth: 700, margin: "0 auto 4rem" }}
          className="reveal"
        >
          <span className="section-label">The Journey</span>
          <h2 className="section-title">
            From Hackathon <em>to Hoot</em>
          </h2>
          <p className="section-sub">
            How a non-technical builder shipped a production AI daemon in a
            single weekend.
          </p>
        </div>

        <div className="timeline">
          <div className="timeline-line" aria-hidden="true" />
          {TIMELINE.map((entry, i) => (
            <div
              key={entry.title}
              className="timeline-entry reveal"
              style={{ transitionDelay: `${i * 0.15}s` }}
            >
              <div className="timeline-dot" aria-hidden="true" />
              <div className="timeline-content">
                <div className="timeline-when">{entry.when}</div>
                <div className="timeline-title">
                  {entry.icon} {entry.title}
                </div>
                <div className="timeline-desc">{entry.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="hoot-footer">
        <p style={{ fontSize: "1.6rem" }}>
          Built by{" "}
          <span className="footer-gradient">Gregg Cochran</span>
        </p>
        <p className="footer-tagline">
          A non-technical builder who shipped this with the GitHub Copilot
          CLI and ~130 AI agents.
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
