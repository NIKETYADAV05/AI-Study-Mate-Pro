"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./Dashboard.module.css";
import Link from "next/link";

// ── Quick action links ──────────────────────────────────────────────────────
const QUICK_LINKS = [
  { href: "/summarizer", label: "Summarize Notes",    emoji: "📄" },
  { href: "/quiz",       label: "Generate a Quiz",    emoji: "🧠" },
  { href: "/boss",       label: "Boss Battles",       emoji: "⚔️" },
  { href: "/nova",       label: "Explain to Nova",    emoji: "🤖" },
  { href: "/planner",    label: "Plan My Week",       emoji: "📅" },
  { href: "/progress",   label: "View Progress",      emoji: "📊" },
];

// ── Stat card definitions — values filled from API ─────────────────────────
function buildStats(data) {
  const pendingLabel = data.overdue_tasks > 0
    ? `${data.overdue_tasks} overdue`
    : `${data.pending_tasks} remaining`;

  const quizSub = data.total_attempts > 0 && data.avg_percentage !== null
    ? `Avg score ${data.avg_percentage}%`
    : data.total_attempts > 0
      ? `${data.total_attempts} taken`
      : "No attempts yet";

  return [
    {
      label: "Saved Notes",
      value: String(data.total_notes),
      sub:   data.total_notes === 1 ? "1 note saved" : `${data.total_notes} notes saved`,
      // accent used for both the top border and icon bg tint
      accent: "linear-gradient(135deg,#4f46e5,#7c3aed)",
      color:  "var(--primary)",
      bg:     "var(--primary-light)",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
    },
    {
      label: "Tasks Completed",
      value: `${data.completed_tasks} / ${data.total_tasks}`,
      sub:   pendingLabel,
      accent: "linear-gradient(135deg,#10b981,#059669)",
      color:  "var(--green)",
      bg:     "#d1fae5",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
    },
    {
      label: "Quizzes Taken",
      value: String(data.total_attempts),
      sub:   quizSub,
      accent: "linear-gradient(135deg,#f59e0b,#d97706)",
      color:  "var(--yellow)",
      bg:     "#fef3c7",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      ),
    },
    {
      label: "Pending Tasks",
      value: String(data.pending_tasks),
      sub:   data.overdue_tasks > 0 ? `${data.overdue_tasks} overdue` : "All on track",
      accent: "linear-gradient(135deg,#06b6d4,#0891b2)",
      color:  "var(--accent)",
      bg:     "#cffafe",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      ),
    },
  ];
}

// ── Subject colour palette ──────────────────────────────────────────────────
const SUBJECT_COLORS = {
  "Computer Networks": "var(--blue)",
  "Operating Systems": "#8b5cf6",
  "DBMS":              "var(--accent)",
  "Java":              "var(--yellow)",
  "Web Development":   "var(--green)",
  "Mathematics":       "var(--red)",
  "Physics":           "#6366f1",
  "Chemistry":         "#ec4899",
  "Biology":           "#84cc16",
  "History":           "#f97316",
  "Other":             "var(--muted)",
};

// ── Activity tag colours ────────────────────────────────────────────────────
const TAG_COLORS = { note: "var(--primary)", task: "var(--green)", quiz: "var(--yellow)" };
const TAG_LABELS = { note: "Notes", task: "Planner", quiz: "Quiz" };

// ── Relative time helper ────────────────────────────────────────────────────
function relativeTime(isoString) {
  const diff  = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Today's date rendered client-side to avoid hydration mismatch ──────────
function TodayDate({ className }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  return <p className={className} suppressHydrationWarning>{today}</p>;
}

// ── Main component ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  // ── Quest state ──────────────────────────────────────────────────────────
  const [quests,        setQuests]        = useState(null);   // null = loading
  const [questError,    setQuestError]    = useState("");
  const [claimingKey,   setClaimingKey]   = useState(null);   // key being claimed
  const [claimResults,  setClaimResults]  = useState({});     // { key: { xp, error } }

  const loadDashboard = useCallback((signal) => {
    fetch("/api/progress", { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!signal?.aborted) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (signal?.aborted || e.name === "AbortError") return;
        const msg = e.message ?? "";
        setError(
          msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError")
            ? "Cannot reach the backend. Make sure Django is running on port 8000."
            : `Could not load dashboard data: ${msg}`
        );
        setLoading(false);
      });
  }, []);

  const loadQuests = useCallback(async () => {
    try {
      const res = await fetch("/api/quests");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setQuests(await res.json());
    } catch {
      setQuestError("Could not load quests. Make sure Django is running.");
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    loadDashboard(controller.signal);

    fetch("/api/quests")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!ignore) setQuests(json);
      })
      .catch(() => {
        if (!ignore) setQuestError("Could not load quests. Make sure Django is running.");
      });

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [loadDashboard]);

  // ── Claim a quest ────────────────────────────────────────────────────────
  async function handleClaim(quest) {
    if (claimingKey) return;
    setClaimingKey(quest.quest_key);
    try {
      const res = await fetch("/api/quests/claim", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          quest_key:  quest.quest_key,
          quest_date: quests.date,
        }),
      });
      const data = await res.json();
      if (res.status === 409 || data.already_claimed) {
        // Already claimed — refresh quest list to sync state
        await loadQuests();
        return;
      }
      if (!res.ok) {
        setClaimResults(prev => ({
          ...prev,
          [quest.quest_key]: { error: data.error ?? "Could not claim quest." },
        }));
        return;
      }
      // Success — update XP/level in quests state and mark this quest claimed
      setClaimResults(prev => ({
        ...prev,
        [quest.quest_key]: { xp: data.xp_awarded },
      }));
      // Refresh the full quest list so everything (XP bar, levels) syncs
      await loadQuests();
    } catch {
      setClaimResults(prev => ({
        ...prev,
        [quest.quest_key]: { error: "Cannot reach the backend." },
      }));
    } finally {
      setClaimingKey(null);
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        <HeroSkeleton />
        <LoadingGrid />
        <div className={styles.row}>
          <LoadingCard height={200} />
          <LoadingCard height={200} />
        </div>
        <div className={styles.bottomRow}>
          <LoadingCard height={180} />
          <LoadingCard height={180} />
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className={styles.page}>
        {/* Hero still renders even on error — no dynamic values needed */}
        <HeroCard pending={null} />
        <div style={{
          padding: "16px 20px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "var(--radius-md)",
          color: "#991b1b",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}>
          <span>⚠️</span>
          <span>{error || "No data available."}</span>
          <button
            onClick={() => {
              setLoading(true);
              setError("");
              loadDashboard();
            }}
            style={{
              marginLeft: "auto", background: "none", border: "1px solid #fecaca",
              borderRadius: "var(--radius-sm)", padding: "4px 12px", cursor: "pointer",
              color: "#991b1b", fontSize: "13px", fontFamily: "inherit",
            }}
          >
            Retry
          </button>
        </div>
        <QuickActionsCard />
      </div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const stats = buildStats(data);

  const chart       = data.activity_chart;
  const chartLabels = chart.labels.slice(-7);
  const chartTasks  = chart.tasks_done.slice(-7);
  const chartQuiz   = chart.quiz_attempts.slice(-7);
  const chartDays   = chartLabels.map(l => l.replace(" 0", " "));
  const chartTotals = chartTasks.map((v, i) => v + chartQuiz[i]);
  const chartMax    = Math.max(1, ...chartTotals);
  const chartTotal  = chartTotals.reduce((a, b) => a + b, 0);

  const subjectProgress = data.tasks_by_subject
    .filter(s => s.total > 0)
    .slice(0, 5)
    .map(s => ({
      subject: s.subject,
      pct:     s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
      color:   SUBJECT_COLORS[s.subject] ?? "var(--muted)",
    }));

  const recentActivity = data.recent_activity.slice(0, 5);
  const hasActivity    = recentActivity.length > 0;
  const hasSubjects    = subjectProgress.length > 0;
  const hasChartActivity = chartTotal > 0;

  // Index of "today" in the 7-day slice — always the last element
  const todayIdx = chartTotals.length - 1;

  return (
    <div className={styles.page}>

      {/* ── Hero banner ─────────────────────────────────────── */}
      <HeroCard pending={data.pending_tasks} overdue={data.overdue_tasks} />

      {/* ── Stat cards ─────────────────────────────────────── */}
      <section className={styles.statsGrid}>
        {stats.map((s) => (
          <div
            key={s.label}
            className={styles.statCard}
            style={{ "--stat-accent": s.accent }}
          >
            <div className={styles.statIcon} style={{ background: s.bg, color: s.color }}>
              {s.icon}
            </div>
            <div className={styles.statBody}>
              <p className={styles.statValue}>{s.value}</p>
              <p className={styles.statLabel}>{s.label}</p>
              <p className={styles.statSub}>{s.sub}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Daily Quests ────────────────────────────────────── */}
      <QuestSection
        quests={quests}
        questError={questError}
        claimingKey={claimingKey}
        claimResults={claimResults}
        onClaim={handleClaim}
      />

      {/* ── Chart + Quick Actions ───────────────────────────── */}
      <div className={styles.row}>

        {/* Weekly Activity chart */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Weekly Activity</h2>
            <span className={styles.cardMeta}>
              {hasChartActivity
                ? `${chartTotal} event${chartTotal !== 1 ? "s" : ""} this week`
                : "No activity yet"}
            </span>
          </div>

          {hasChartActivity ? (
            <div className={styles.barChart}>
              {chartDays.map((day, i) => {
                const val = chartTotals[i];
                const pct = val > 0 ? Math.max(7, Math.round((val / chartMax) * 100)) : 0;
                const isToday = i === todayIdx;
                return (
                  <div key={day} className={styles.barCol}>
                    <span className={styles.barValue}>{val > 0 ? val : ""}</span>
                    <div className={styles.barTrack}>
                      <div
                        className={`${styles.barFill} ${isToday ? styles.barFillToday : ""}`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <span className={styles.barDay}>{day}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.barChart} style={{ alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "var(--muted)", fontSize: "13px", textAlign: "center", lineHeight: 1.6 }}>
                Complete tasks or take a quiz<br />to see activity here.
              </p>
            </div>
          )}
        </section>

        {/* Quick Actions */}
        <QuickActionsCard />
      </div>

      {/* ── Bottom row: Recent Activity + Subject Progress ──── */}
      <div className={styles.bottomRow}>

        {/* Recent Activity */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Activity</h2>
            <Link href="/progress" className={styles.viewAll}>View all →</Link>
          </div>

          {hasActivity ? (
            <ul className={styles.activityList}>
              {recentActivity.map((item, i) => {
                const tagColor = TAG_COLORS[item.type] ?? "var(--muted)";
                const tagLabel = TAG_LABELS[item.type] ?? item.type;
                return (
                  <li key={i} className={styles.activityItem}>
                    <span className={styles.activityEmoji}>{item.icon}</span>
                    <div className={styles.activityBody}>
                      <p className={styles.activityTitle}>{item.title}</p>
                      <p className={styles.activityTime}>{relativeTime(item.time)}</p>
                    </div>
                    <span
                      className={styles.activityTag}
                      style={{ color: tagColor, background: tagColor + "18" }}
                    >
                      {tagLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              emoji="🕐"
              message="No recent activity yet. Create a note, add a task, or take a quiz."
            />
          )}
        </section>

        {/* Subject Progress */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Subject Progress</h2>
            <Link href="/progress" className={styles.viewAll}>Details →</Link>
          </div>

          {hasSubjects ? (
            <div className={styles.progressList}>
              {subjectProgress.map(({ subject, pct, color }) => (
                <div key={subject} className={styles.progressRow}>
                  <div className={styles.progressMeta}>
                    <span className={styles.progressSubject}>{subject}</span>
                    <span className={styles.progressPct}>{pct}%</span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${Math.max(pct, 2)}%`, background: color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              emoji="📚"
              message="Add study tasks in the Planner to see subject progress here."
            />
          )}
        </section>

      </div>
    </div>
  );
}

// ── Hero card — accepts real pending/overdue counts from API ────────────────
// pending = null during error state (rendered without numbers)
function HeroCard({ pending, overdue }) {
  const hasPending = pending !== null;
  const pillText = hasPending
    ? overdue > 0
      ? `${overdue} task${overdue !== 1 ? "s" : ""} overdue`
      : pending > 0
        ? `${pending} task${pending !== 1 ? "s" : ""} pending`
        : "All tasks complete 🎉"
    : null;

  return (
    <div className={styles.hero}>
      <div className={styles.heroContent}>
        <p className={styles.heroEyebrow}>Your Learning Dashboard</p>
        <h1 className={styles.heroWelcome}>Welcome back, Niket 👋</h1>
        <TodayDate className={styles.heroDate} />
      </div>

      <div className={styles.heroMission}>
        {pillText && (
          <span className={styles.missionPill}>
            <span className={styles.missionDot} />
            {pillText}
          </span>
        )}
        {/* Nova — live link now that the feature is implemented */}
        <Link href="/nova" className={styles.novaHint}>
          <span className={styles.novaIcon}>✨</span>
          Try Explain to Nova
        </Link>
      </div>
    </div>
  );
}

// ── Quick Actions card ──────────────────────────────────────────────────────
function QuickActionsCard() {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Quick Actions</h2>
      </div>
      <div className={styles.quickGrid}>
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className={styles.quickCard}>
            <span className={styles.quickEmoji}>{q.emoji}</span>
            <span className={styles.quickLabel}>{q.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Loading skeleton helpers ────────────────────────────────────────────────
function HeroSkeleton() {
  return (
    <div className={styles.hero} style={{ opacity: 0.6 }}>
      <div className={styles.heroContent}>
        <div style={{ height: 12, width: 140, background: "rgba(255,255,255,0.25)", borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 28, width: 260, background: "rgba(255,255,255,0.30)", borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 12, width: 200, background: "rgba(255,255,255,0.20)", borderRadius: 4 }} />
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className={styles.statsGrid}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.statCard} style={{ opacity: 0.45 }}>
          <div className={styles.statIcon} style={{ background: "var(--border)" }} />
          <div className={styles.statBody}>
            <div style={{ height: 22, width: 56, background: "var(--border)", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 11, width: 80, background: "var(--border)", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingCard({ height = 160 }) {
  return (
    <div className={styles.card} style={{ minHeight: height, opacity: 0.45 }}>
      <div style={{ height: 15, width: 120, background: "var(--border)", borderRadius: 4, marginBottom: 16 }} />
      <div style={{ height: height - 60, background: "var(--bg)", borderRadius: "var(--radius-md)" }} />
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ emoji, message }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 10, padding: "28px 16px", textAlign: "center",
    }}>
      <span style={{ fontSize: 30 }}>{emoji}</span>
      <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: 300, lineHeight: 1.6 }}>
        {message}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE QUEST SYSTEM — components
// ─────────────────────────────────────────────────────────────────────────────

// Quest type metadata (visual identity per type)
const QUEST_META = {
  revision: { emoji: "🕰️", label: "Revision",  accent: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  knowledge:{ emoji: "📚", label: "Knowledge", accent: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  battle:   { emoji: "⚔️", label: "Battle",    accent: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  growth:   { emoji: "🌱", label: "Growth",    accent: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
};

// ── XP / Level bar ────────────────────────────────────────────────────────────
function XPBar({ level, totalXp, progressPct, xpToNext, levelEnd }) {
  const levelColors = ["","#4f46e5","#0891b2","#059669","#d97706","#7c3aed"];
  const color = levelColors[level] ?? "#4f46e5";
  return (
    <div className={styles.xpBar}>
      <div className={styles.xpBarTop}>
        <div className={styles.xpLevel} style={{ "--xp-color": color }}>
          <span className={styles.xpLevelIcon}>⭐</span>
          <span className={styles.xpLevelText}>Level {level}</span>
        </div>
        <span className={styles.xpTotal}>{totalXp} XP total</span>
      </div>
      <div className={styles.xpTrack}>
        <div
          className={styles.xpFill}
          style={{ width: `${progressPct}%`, background: color }}
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className={styles.xpHint}>
        {level < 5
          ? `${xpToNext} XP to Level ${level + 1}`
          : "Max level reached! 🏆"}
      </p>
    </div>
  );
}

// ── Individual quest card ─────────────────────────────────────────────────────
function QuestCard({ quest, claimingKey, claimResult, onClaim }) {
  const meta     = QUEST_META[quest.quest_type] ?? QUEST_META.knowledge;
  const isBusy   = claimingKey === quest.quest_key;
  const claimed  = quest.already_claimed;
  const canClaim = quest.claimable && !claimed;

  return (
    <div
      className={[
        styles.questCard,
        claimed         ? styles.questCardDone    : "",
        !quest.claimable && !claimed ? styles.questCardLocked : "",
      ].join(" ")}
      style={{ "--quest-accent": meta.accent, "--quest-bg": meta.bg, "--quest-border": meta.border }}
    >
      {/* Top row: emoji + type badge */}
      <div className={styles.questCardTop}>
        <span className={styles.questEmoji} aria-hidden="true">{meta.emoji}</span>
        <span className={styles.questTypeBadge}>{meta.label}</span>
        <span className={styles.questXpBadge}>+{quest.xp} XP</span>
        {claimed && <span className={styles.questDoneBadge}>✓ Done</span>}
      </div>

      {/* Title + description */}
      <h3 className={styles.questTitle}>{quest.title}</h3>
      <p className={styles.questDesc}>{quest.description}</p>

      {/* Action row */}
      <div className={styles.questActions}>
        {/* Destination link */}
        <Link href={quest.destination} className={styles.questLink}>
          Go →
        </Link>

        {/* Claim button or status */}
        {claimed ? (
          <span className={styles.questClaimedLabel}>XP Claimed ✓</span>
        ) : canClaim ? (
          <button
            type="button"
            className={styles.questClaimBtn}
            onClick={() => onClaim(quest)}
            disabled={!!claimingKey}
            aria-label={`Claim ${quest.xp} XP for ${quest.title}`}
          >
            {isBusy
              ? <><span className={styles.questSpinner} aria-hidden="true" /> Claiming…</>
              : `Claim ${quest.xp} XP`}
          </button>
        ) : (
          <span className={styles.questLockedHint}>
            🔒 {quest.claimable_reason}
          </span>
        )}
      </div>

      {/* Inline feedback */}
      {claimResult?.xp && (
        <div className={styles.questSuccessMsg} role="status">
          🎉 +{claimResult.xp} XP earned!
        </div>
      )}
      {claimResult?.error && (
        <div className={styles.questErrorMsg} role="alert">
          ⚠️ {claimResult.error}
        </div>
      )}
    </div>
  );
}

// ── Quest section ─────────────────────────────────────────────────────────────
function QuestSection({ quests, questError, claimingKey, claimResults, onClaim }) {
  // Loading
  if (quests === null && !questError) {
    return (
      <section className={styles.questSection}>
        <div className={styles.questSectionHeader}>
          <h2 className={styles.cardTitle}>Daily Quests</h2>
        </div>
        <div className={styles.questLoadingRow}>
          {[0,1,2].map(i => (
            <div key={i} className={styles.questCardSkeleton} />
          ))}
        </div>
      </section>
    );
  }

  // Error
  if (questError) {
    return (
      <section className={styles.questSection}>
        <div className={styles.questSectionHeader}>
          <h2 className={styles.cardTitle}>Daily Quests</h2>
        </div>
        <div className={styles.questErrorBox} role="alert">
          <span>⚠️</span>
          <span>{questError}</span>
        </div>
      </section>
    );
  }

  const { quests: questList = [], claimed_today, total_today,
          level, total_xp, progress_pct, xp_to_next, level_end } = quests;

  return (
    <section className={styles.questSection}>
      {/* Header + XP bar */}
      <div className={styles.questSectionHeader}>
        <div className={styles.questHeaderLeft}>
          <h2 className={styles.cardTitle}>⚡ Daily Quests</h2>
          <span className={styles.cardMeta}>
            {claimed_today} / {total_today} completed today
          </span>
        </div>
        <XPBar
          level={level}
          totalXp={total_xp}
          progressPct={progress_pct}
          xpToNext={xp_to_next}
          levelEnd={level_end}
        />
      </div>

      {/* Quest cards */}
      {questList.length === 0 ? (
        <div className={styles.questEmpty}>
          <span>🎯</span>
          <p>No quests available today. Add notes, create revision plans, or take quizzes to unlock quests!</p>
        </div>
      ) : (
        <div className={styles.questGrid}>
          {questList.map(q => (
            <QuestCard
              key={q.quest_key}
              quest={q}
              claimingKey={claimingKey}
              claimResult={claimResults[q.quest_key]}
              onClaim={onClaim}
            />
          ))}
        </div>
      )}
    </section>
  );
}
