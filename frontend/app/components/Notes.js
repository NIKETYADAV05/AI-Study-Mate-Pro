"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./Notes.module.css";

// ── Constants ─────────────────────────────────────────────────────────────────
const SUBJECTS = [
  "All Subjects",
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

// ── View modes ────────────────────────────────────────────────────────────────
// "list"   → grid of note cards
// "view"   → reading a single note
// "edit"   → create or edit form

export default function Notes() {
  const router = useRouter();

  // ── Data state ──────────────────────────────────────────────────────────
  const [notes,       setNotes]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [apiError,    setApiError]    = useState("");

  // ── UI state ─────────────────────────────────────────────────────────────
  const [view,        setView]        = useState("list"); // "list"|"view"|"edit"
  const [activeNote,  setActiveNote]  = useState(null);   // full note object when viewing/editing
  const [isCreating,  setIsCreating]  = useState(false);  // true = new note form

  // ── Search / filter ───────────────────────────────────────────────────────
  const [search,      setSearch]      = useState("");
  const [filterSubj,  setFilterSubj]  = useState("All Subjects");

  // ── Form state ────────────────────────────────────────────────────────────
  const [formTitle,   setFormTitle]   = useState("");
  const [formSubject, setFormSubject] = useState("Other");
  const [formContent, setFormContent] = useState("");
  const [formErrors,  setFormErrors]  = useState({});
  const [saving,      setSaving]      = useState(false);

  // ── Delete confirm ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null); // note to confirm deletion
  const [deleting,     setDeleting]     = useState(false);

  // ── Revision plan ─────────────────────────────────────────────────────────
  const [revisionLoading, setRevisionLoading] = useState(false);
  // null = idle  |  { created, skipped, skippedDays } = result to show
  const [revisionResult,  setRevisionResult]  = useState(null);

  const listTopRef = useRef(null);

  // ── Fetch all notes ───────────────────────────────────────────────────────
  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setNotes(data.notes ?? []);
    } catch (e) {
      setApiError(e.message.includes("fetch") || e.message.includes("Failed")
        ? "Cannot reach the backend. Make sure Django is running on port 8000."
        : e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/notes")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setNotes(data.notes ?? []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ignore) {
          setApiError(e.message.includes("fetch") || e.message.includes("Failed")
            ? "Cannot reach the backend. Make sure Django is running on port 8000."
            : e.message);
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  // ── Filtered notes ────────────────────────────────────────────────────────
  const filteredNotes = notes.filter(n => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || n.title.toLowerCase().includes(q)
      || (n.preview ?? "").toLowerCase().includes(q);
    const matchSubj = filterSubj === "All Subjects" || n.subject === filterSubj;
    return matchSearch && matchSubj;
  });

  // ── Open a note for viewing ───────────────────────────────────────────────
  async function openNote(id) {
    setApiError("");
    setRevisionResult(null);
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (!res.ok) { setApiError("Could not load note."); return; }
      const note = await res.json();
      setActiveNote(note);
      setView("view");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setApiError("Cannot reach the backend.");
    }
  }

  // ── Open edit form ────────────────────────────────────────────────────────
  // note may be a list-level object (no `content` field) when called directly
  // from a NoteCard button.  Fetch the full record first in that case.
  async function openEdit(note) {
    let fullNote = note;
    if (typeof note.content !== "string") {
      // List-level object — fetch the full note to get the content field
      try {
        const res = await fetch(`/api/notes/${note.id}`);
        if (res.ok) {
          fullNote = await res.json();
        } else {
          setApiError("Could not load note for editing.");
          return;
        }
      } catch {
        setApiError("Cannot reach the backend.");
        return;
      }
    }
    setFormTitle(fullNote.title ?? "");
    setFormSubject(fullNote.subject ?? "Other");
    setFormContent(fullNote.content ?? "");
    setFormErrors({});
    setIsCreating(false);
    setActiveNote(fullNote);
    setView("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Open create form ──────────────────────────────────────────────────────
  function openCreate() {
    setFormTitle("");
    setFormSubject("Other");
    setFormContent("");
    setFormErrors({});
    setIsCreating(true);
    setActiveNote(null);
    setView("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Save (create or update) ───────────────────────────────────────────────
  async function handleSave() {
    const errors = {};
    if (!formTitle.trim()) errors.title = "Title is required.";
    else if (formTitle.trim().length > 200) errors.title = "Title must be 200 characters or fewer.";
    if (!formContent.trim()) errors.content = "Content is required.";
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    setSaving(true);
    setFormErrors({});
    try {
      const url    = isCreating ? "/api/notes" : `/api/notes/${activeNote.id}`;
      const method = isCreating ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: formTitle.trim(), subject: formSubject, content: formContent.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormErrors(data.errors ?? { general: data.error ?? "Save failed." });
        return;
      }
      // Success: reload list and go back to list view
      await loadNotes();
      setView("list");
      listTopRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      setFormErrors({ general: "Cannot reach the backend." });
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) { setApiError("Delete failed."); return; }
      await loadNotes();
      // If we were viewing the deleted note, go back to list
      if (activeNote?.id === deleteTarget.id) setView("list");
    } catch {
      setApiError("Cannot reach the backend.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ── Send note content to Summarizer ──────────────────────────────────────
  function openInSummarizer(note) {
    // Pass only the note ID — the Summarizer fetches the full content itself.
    // This avoids HTTP 431 errors from very long ?text= query strings.
    router.push(`/summarizer?noteId=${note.id}`);
  }

  // ── Send note content to Quiz Generator ──────────────────────────────────
  function openInQuiz(note) {
    // Same ID-based approach as above.
    router.push(`/quiz?noteId=${note.id}`);
  }

  // ── Send note content to Study Voice ─────────────────────────────────────
  function openInVoice(note) {
    router.push(`/voice?noteId=${note.id}`);
  }

  // ── Start a spaced-repetition revision plan for this note ─────────────────
  async function startRevisionPlan(note) {
    setRevisionLoading(true);
    setRevisionResult(null);
    setApiError("");
    try {
      const res = await fetch("/api/revision-plan", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ note_id: note.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error ?? "Could not create revision plan.");
        return;
      }
      setRevisionResult({
        created:     data.created,
        skipped:     data.skipped,
        skippedDays: data.skipped_days ?? [],
      });
    } catch {
      setApiError("Cannot reach the backend. Make sure Django is running on port 8000.");
    } finally {
      setRevisionLoading(false);
    }
  }

  // ── Format date ───────────────────────────────────────────────────────────
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} ref={listTopRef}>

      {/* ── Page header ──────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>📚</div>
          <div>
            <h1 className={styles.pageTitle}>My Notes</h1>
            <p className={styles.pageDesc}>
              Save, organise, and study your notes. Send any note directly to the
              Summarizer or Quiz Generator.
            </p>
          </div>
        </div>
        {view === "list" && (
          <button type="button" className={styles.btnPrimary} onClick={openCreate}>
            + New Note
          </button>
        )}
        {view !== "list" && (
          <button type="button" className={styles.btnOutline} onClick={() => { setView("list"); setRevisionResult(null); }}>
            ← Back to Notes
          </button>
        )}
      </div>

      {/* ── Global API error ─────────────────────────────────── */}
      {apiError && (
        <div className={styles.errorBox} role="alert">
          <span>⚠️</span><span>{apiError}</span>
          <button className={styles.errorClose} onClick={() => setApiError("")}>✕</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          LIST VIEW
      ════════════════════════════════════════════════════════ */}
      {view === "list" && (
        <>
          {/* Search + filter bar */}
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Search notes…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Search notes"
              />
              {search && (
                <button className={styles.clearSearch} onClick={() => setSearch("")} aria-label="Clear search">✕</button>
              )}
            </div>
            <select
              className={styles.filterSelect}
              value={filterSubj}
              onChange={e => setFilterSubj(e.target.value)}
              aria-label="Filter by subject"
            >
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Loading */}
          {loading && (
            <div className={styles.loadingCard}>
              <div className={styles.loadingDots}><span/><span/><span/></div>
              <p>Loading notes…</p>
            </div>
          )}

          {/* Empty state */}
          {!loading && notes.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>📝</span>
              <h2 className={styles.emptyTitle}>No notes yet</h2>
              <p className={styles.emptyDesc}>
                Create your first note to start organising your study material.
              </p>
              <button type="button" className={styles.btnPrimary} onClick={openCreate}>
                + Create your first note
              </button>
            </div>
          )}

          {/* Filtered empty */}
          {!loading && notes.length > 0 && filteredNotes.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🔍</span>
              <h2 className={styles.emptyTitle}>No results</h2>
              <p className={styles.emptyDesc}>
                No notes match <strong>&quot;{search}&quot;</strong>
                {filterSubj !== "All Subjects" ? ` in ${filterSubj}` : ""}.
              </p>
              <button className={styles.btnOutline} onClick={() => { setSearch(""); setFilterSubj("All Subjects"); }}>
                Clear filters
              </button>
            </div>
          )}

          {/* Notes grid */}
          {!loading && filteredNotes.length > 0 && (
            <>
              <p className={styles.resultCount}>
                {filteredNotes.length} note{filteredNotes.length !== 1 ? "s" : ""}
                {(search || filterSubj !== "All Subjects") ? " found" : ""}
              </p>
              <div className={styles.grid}>
                {filteredNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    color={SUBJECT_COLORS[note.subject] ?? "#6b7280"}
                    fmtDate={fmtDate}
                    onOpen={openNote}
                    onEdit={openEdit}
                    onDelete={n => setDeleteTarget(n)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          VIEW (READ) NOTE
      ════════════════════════════════════════════════════════ */}
      {view === "view" && activeNote && (
        <div className={styles.noteView}>
          <div className={styles.noteViewHeader}>
            <div>
              <span
                className={styles.subjectPill}
                style={{ background: (SUBJECT_COLORS[activeNote.subject] ?? "#6b7280") + "1a",
                         color: SUBJECT_COLORS[activeNote.subject] ?? "#6b7280",
                         borderColor: (SUBJECT_COLORS[activeNote.subject] ?? "#6b7280") + "40" }}
              >
                {activeNote.subject}
              </span>
              <h2 className={styles.noteViewTitle}>{activeNote.title}</h2>
              <p className={styles.noteViewMeta}>
                Created {fmtDate(activeNote.created)}
                {activeNote.updated !== activeNote.created && ` · Updated ${fmtDate(activeNote.updated)}`}
              </p>
            </div>
            <div className={styles.noteViewActions}>
              <button className={styles.btnOutline} onClick={() => openEdit(activeNote)}>
                ✏️ Edit
              </button>
              <button className={styles.btnDanger} onClick={() => setDeleteTarget(activeNote)}>
                🗑 Delete
              </button>
            </div>
          </div>

          <pre className={styles.noteContent}>{activeNote.content}</pre>

          <div className={styles.toolsRow}>
            <p className={styles.toolsLabel}>Open this note in:</p>
            <button
              className={styles.toolBtn}
              style={{ "--tool-color": "var(--primary)" }}
              onClick={() => openInSummarizer(activeNote)}
            >
              📄 Summarizer
            </button>
            <button
              className={styles.toolBtn}
              style={{ "--tool-color": "var(--green)" }}
              onClick={() => openInQuiz(activeNote)}
            >
              🧠 Quiz Generator
            </button>
            <button
              className={styles.toolBtn}
              style={{ "--tool-color": "#2563eb" }}
              onClick={() => openInVoice(activeNote)}
            >
              🎧 Study Voice
            </button>
            <button
              className={`${styles.toolBtn} ${revisionLoading ? styles.toolBtnDisabled : ""}`}
              style={{ "--tool-color": "#7c3aed" }}
              onClick={() => startRevisionPlan(activeNote)}
              disabled={revisionLoading}
              title="Schedule Day 1, 3, 7 and 14 revision sessions in your Planner"
            >
              {revisionLoading
                ? <><span className={styles.spinnerDark} aria-hidden="true" /> Scheduling…</>
                : "🕰️ Start Revision Plan"}
            </button>
          </div>

          {/* Revision plan feedback */}
          {revisionResult !== null && (
            <div className={
              revisionResult.created > 0
                ? styles.revisionSuccess
                : styles.revisionInfo
            } role="status">
              {revisionResult.created > 0 && revisionResult.skipped === 0 && (
                <>✅ {revisionResult.created} revision session{revisionResult.created !== 1 ? "s" : ""} added to your Planner (Day {[1,3,7,14].join(", Day ")}).</>
              )}
              {revisionResult.created > 0 && revisionResult.skipped > 0 && (
                <>{revisionResult.created} new session{revisionResult.created !== 1 ? "s" : ""} added. {revisionResult.skipped} already existed (Day {revisionResult.skippedDays.join(", Day ")}) and were skipped.</>
              )}
              {revisionResult.created === 0 && (
                <>All 4 revision sessions already exist in your Planner — nothing new was added.</>
              )}
              {" "}
              <button
                className={styles.revisionPlannerLink}
                onClick={() => router.push("/planner")}
              >
                View in Planner →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          EDIT / CREATE FORM
      ════════════════════════════════════════════════════════ */}
      {view === "edit" && (
        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>
            {isCreating ? "New Note" : `Editing: ${activeNote?.title}`}
          </h2>

          {formErrors.general && (
            <div className={styles.errorBox} role="alert">
              <span>⚠️</span><span>{formErrors.general}</span>
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="note-title">Title *</label>
            <input
              id="note-title"
              className={`${styles.formInput} ${formErrors.title ? styles.inputError : ""}`}
              type="text"
              placeholder="e.g. Chapter 5 — Memory Management"
              value={formTitle ?? ""}
              onChange={e => { setFormTitle(e.target.value); setFormErrors(p => ({...p, title: ""})); }}
              maxLength={200}
            />
            {formErrors.title && <p className={styles.fieldError}>{formErrors.title}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="note-subject">Subject</label>
            <select
              id="note-subject"
              className={styles.formSelect}
              value={formSubject ?? "Other"}
              onChange={e => setFormSubject(e.target.value)}
            >
              {SUBJECTS.filter(s => s !== "All Subjects").map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="note-content">Content *</label>
            <textarea
              id="note-content"
              className={`${styles.formTextarea} ${formErrors.content ? styles.inputError : ""}`}
              placeholder="Paste or type your study notes here…"
              rows={16}
              value={formContent ?? ""}
              onChange={e => { setFormContent(e.target.value); setFormErrors(p => ({...p, content: ""})); }}
            />
            {formErrors.content && <p className={styles.fieldError}>{formErrors.content}</p>}
            <p className={styles.charHint}>{(formContent ?? "").length.toLocaleString()} characters</p>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? <><span className={styles.spinner} aria-hidden="true"/> Saving…</>
                : isCreating ? "Save Note" : "Update Note"
              }
            </button>
            <button
              type="button"
              className={styles.btnOutline}
              onClick={() => setView(activeNote && !isCreating ? "view" : "list")}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────── */}
      {deleteTarget && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete note?</h3>
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

// ── Note card sub-component ───────────────────────────────────────────────────
function NoteCard({ note, color, fmtDate, onOpen, onEdit, onDelete }) {
  return (
    <div className={styles.noteCard} style={{ "--card-accent": color }}>
      <div className={styles.noteCardTop} onClick={() => onOpen(note.id)}>
        <span
          className={styles.subjectPill}
          style={{ background: color + "1a", color, borderColor: color + "40" }}
        >
          {note.subject}
        </span>
        <h3 className={styles.noteCardTitle}>{note.title}</h3>
        <p className={styles.noteCardPreview}>{note.preview}</p>
      </div>
      <div className={styles.noteCardBottom}>
        <span className={styles.noteCardDate}>{fmtDate(note.updated)}</span>
        <div className={styles.noteCardActions}>
          <button
            className={styles.iconBtn}
            title="Open in Summarizer"
            onClick={e => { e.stopPropagation(); onOpen(note.id).then ? onOpen(note.id) : onOpen(note.id); }}
            aria-label="View note"
          >
            👁
          </button>
          <button
            className={styles.iconBtn}
            title="Edit note"
            onClick={e => { e.stopPropagation(); onEdit(note); }}
            aria-label="Edit note"
          >
            ✏️
          </button>
          <button
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="Delete note"
            onClick={e => { e.stopPropagation(); onDelete(note); }}
            aria-label="Delete note"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
