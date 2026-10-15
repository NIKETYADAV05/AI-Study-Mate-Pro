"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./Progress.module.css";

// ── Subject colour palette (matches Notes and Planner) ────────────────────────
const SUBJECT_COLORS = {
  "Computer Networks": "#3b82f6",
  "Operating Systems": "#8b5cf6",
  "DBMS":              "#06b6d4",
  "Java":              "#f59e0b",
  "Web Development":   "#10b981",
  "Mathematics":       "#ef4444",
  "Physics":           "#6366f1",
  "Chemistry":         "#ec4899",
  "Biology":           "#84cc16",
  "History":           "#f97316",
  "Other":             "#6b7280",
  "Unknown":           "#9ca3af",
};

// ── Relative time helper ───────────────────────────────────────────────────────
function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Score colour helper ────────────────────────────────────────────────────────
function scoreClass(pct) {
  if (pct >= 75) return styles.scoreGood;
  if (pct >= 50) return styles.scoreOk;
  return styles.scorePoor;
}

// ── Top-level stat card config ─────────────────────────────────────────────────
function buildStatCards(data) {
  return [
    {
      label: "Saved Notes",
      value: data.total_notes,
      emoji: "📄",
      bg:    "var(--primary-light)",
      color: "var(--primary)",
      accent: "linear-gradient(135deg,#4f46e5,#7c3aed)",
    },
    {
      label: "Tasks Created",
      value: data.total_tasks,
      emoji: "📋",
      bg:    "#fffbeb",
      color: "var(--yellow)",
      accent: "linear-gradient(135deg,#f59e0b,#d97706)",
    },
    {
      label: "Tasks Done",
      value: data.completed_tasks,
      emoji: "✅",
      bg:    "#f0fdf4",
      color: "var(--green)",
      accent: "linear-gradient(135deg,#10b981,#059669)",
    },
    {
      label: "Quiz Attempts",
      value: data.total_attempts,
      emoji: "🧠",
      bg:    "#cffafe",
      color: "var(--accent)",
      accent: "linear-gradient(135deg,#06b6d4,#0891b2)",
    },
  ];
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Progress() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    let ignore = false;
    fetch("/api/progress")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!ignore) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ignore) {
          const msg = e.message ?? "";
          setError(
            msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError")
              ? "Cannot reach the backend. Make sure Django is running on port 8000."
              : `Error loading progress data: ${msg}`
          );
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        <PageHeader />
        <div className={styles.loadingCard}>
          <div className={styles.loadingDots}><span /><span /><span /></div>
          <p>Loading your progress…</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.page}>
        <PageHeader />
        <div className={styles.errorBox} role="alert">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statCards  = buildStatCards(data);
  const chart      = data.activity_chart;
  const hasNotes   = data.total_notes   > 0;
  const hasTasks   = data.total_tasks   > 0;
  const hasQuiz    = data.total_attempts > 0;
  const hasActivity = data.recent_activity.length > 0;

  // ── Activity chart: combine tasks_done + quiz_attempts into a single series
  // showing total "events" per day for a simple bar chart
  const chartMax = Math.max(
    1,
    ...chart.tasks_done.map((v, i) => v + chart.quiz_attempts[i])
  );

  // ── Subject progress: merge notes + tasks + quiz per subject ──────────────
  const subjectMap = {};

  for (const row of data.notes_by_subject) {
    if (!subjectMap[row.subject]) subjectMap[row.subject] = { notes: 0, tasks: 0, tasks_done: 0, quiz_attempts: 0, avg_pct: null };
    subjectMap[row.subject].notes = row.count;
  }
  for (const row of data.tasks_by_subject) {
    if (!subjectMap[row.subject]) subjectMap[row.subject] = { notes: 0, tasks: 0, tasks_done: 0, quiz_attempts: 0, avg_pct: null };
    subjectMap[row.subject].tasks      = row.total;
    subjectMap[row.subject].tasks_done = row.done;
  }
  for (const row of data.quiz_by_subject) {
    if (!subjectMap[row.subject]) subjectMap[row.subject] = { notes: 0, tasks: 0, tasks_done: 0, quiz_attempts: 0, avg_pct: null };
    subjectMap[row.subject].quiz_attempts = row.attempts;
    subjectMap[row.subject].avg_pct       = row.avg_pct;
  }

  // Sort: subjects with tasks first (completion-ratio matters), then by total activity
  const subjectRows = Object.entries(subjectMap)
    .map(([subject, s]) => ({
      subject,
      ...s,
      completionPct: s.tasks > 0 ? Math.round((s.tasks_done / s.tasks) * 100) : null,
      activityScore: s.notes + s.tasks + s.quiz_attempts,
    }))
    .sort((a, b) => b.activityScore - a.activityScore)
    .slice(0, 8);

  const hasSubjectData = subjectRows.length > 0;

  return (
    <div className={styles.page}>
      <PageHeader />

      {/* ── Stat cards ───────────────────────────────────────── */}
      <div className={styles.statGrid}>
        {statCards.map((s) => (
          <div key={s.label} className={styles.statCard} style={{ "--card-accent": s.accent }}>
            <div className={styles.statIcon} style={{ background: s.bg, color: s.color }}>
              {s.emoji}
            </div>
            <div className={styles.statBody}>
              <p className={styles.statValue}>{s.value}</p>
              <p className={styles.statLabel}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Task breakdown + Quiz avg ─────────────────────────── */}
      <div className={styles.row}>

        {/* Task summary */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Task Overview</h2>
          </div>
          {!hasTasks ? (
            <EmptyState emoji="📋" title="No tasks yet" desc="Create study tasks in the Planner to track them here." />
          ) : (
            <div className={styles.subjectList}>
              {[
                { label: "Completed", value: data.completed_tasks, color: "var(--green)",   bg: "#f0fdf4" },
                { label: "Pending",   value: data.pending_tasks,   color: "var(--yellow)",  bg: "#fffbeb" },
                { label: "Overdue",   value: data.overdue_tasks,   color: "var(--red)",     bg: "#fef2f2" },
              ].map((row) => (
                <div key={row.label} className={styles.subjectRow}>
                  <div className={styles.subjectMeta}>
                    <span className={styles.subjectName}>{row.label}</span>
                    <span className={styles.subjectDetail} style={{ color: row.color, fontWeight: 700 }}>
                      {row.value}
                    </span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width:      `${data.total_tasks > 0 ? Math.round((row.value / data.total_tasks) * 100) : 0}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quiz summary */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Quiz Performance</h2>
            {hasQuiz && data.avg_percentage !== null && (
              <span className={`${styles.scorePill} ${scoreClass(data.avg_percentage)}`}>
                Avg {data.avg_percentage}%
              </span>
            )}
          </div>
          {!hasQuiz ? (
            <EmptyState emoji="🧠" title="No quiz attempts yet" desc="Complete a quiz in the Quiz Generator and your results will appear here." />
          ) : (
            <table className={styles.quizTable}>
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Type</th>
                  <th>Difficulty</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_attempts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className={`${styles.scorePill} ${scoreClass(a.percentage)}`}>
                        {a.score}/{a.total_questions} ({a.percentage}%)
                      </span>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{a.quiz_type}</td>
                    <td><span className={styles.diffBadge}>{a.difficulty}</span></td>
                    <td style={{ color: "var(--muted)" }}>{relativeTime(a.taken_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Activity chart (14 days) ──────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>14-Day Activity</h2>
          <span className={styles.cardMeta}>Tasks completed + quiz attempts per day</span>
        </div>

        {!hasNotes && !hasTasks && !hasQuiz ? (
          <EmptyState
            emoji="📈"
            title="No activity recorded yet"
            desc="Activity from notes, tasks, and quizzes will appear here as you use the app."
          />
        ) : (
          <>
            <div className={styles.barChart}>
              {chart.labels.map((label, i) => {
                const total = chart.tasks_done[i] + chart.quiz_attempts[i];
                const pct   = total > 0 ? Math.max(4, Math.round((total / chartMax) * 100)) : 0;
                return (
                  <div key={label} className={styles.barCol}>
                    <span className={styles.barValue}>{total > 0 ? total : ""}</span>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          height:     `${pct}%`,
                          background: "var(--primary)",
                          opacity:    total > 0 ? 1 : 0,
                        }}
                      />
                    </div>
                    <span className={styles.barLabel}>{label}</span>
                  </div>
                );
              })}
            </div>
            <div className={styles.barLegend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: "var(--primary)" }} />
                Tasks completed
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: "var(--accent)" }} />
                Quiz attempts
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Subject progress ──────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Subject Breakdown</h2>
        </div>
        {!hasSubjectData ? (
          <EmptyState
            emoji="📚"
            title="No subjects yet"
            desc="Subject data appears once you create notes or tasks."
          />
        ) : (
          <div className={styles.subjectList}>
            {subjectRows.map(({ subject, notes, tasks, tasks_done, quiz_attempts, completionPct, avg_pct }) => {
              const color  = SUBJECT_COLORS[subject] ?? "#6b7280";
              const barPct = completionPct !== null ? completionPct : 0;
              const parts  = [];
              if (notes > 0)         parts.push(`${notes} note${notes !== 1 ? "s" : ""}`);
              if (tasks > 0)         parts.push(`${tasks_done}/${tasks} tasks`);
              if (quiz_attempts > 0) parts.push(`${quiz_attempts} quiz${avg_pct !== null ? ` (avg ${avg_pct}%)` : ""}`);
              return (
                <div key={subject} className={styles.subjectRow}>
                  <div className={styles.subjectMeta}>
                    <span className={styles.subjectName} style={{ color }}>
                      {subject}
                    </span>
                    <span className={styles.subjectDetail}>
                      {parts.join(" · ")}
                      {completionPct !== null ? ` · ${completionPct}% done` : ""}
                    </span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width:      `${Math.max(barPct, notes > 0 || quiz_attempts > 0 ? 5 : 0)}%`,
                        background: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent activity ───────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Recent Activity</h2>
        </div>
        {!hasActivity ? (
          <EmptyState
            emoji="🕐"
            title="No activity yet"
            desc="Your notes, completed tasks, and quiz results will show up here."
          />
        ) : (
          <ul className={styles.activityList}>
            {data.recent_activity.map((item, i) => {
              const color = item.subject ? (SUBJECT_COLORS[item.subject] ?? "#6b7280") : "#6b7280";
              return (
                <li key={i} className={styles.activityItem}>
                  <span className={styles.activityEmoji}>{item.icon}</span>
                  <div className={styles.activityBody}>
                    <p className={styles.activityTitle}>{item.title}</p>
                    <p className={styles.activityTime}>{relativeTime(item.time)}</p>
                  </div>
                  {item.subject && (
                    <span
                      className={styles.activitySubject}
                      style={{
                        background:   color + "1a",
                        color,
                        borderColor:  color + "40",
                      }}
                    >
                      {item.subject}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function PageHeader() {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.headerIcon}>📊</div>
      <div>
        <h1 className={styles.pageTitle}>Progress Tracker</h1>
        <p className={styles.pageDesc}>
          A live view of your study activity — derived entirely from your saved notes,
          study tasks, and completed quizzes.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ emoji, title, desc }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>{emoji}</span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyDesc}>{desc}</p>
    </div>
  );
}
