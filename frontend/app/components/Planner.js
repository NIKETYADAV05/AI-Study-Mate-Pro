"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./Planner.module.css";

// ── Constants ──────────────────────────────────────────────────────────────────
const SUBJECTS = [
  "Computer Networks",
  "Operating Systems",
  "DBMS",
  "Java",
  "Web Development",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "History",
  "Other",
];

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
};

const FILTERS = ["All", "Pending", "Completed", "Overdue"];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// "YYYY-MM-DD" for today in local time, used for overdue checks
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isOverdue(task) {
  return !task.completed && task.due_date < todayISO();
}

function fmtDate(iso) {
  // iso = "YYYY-MM-DD"
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Summary cards config ───────────────────────────────────────────────────────
function buildSummary(tasks) {
  const today = todayISO();
  return [
    {
      label: "Total Tasks",
      value: tasks.length,
      emoji: "📋",
      bg: "var(--primary-light)",
      color: "var(--primary)",
      accent: "linear-gradient(135deg,#4f46e5,#7c3aed)",
    },
    {
      label: "Pending",
      value: tasks.filter((t) => !t.completed).length,
      emoji: "⏳",
      bg: "#fffbeb",
      color: "var(--yellow)",
      accent: "linear-gradient(135deg,#f59e0b,#d97706)",
    },
    {
      label: "Completed",
      value: tasks.filter((t) => t.completed).length,
      emoji: "✅",
      bg: "#f0fdf4",
      color: "var(--green)",
      accent: "linear-gradient(135deg,#10b981,#059669)",
    },
    {
      label: "Overdue",
      value: tasks.filter((t) => !t.completed && t.due_date < today).length,
      emoji: "🚨",
      bg: "#fef2f2",
      color: "var(--red)",
      accent: "linear-gradient(135deg,#ef4444,#dc2626)",
    },
  ];
}

// ── Default form state ─────────────────────────────────────────────────────────
const DEFAULT_FORM = {
  title: "",
  subject: "Other",
  description: "",
  due_date: "",
  priority: "medium",
  duration: "30",
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function Planner() {
  // ── Data state ───────────────────────────────────────────────────────────
  const [tasks,     setTasks]    = useState([]);
  const [loading,   setLoading]  = useState(true);
  const [apiError,  setApiError] = useState("");

  // ── UI state ─────────────────────────────────────────────────────────────
  const [view,        setView]        = useState("list"); // "list" | "form"
  const [editingTask, setEditingTask] = useState(null);   // task object or null (create)
  const [filter,      setFilter]      = useState("All");
  const [search,      setSearch]      = useState("");

  // ── Form state ────────────────────────────────────────────────────────────
  const [form,       setForm]       = useState(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving,     setSaving]     = useState(false);

  // ── Delete confirm ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);

  const topRef = useRef(null);

  // ── Load tasks ────────────────────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch (e) {
      const msg = e.message;
      setApiError(
        msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError")
          ? "Cannot reach the backend. Make sure Django is running on port 8000."
          : msg
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/tasks")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setTasks(data.tasks ?? []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ignore) {
          const msg = e.message ?? "";
          setApiError(
            msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError")
              ? "Cannot reach the backend. Make sure Django is running on port 8000."
              : msg
          );
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  // ── Derived: filtered + searched tasks ────────────────────────────────────
  const today = todayISO();
  const filteredTasks = tasks
    .filter((t) => {
      if (filter === "Pending")   return !t.completed;
      if (filter === "Completed") return  t.completed;
      if (filter === "Overdue")   return !t.completed && t.due_date < today;
      return true;
    })
    .filter((t) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q)
      );
    });

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = buildSummary(tasks);

  // ── Open create form ───────────────────────────────────────────────────────
  function openCreate() {
    setForm(DEFAULT_FORM);
    setFormErrors({});
    setEditingTask(null);
    setView("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Open edit form ─────────────────────────────────────────────────────────
  function openEdit(task) {
    setForm({
      title:       task.title,
      subject:     task.subject,
      description: task.description,
      due_date:    task.due_date,
      priority:    task.priority,
      duration:    String(task.duration),
    });
    setFormErrors({});
    setEditingTask(task);
    setView("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Cancel form ────────────────────────────────────────────────────────────
  function cancelForm() {
    setView("list");
    setFormErrors({});
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // ── Form field helper ──────────────────────────────────────────────────────
  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: "" }));
  }

  // ── Save (create or update) ────────────────────────────────────────────────
  async function handleSave() {
    // Client-side validation
    const errors = {};
    if (!form.title.trim())    errors.title    = "Title is required.";
    else if (form.title.trim().length > 200) errors.title = "Title must be 200 characters or fewer.";
    if (!form.due_date)        errors.due_date = "Due date is required.";
    const dur = parseInt(form.duration, 10);
    if (isNaN(dur) || dur < 1) errors.duration = "Duration must be at least 1 minute.";
    if (dur > 1440)            errors.duration = "Duration must be 1440 minutes or fewer (24h).";
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    setSaving(true);
    setFormErrors({});
    try {
      const url    = editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks";
      const method = editingTask ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:       form.title.trim(),
          subject:     form.subject,
          description: form.description.trim(),
          due_date:    form.due_date,
          priority:    form.priority,
          duration:    parseInt(form.duration, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormErrors(data.errors ?? { general: data.error ?? "Save failed." });
        return;
      }
      await loadTasks();
      setView("list");
      topRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      setFormErrors({ general: "Cannot reach the backend." });
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle completed ───────────────────────────────────────────────────────
  async function toggleComplete(task) {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:       task.title,
          subject:     task.subject,
          description: task.description,
          due_date:    task.due_date,
          priority:    task.priority,
          duration:    task.duration,
          completed:   !task.completed,
        }),
      });
      if (!res.ok) { setApiError("Could not update task."); return; }
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch {
      setApiError("Cannot reach the backend.");
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) { setApiError("Delete failed."); return; }
      setTasks((prev) => prev.filter((t) => t.id !== deleteTarget.id));
    } catch {
      setApiError("Cannot reach the backend.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} ref={topRef}>

      {/* ── Page header ──────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>📅</div>
          <div>
            <h1 className={styles.pageTitle}>Study Planner</h1>
            <p className={styles.pageDesc}>
              Plan your study sessions, set priorities and due dates, and track
              your progress through every task.
            </p>
          </div>
        </div>
        {view === "list" && (
          <button type="button" className={styles.btnPrimary} onClick={openCreate}>
            + New Task
          </button>
        )}
        {view === "form" && (
          <button type="button" className={styles.btnOutline} onClick={cancelForm}>
            ← Back to Planner
          </button>
        )}
      </div>

      {/* ── Global API error ─────────────────────────────────── */}
      {apiError && (
        <div className={styles.errorBox} role="alert">
          <span>⚠️</span>
          <span>{apiError}</span>
          <button className={styles.errorClose} onClick={() => setApiError("")}>✕</button>
        </div>
      )}

      {/* ── Summary cards ────────────────────────────────────── */}
      {view === "list" && (
        <div className={styles.summaryGrid}>
          {summary.map((s) => (
            <div key={s.label} className={styles.summaryCard} style={{ "--card-accent": s.accent }}>
              <div className={styles.summaryIcon} style={{ background: s.bg, color: s.color }}>
                {s.emoji}
              </div>
              <div className={styles.summaryBody}>
                <p className={styles.summaryValue}>{s.value}</p>
                <p className={styles.summaryLabel}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          FORM VIEW (create / edit)
      ══════════════════════════════════════════════════════ */}
      {view === "form" && (
        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>
            {editingTask ? `Editing: ${editingTask.title}` : "New Study Task"}
          </h2>

          {formErrors.general && (
            <div className={styles.errorBox} role="alert" style={{ marginBottom: 18 }}>
              <span>⚠️</span><span>{formErrors.general}</span>
            </div>
          )}

          <div className={styles.formGrid}>

            {/* Title */}
            <div className={`${styles.formGroup} ${styles.formGridFull}`}>
              <label className={styles.formLabel} htmlFor="task-title">Title *</label>
              <input
                id="task-title"
                className={`${styles.formInput} ${formErrors.title ? styles.inputError : ""}`}
                type="text"
                placeholder="e.g. Revise Chapter 4 — Deadlocks"
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                maxLength={200}
              />
              {formErrors.title && <p className={styles.fieldError}>{formErrors.title}</p>}
            </div>

            {/* Subject */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-subject">Subject</label>
              <select
                id="task-subject"
                className={styles.formSelect}
                value={form.subject}
                onChange={(e) => setField("subject", e.target.value)}
              >
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Due date */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-due">Due Date *</label>
              <input
                id="task-due"
                className={`${styles.formInput} ${formErrors.due_date ? styles.inputError : ""}`}
                type="date"
                value={form.due_date}
                onChange={(e) => setField("due_date", e.target.value)}
              />
              {formErrors.due_date && <p className={styles.fieldError}>{formErrors.due_date}</p>}
            </div>

            {/* Priority */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Priority</label>
              <div className={styles.priorityToggle}>
                {["low", "medium", "high"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={[
                      styles.priorityBtn,
                      styles[`priorityBtn${p.charAt(0).toUpperCase() + p.slice(1)}`],
                      form.priority === p ? styles.priorityBtnActive : "",
                    ].join(" ")}
                    onClick={() => setField("priority", p)}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-duration">
                Estimated Duration (minutes)
              </label>
              <input
                id="task-duration"
                className={`${styles.formInput} ${formErrors.duration ? styles.inputError : ""}`}
                type="number"
                min="1"
                max="1440"
                placeholder="30"
                value={form.duration}
                onChange={(e) => setField("duration", e.target.value)}
              />
              {formErrors.duration && <p className={styles.fieldError}>{formErrors.duration}</p>}
            </div>

            {/* Description */}
            <div className={`${styles.formGroup} ${styles.formGridFull}`}>
              <label className={styles.formLabel} htmlFor="task-desc">
                Description <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
              </label>
              <textarea
                id="task-desc"
                className={styles.formTextarea}
                placeholder="Any additional notes about this study session…"
                rows={3}
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
              />
            </div>

            {/* Actions */}
            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? <><span className={styles.spinner} aria-hidden="true" /> Saving…</>
                  : editingTask ? "Update Task" : "Save Task"
                }
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                onClick={cancelForm}
                disabled={saving}
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          LIST VIEW
      ══════════════════════════════════════════════════════ */}
      {view === "list" && (
        <>
          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Search tasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search tasks"
              />
              {search && (
                <button className={styles.clearSearch} onClick={() => setSearch("")} aria-label="Clear search">✕</button>
              )}
            </div>
            <div className={styles.filterTabs} role="group" aria-label="Filter tasks">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className={styles.loadingCard}>
              <div className={styles.loadingDots}><span /><span /><span /></div>
              <p>Loading tasks…</p>
            </div>
          )}

          {/* Empty state — no tasks at all */}
          {!loading && tasks.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>📅</span>
              <h2 className={styles.emptyTitle}>No study tasks yet</h2>
              <p className={styles.emptyDesc}>
                Create your first study task to start organising your schedule.
              </p>
              <button type="button" className={styles.btnPrimary} onClick={openCreate}>
                + Create your first task
              </button>
            </div>
          )}

          {/* Empty state — filter / search returned nothing */}
          {!loading && tasks.length > 0 && filteredTasks.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🔍</span>
              <h2 className={styles.emptyTitle}>No tasks found</h2>
              <p className={styles.emptyDesc}>
                No tasks match{search ? ` "${search}"` : ""}
                {filter !== "All" ? ` in the "${filter}" filter` : ""}.
              </p>
              <button
                className={styles.btnOutline}
                onClick={() => { setSearch(""); setFilter("All"); }}
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Task list */}
          {!loading && filteredTasks.length > 0 && (
            <>
              <p className={styles.resultCount}>
                {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
                {(search || filter !== "All") ? " found" : ""}
              </p>
              <div className={styles.taskList}>
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    today={today}
                    onToggle={() => toggleComplete(task)}
                    onEdit={() => openEdit(task)}
                    onDelete={() => setDeleteTarget(task)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Delete confirmation modal ─────────────────────────── */}
      {deleteTarget && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete task?</h3>
            <p className={styles.modalBody}>
              Are you sure you want to delete <strong>&quot;{deleteTarget.title}&quot;</strong>?
              This cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.btnDanger}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                className={styles.btnOutline}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TaskCard sub-component ─────────────────────────────────────────────────────
function TaskCard({ task, today, onToggle, onEdit, onDelete }) {
  const overdue = !task.completed && task.due_date < today;
  const color = SUBJECT_COLORS[task.subject] ?? "#6b7280";

  const durationLabel =
    task.duration >= 60
      ? `${Math.floor(task.duration / 60)}h${task.duration % 60 ? ` ${task.duration % 60}m` : ""}`
      : `${task.duration}m`;

  return (
    <div
      className={[
        styles.taskCard,
        task.completed ? styles.taskCardCompleted : "",
        overdue        ? styles.taskCardOverdue   : "",
      ].join(" ")}
    >
      <div className={styles.taskCardMain}>

        {/* Complete toggle */}
        <button
          type="button"
          className={`${styles.checkBtn} ${task.completed ? styles.checkBtnDone : ""}`}
          onClick={onToggle}
          aria-label={task.completed ? "Mark as pending" : "Mark as completed"}
          title={task.completed ? "Reopen" : "Mark complete"}
        >
          {task.completed && <span className={styles.checkMark}>✓</span>}
        </button>

        {/* Body */}
        <div className={styles.taskBody}>
          <div className={styles.taskTopRow}>
            <span className={`${styles.taskTitle} ${task.completed ? styles.taskTitleDone : ""}`}>
              {task.title}
            </span>
            <span
              className={`${styles.priorityBadge} ${
                task.priority === "high"
                  ? styles.priorityHigh
                  : task.priority === "low"
                  ? styles.priorityLow
                  : styles.priorityMedium
              }`}
            >
              {task.priority}
            </span>
            {overdue && (
              <span className={styles.overdueBadge}>Overdue</span>
            )}
          </div>

          <div className={styles.taskMeta}>
            {/* Subject pill */}
            <span
              className={styles.subjectPill}
              style={{
                background: color + "1a",
                color,
                borderColor: color + "40",
              }}
            >
              {task.subject}
            </span>

            {/* Due date */}
            <span className={styles.taskMetaItem}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {fmtDate(task.due_date)}
            </span>

            {/* Duration */}
            <span className={styles.taskMetaItem}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              {durationLabel}
            </span>
          </div>

          {task.description && (
            <p className={styles.taskDesc}>{task.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className={styles.taskActions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Edit task"
            onClick={onEdit}
            aria-label="Edit task"
          >
            ✏️
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="Delete task"
            onClick={onDelete}
            aria-label="Delete task"
          >
            🗑
          </button>
        </div>

      </div>
    </div>
  );
}
