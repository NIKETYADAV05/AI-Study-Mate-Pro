"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./Nova.module.css";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_REF_CHARS  = 20_000;
const MAX_EXPL_CHARS = 5_000;

// ── SVG score ring ────────────────────────────────────────────────────────────

function ScoreRing({ pct }) {
  const r   = 46;
  const circ = 2 * Math.PI * r;
  // Clamp 0–100
  const safe = Math.max(0, Math.min(100, pct));
  const dash = circ * (safe / 100);

  // Colour: red → yellow → green
  const color =
    safe >= 70 ? "#10b981"
    : safe >= 40 ? "#f59e0b"
    : "#ef4444";

  return (
    <svg
      className={styles.scoreRing}
      viewBox="0 0 110 110"
      aria-hidden="true"
    >
      {/* track */}
      <circle
        cx="55" cy="55" r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth="9"
      />
      {/* filled arc */}
      <circle
        cx="55" cy="55" r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 55 55)"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s" }}
      />
    </svg>
  );
}

// ── Concept section ───────────────────────────────────────────────────────────

function ConceptSection({ title, items, tagClass, headingClass }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={styles.conceptSection}>
      <p className={`${styles.conceptHeading} ${headingClass}`}>
        {title} <span>({items.length})</span>
      </p>
      <div className={styles.conceptTags}>
        {items.map((c, i) => (
          <span key={i} className={`${styles.conceptTag} ${tagClass}`}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Nova() {
  // Reference source: "paste" | "note"
  const [sourceMode,   setSourceMode]   = useState("paste");

  // Saved notes for the dropdown
  const [notes,        setNotes]        = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);

  // Reference state
  const [selectedNoteId,      setSelectedNoteId]      = useState("");
  const [noteContent,         setNoteContent]         = useState(null);   // full content from detail endpoint
  const [noteContentLoading,  setNoteContentLoading]  = useState(false);
  const [noteContentError,    setNoteContentError]    = useState("");
  const [refText,              setRefText]             = useState("");

  // Explanation state
  const [explanation, setExplanation] = useState("");

  // UI state
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState("");

  const resultRef = useRef(null);

  // ── Load saved notes on mount ──────────────────────────────────────────────
  useEffect(() => {
    let ignore = false;
    fetch("/api/notes")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        if (!ignore) {
          const list = Array.isArray(data) ? data : (data.notes ?? []);
          setNotes(list);
        }
      })
      .catch(() => {
        // Non-fatal: user can still paste reference manually
      })
      .finally(() => {
        if (!ignore) setNotesLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  // ── Fetch full note content when a note is selected ────────────────────────
  // The list endpoint returns only a short `preview`; full `content` requires
  // the detail endpoint GET /api/notes/<id>/.
  useEffect(() => {
    if (!selectedNoteId) return;

    let ignore = false;
    fetch(`/api/notes/${encodeURIComponent(selectedNoteId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((note) => {
        if (!ignore) {
          setNoteContent(note.content ?? "");
        }
      })
      .catch(() => {
        if (!ignore) {
          setNoteContentError("Could not load note content. Please try again or paste your reference.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setNoteContentLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedNoteId]);

  // ── Selected note preview text ─────────────────────────────────────────────
  // NOTE: list endpoint returns only `preview`; full content is loaded separately
  // via the detail endpoint when selectedNoteId changes (see useEffect above).
  const selectedNote = notes.find((n) => String(n.id) === String(selectedNoteId));

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSourceMode(mode) {
    setSourceMode(mode);
    setError("");
    setResult(null);
  }

  function handleRefChange(e) {
    if (e.target.value.length <= MAX_REF_CHARS) {
      setRefText(e.target.value);
      setError("");
    }
  }

  function handleExplChange(e) {
    if (e.target.value.length <= MAX_EXPL_CHARS) {
      setExplanation(e.target.value);
      setError("");
    }
  }

  function handleReset() {
    setRefText("");
    setExplanation("");
    setSelectedNoteId("");
    setNoteContent(null);
    setNoteContentError("");
    setResult(null);
    setError("");
  }

  async function handleCheck() {
    setError("");

    // Client-side guard: reference
    if (sourceMode === "paste") {
      if (refText.trim().length < 50) {
        setError("Please paste at least 50 characters of reference text.");
        return;
      }
    } else {
      if (!selectedNoteId) {
        setError("Please select a saved note as your reference.");
        return;
      }
    }

    // Client-side guard: explanation
    if (explanation.trim().length < 20) {
      setError("Please write at least 20 characters in your explanation.");
      return;
    }

    setLoading(true);
    setResult(null);

    const body =
      sourceMode === "note"
        ? { note_id: Number(selectedNoteId), explanation: explanation.trim() }
        : { ref_text: refText.trim(), explanation: explanation.trim() };

    try {
      const res = await fetch("/api/nova-check", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(30_000),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Server error (${res.status}). Please try again.`);
        return;
      }

      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);

    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        setError("The request timed out. Make sure the Django backend is running on port 8000.");
      } else if (
        err.name === "TypeError" ||
        err.message?.toLowerCase().includes("fetch") ||
        err.message?.toLowerCase().includes("network") ||
        err.message?.toLowerCase().includes("failed")
      ) {
        setError(
          "Cannot reach the backend. Make sure Django is running: " +
          "backend\\venv\\Scripts\\python.exe backend\\manage.py runserver 127.0.0.1:8000"
        );
      } else {
        setError(`Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const refCount       = refText.length;
  const refPercent     = Math.min((refCount / MAX_REF_CHARS) * 100, 100);
  const refWarn        = refCount > MAX_REF_CHARS * 0.9;

  const explCount      = explanation.length;
  const explPercent    = Math.min((explCount / MAX_EXPL_CHARS) * 100, 100);
  const explWarn       = explCount > MAX_EXPL_CHARS * 0.9;

  const coveragePct    = result?.concept_coverage ?? 0;
  const scoreColor     = coveragePct >= 70 ? "#10b981" : coveragePct >= 40 ? "#f59e0b" : "#ef4444";
  const scoreLabel     =
    coveragePct >= 70 ? "Great coverage!"
    : coveragePct >= 40 ? "Decent start"
    : "Keep going";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── Page header ──────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerIcon}>🤖</div>
        <div>
          <h1 className={styles.pageTitle}>Explain It to Nova</h1>
          <p className={styles.pageDesc}>
            Explain a concept in your own words and Nova will highlight which key concepts
            you covered, partially covered, or missed — using transparent phrase matching.
            The <strong>Concept Coverage</strong> score estimates topic coverage, not true understanding.
          </p>
        </div>
      </div>

      {/* ── Reference card ───────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Reference Material</h2>
        </div>

        {/* Source mode toggle */}
        <div className={styles.sourceTabs} role="group" aria-label="Reference source">
          <button
            type="button"
            className={`${styles.sourceTab} ${sourceMode === "paste" ? styles.sourceTabActive : ""}`}
            onClick={() => handleSourceMode("paste")}
          >
            📋 Paste Text
          </button>
          <button
            type="button"
            className={`${styles.sourceTab} ${sourceMode === "note" ? styles.sourceTabActive : ""}`}
            onClick={() => handleSourceMode("note")}
          >
            📝 My Notes
          </button>
        </div>

        {sourceMode === "paste" ? (
          <>
            <textarea
              className={`${styles.textarea} ${styles.textareaRef}`}
              placeholder="Paste your reference text here — lecture notes, textbook excerpt, topic summary…"
              value={refText}
              onChange={handleRefChange}
              aria-label="Reference text"
              spellCheck="true"
            />
            <div className={styles.charBar}>
              <div
                className={styles.charBarFill}
                style={{ width: `${refPercent}%`, background: refWarn ? "var(--red)" : "#06b6d4" }}
              />
            </div>
            <span className={refWarn ? styles.charCountWarn : styles.charCount}>
              {refCount.toLocaleString()} / {MAX_REF_CHARS.toLocaleString()} characters
            </span>
          </>
        ) : (
          <div className={styles.noteSelector}>
            <label className={styles.label} htmlFor="note-select">Choose a saved note</label>
            <select
              id="note-select"
              className={styles.select}
              value={selectedNoteId}
              onChange={(e) => {
                const newId = e.target.value;
                setSelectedNoteId(newId);
                setNoteContent(null);
                setNoteContentError("");
                setError("");
                setResult(null);
                if (newId) {
                  setNoteContentLoading(true);
                } else {
                  setNoteContentLoading(false);
                }
              }}
              disabled={notesLoading}
            >
              <option value="">
                {notesLoading ? "Loading notes…" : notes.length === 0 ? "No notes saved yet" : "— Select a note —"}
              </option>
              {notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} {n.subject ? `(${n.subject})` : ""}
                </option>
              ))}
            </select>

            {selectedNoteId && selectedNote && (
              <div className={styles.noteTitleBadge} aria-label="Selected note title">
                <span className={styles.noteTitleIcon}>📝</span>
                <span className={styles.noteTitleText}>{selectedNote.title}</span>
                {selectedNote.subject && (
                  <span className={styles.noteTitleSubject}>{selectedNote.subject}</span>
                )}
              </div>
            )}

            {selectedNoteId && (
              <div className={styles.notePreview} aria-label="Note preview">
                {noteContentLoading
                  ? <span className={styles.notePreviewMuted}>Loading note content…</span>
                  : noteContentError
                    ? <span className={styles.notePreviewError}>{noteContentError}</span>
                    : noteContent === null
                      ? null
                      : noteContent.trim().length === 0
                        ? <span className={styles.notePreviewMuted}>This note has no content yet.</span>
                        : noteContent.slice(0, 300) + (noteContent.length > 300 ? "…" : "")
                }
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Explanation card ─────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Your Explanation</h2>
          <span className={explWarn ? styles.charCountWarn : styles.charCount}>
            {explCount.toLocaleString()} / {MAX_EXPL_CHARS.toLocaleString()} characters
          </span>
        </div>

        <textarea
          className={`${styles.textarea} ${styles.textareaExpl}`}
          placeholder="Explain the concept in your own words, as if you're teaching it to a friend…"
          value={explanation}
          onChange={handleExplChange}
          aria-label="Your explanation"
          spellCheck="true"
        />
        <div className={styles.charBar}>
          <div
            className={styles.charBarFill}
            style={{ width: `${explPercent}%`, background: explWarn ? "var(--red)" : "var(--primary)" }}
          />
        </div>

        <div className={styles.infoBox} style={{ marginTop: "12px" }}>
          <span>💡</span>
          <span>
            Try to mention each main concept by name. Nova checks for concept words and known
            aliases — it doesn&apos;t detect paraphrasing, so use the same terms where you can.
          </span>
        </div>

        {error && (
          <div className={styles.errorBox} role="alert">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleCheck}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Checking…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Check My Explanation
              </>
            )}
          </button>

          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleReset}
            disabled={loading}
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Loading ───────────────────────────────────────────────── */}
      {loading && (
        <div className={styles.loadingCard} aria-live="polite">
          <div className={styles.loadingDots}>
            <span /><span /><span />
          </div>
          <p>Nova is analysing your explanation…</p>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────── */}
      {result && !loading && (
        <div className={styles.resultsCard} ref={resultRef}>

          <div className={styles.resultsHeader}>
            <div>
              <p className={styles.resultsTitle}>Nova&apos;s Feedback</p>
              <p className={styles.resultsMeta}>
                {result.total_concepts} concept{result.total_concepts !== 1 ? "s" : ""} analysed
              </p>
            </div>
          </div>

          {/* Topic mismatch warning — advisory only, does not alter score */}
          {result.topic_mismatch_warning && (
            <div className={styles.mismatchWarning} role="alert">
              <span className={styles.mismatchWarningIcon}>⚠️</span>
              <div>
                <strong>Possible topic mismatch</strong>
                <p>{result.topic_mismatch_hint}</p>
                <p className={styles.mismatchDisclaimer}>
                  This check is based on word matching, not semantic analysis.
                  The score below reflects how well your explanation covered the
                  reference concepts — it has not been changed.
                </p>
              </div>
            </div>
          )}

          {/* Score block */}
          <div className={styles.scoreBlock}>
            <div className={styles.scoreRingWrap} aria-label={`Concept coverage ${coveragePct}%`}>
              <ScoreRing pct={coveragePct} />
              <div className={styles.scoreInner} aria-hidden="true">
                <span className={styles.scorePct}>{coveragePct}%</span>
                <span className={styles.scoreLabel}>Coverage</span>
              </div>
            </div>

            <div className={styles.scoreDetails}>
              <p className={styles.scoreName} style={{ color: scoreColor }}>{scoreLabel}</p>
              <p className={styles.scoreFeedback}>{result.feedback}</p>
              <p className={styles.scoreDisclaimer}>
                <strong>Concept Coverage</strong> counts which key words from the reference appear in
                your explanation. It estimates topic breadth, not depth of understanding.
                Scoring: covered = 1 pt, partial match = 0.5 pt, missing = 0 pt.
              </p>
            </div>
          </div>

          {/* Tally pills */}
          <div className={styles.tallyRow} role="list" aria-label="Concept summary">
            <span className={`${styles.tallyPill} ${styles.tallyGreen}`} role="listitem">
              ✅ {result.covered?.length ?? 0} Covered
            </span>
            <span className={`${styles.tallyPill} ${styles.tallyYellow}`} role="listitem">
              〰️ {result.partial?.length ?? 0} Partial
            </span>
            <span className={`${styles.tallyPill} ${styles.tallyRed}`} role="listitem">
              ❌ {result.missing?.length ?? 0} Missing
            </span>
          </div>

          {/* Concept sections */}
          {result.covered?.length === 0 && result.partial?.length === 0 && result.missing?.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🤔</span>
              <p>No concepts were extracted from the reference. Try a longer reference text.</p>
            </div>
          ) : (
            <>
              <ConceptSection
                title="✅ Covered"
                items={result.covered}
                tagClass={styles.conceptTagCovered}
                headingClass={styles.conceptHeadingCovered}
              />
              {result.covered?.length > 0 && (result.partial?.length > 0 || result.missing?.length > 0) && (
                <div className={styles.divider} />
              )}
              <ConceptSection
                title="〰️ Partially Covered"
                items={result.partial}
                tagClass={styles.conceptTagPartial}
                headingClass={styles.conceptHeadingPartial}
              />
              {result.partial?.length > 0 && result.missing?.length > 0 && (
                <div className={styles.divider} />
              )}
              <ConceptSection
                title="❌ Missing"
                items={result.missing}
                tagClass={styles.conceptTagMissing}
                headingClass={styles.conceptHeadingMissing}
              />
            </>
          )}

          {/* Missing concepts guidance */}
          {result.missing?.length > 0 && (
            <div className={styles.missingGuide} role="note">
              <p className={styles.missingGuideTitle}>
                💡 Tips for missing concepts
              </p>
              <p>
                Go back to your reference and find where each concept is explained.
                Try to include these in your next attempt:
              </p>
              <ul className={styles.missingList}>
                {result.missing.map((c, i) => (
                  <li key={i}>
                    <strong>{c}</strong> — mention this concept by name or use a known abbreviation.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Result actions */}
          <div className={styles.resultActions}>
            <button
              type="button"
              className={styles.btnRetry}
              onClick={() => {
                setResult(null);
                // Scroll back to explanation area
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              ✏️ Try Again
            </button>
            <button
              type="button"
              className={styles.btnReset}
              onClick={handleReset}
            >
              Start Over
            </button>
          </div>

        </div>
      )}

    </div>
  );
}
