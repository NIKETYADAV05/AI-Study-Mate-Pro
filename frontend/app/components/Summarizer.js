"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./Summarizer.module.css";

const SUBJECTS = [
  "Computer Networks",
  "Operating Systems",
  "DBMS",
  "Java",
  "Web Development",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Other",
];

const LENGTHS = [
  { value: "short",    label: "Short",    desc: "~3–5 key sentences" },
  { value: "medium",   label: "Medium",   desc: "~6–10 sentences"    },
  { value: "detailed", label: "Detailed", desc: "~11–15 sentences"   },
];

const MAX_CHARS = 20000;
const MIN_CHARS = 50;

export default function Summarizer() {
  const searchParams = useSearchParams();
  const [text, setText] = useState(() => {
    const prefill = searchParams.get("text");
    return prefill && prefill.trim() ? prefill.trim().slice(0, MAX_CHARS) : "";
  });
  const [subject,      setSubject]       = useState("Other");
  const [length,       setLength]        = useState("medium");
  const [loading,      setLoading]       = useState(false);
  const [result,       setResult]        = useState(null);
  const [error,        setError]         = useState("");
  const [copied,       setCopied]        = useState(false);
  const resultRef                        = useRef(null);

  // ── Prefill from navigation params ──────────────────────────────
  // Supports two modes:
  //   ?noteId=<id>  — fetch the note from the API (avoids HTTP 431 from long URLs)
  //   ?text=<str>   — legacy short-text fallback (handled above in useState)
  useEffect(() => {
    const noteId = searchParams.get("noteId");
    if (!noteId) return;

    let ignore = false;
    fetch(`/api/notes/${encodeURIComponent(noteId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((note) => {
        if (!ignore) {
          setText((note.content ?? "").slice(0, MAX_CHARS));
        }
      })
      .catch(() => {
        if (!ignore) {
          setError("Could not load the note. Please paste your text manually.");
        }
      });

    return () => {
      ignore = true;
    };
  }, [searchParams]);

  // ── Handlers ────────────────────────────────────────────────────

  function handleTextChange(e) {
    if (e.target.value.length <= MAX_CHARS) {
      setText(e.target.value);
      setError("");
    }
  }

  function handleClear() {
    setText("");
    setResult(null);
    setError("");
    setCopied(false);
  }

  async function handleSummarize() {
    // Client-side validation
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Please paste or type your study notes before summarizing.");
      return;
    }
    if (trimmed.length < MIN_CHARS) {
      setError(`Your notes are too short. Please enter at least ${MIN_CHARS} characters for a useful summary.`);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, subject, length }),
        signal: AbortSignal.timeout(30000), // 30-second timeout
      });

      const data = await res.json();

      // Debug: confirm important_terms is always an array
      console.log("[Summarizer] important_terms:", data.important_terms,
        "| isArray:", Array.isArray(data.important_terms),
        "| type:", typeof data.important_terms);

      if (!res.ok) {
        setError(data.error || `Server error (${res.status}). Please try again.`);
        return;
      }

      setResult(data);
      // Scroll to results
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

    } catch (err) {
      console.error("[Summarizer] fetch error:", err.name, err.message);
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        setError("The request timed out. Make sure the Django backend is running on port 8000.");
      } else if (
        err.name === "TypeError" ||
        err.message.toLowerCase().includes("fetch") ||
        err.message.toLowerCase().includes("network") ||
        err.message.toLowerCase().includes("failed")
      ) {
        setError("Cannot reach the backend. Make sure Django is running: backend\\venv\\Scripts\\python.exe backend\\manage.py runserver 127.0.0.1:8000");
      } else {
        setError(`Error: ${err.message}. Check that the Django backend is running on port 8000.`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    const fullText = buildDownloadText(result, subject, length);
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = fullText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleDownload() {
    if (!result) return;
    const content = buildDownloadText(result, subject, length);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `summary_${subject.replace(/\s+/g, "_")}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Render ───────────────────────────────────────────────────────

  const charCount   = text.length;
  const charPercent = Math.min((charCount / MAX_CHARS) * 100, 100);
  const charWarning = charCount > MAX_CHARS * 0.9;

  return (
    <div className={styles.page}>

      {/* ── Page header ──────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerIcon}>📄</div>
        <div>
          <h1 className={styles.pageTitle}>AI Notes Summarizer</h1>
          <p className={styles.pageDesc}>
            Paste your study notes below and get an instant, concise summary with key points
            and important terms — powered by extractive text analysis, entirely on your device.
          </p>
        </div>
      </div>

      {/* ── Input card ───────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Your Study Notes</h2>
          <span className={charWarning ? styles.charCountWarn : styles.charCount}>
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
          </span>
        </div>

        <textarea
          className={styles.textarea}
          placeholder="Paste your notes here… e.g. lecture notes, textbook excerpts, revision material."
          value={text}
          onChange={handleTextChange}
          rows={12}
          aria-label="Study notes input"
          spellCheck="true"
        />

        {/* Char bar */}
        <div className={styles.charBar}>
          <div
            className={styles.charBarFill}
            style={{
              width: `${charPercent}%`,
              background: charWarning ? "var(--red)" : "var(--primary)",
            }}
          />
        </div>

        {/* Options row */}
        <div className={styles.optionsRow}>
          <div className={styles.selectGroup}>
            <label className={styles.label} htmlFor="subject">Subject</label>
            <select
              id="subject"
              className={styles.select}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className={styles.selectGroup}>
            <label className={styles.label}>Summary Length</label>
            <div className={styles.lengthButtons}>
              {LENGTHS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  className={`${styles.lengthBtn} ${length === l.value ? styles.lengthBtnActive : ""}`}
                  onClick={() => setLength(l.value)}
                  title={l.desc}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Validation error */}
        {error && (
          <div className={styles.errorBox} role="alert">
            <span className={styles.errorIcon}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleSummarize}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Analyzing…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                Summarize Notes
              </>
            )}
          </button>

          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Loading indicator ─────────────────────────────── */}
      {loading && (
        <div className={styles.loadingCard} aria-live="polite">
          <div className={styles.loadingDots}>
            <span /><span /><span />
          </div>
          <p>Analyzing your notes…</p>
        </div>
      )}

      {/* ── Results card ─────────────────────────────────── */}
      {result && !loading && (
        <div className={styles.resultsCard} ref={resultRef}>
          <div className={styles.resultsHeader}>
            <div>
              <h2 className={styles.cardTitle}>Summary Results</h2>
              <p className={styles.resultsMeta}>
                {subject} · {LENGTHS.find(l => l.value === length)?.label} summary
              </p>
            </div>
            <div className={styles.resultActions}>
              <button type="button" className={styles.btnOutline} onClick={handleCopy}>
                {copied ? "✓ Copied!" : "📋 Copy Summary"}
              </button>
              <button type="button" className={styles.btnOutline} onClick={handleDownload}>
                ⬇️ Download .txt
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div className={styles.statsStrip}>
            <div className={styles.stat}>
              <span className={styles.statNum}>{result.original_chars?.toLocaleString()}</span>
              <span className={styles.statLbl}>Original chars</span>
            </div>
            <div className={styles.statDiv} />
            <div className={styles.stat}>
              <span className={styles.statNum}>{result.summary_chars?.toLocaleString()}</span>
              <span className={styles.statLbl}>Summary chars</span>
            </div>
            <div className={styles.statDiv} />
            <div className={styles.stat}>
              <span className={styles.statNum}>
                {result.original_chars && result.summary_chars
                  ? `${Math.round((1 - result.summary_chars / result.original_chars) * 100)}%`
                  : "—"}
              </span>
              <span className={styles.statLbl}>Reduction</span>
            </div>
            <div className={styles.statDiv} />
            <div className={styles.stat}>
              <span className={styles.statNum}>{result.reading_time_seconds != null
                ? result.reading_time_seconds < 60
                  ? `${result.reading_time_seconds}s`
                  : `${Math.round(result.reading_time_seconds / 60)}m`
                : "—"}
              </span>
              <span className={styles.statLbl}>Reading time</span>
            </div>
          </div>

          {/* Summary text — render as separate sentences/paragraphs */}
          <Section title="📝 Summary" accent="var(--primary)">
            {Array.isArray(result.summary_sentences) && result.summary_sentences.length > 0 ? (
              <ul className={styles.summaryList}>
                {result.summary_sentences.map((sentence, i) => (
                  <li key={i} className={styles.summaryItem}>{sentence}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.summaryText}>{result.summary}</p>
            )}
          </Section>

          {/* Key points — one bullet per point, no explicit • char in JSX */}
          {result.key_points?.length > 0 && (
            <Section title="✅ Key Points" accent="var(--green)">
              <ul className={styles.pointsList}>
                {result.key_points
                  // Strip ONLY leading whitespace and explicit bullet/marker chars.
                  // Do NOT include letter 'o' — it strips words like "Oracle", "Objects".
                  .map(pt => pt.replace(/^[\s\-•*▸►]+/, "").trim())
                  .filter(pt => pt.length > 0)
                  .map((pt, i) => (
                    <li key={i} className={styles.pointItem}>{pt}</li>
                  ))}
              </ul>
            </Section>
          )}

          {/* Important terms — each term is its own chip */}
          {result.important_terms?.length > 0 && (
            <Section title="🔑 Important Terms" accent="var(--yellow)">
              <div className={styles.termTags}>
                {(Array.isArray(result.important_terms)
                  ? result.important_terms
                  : String(result.important_terms).split(/[\s,]+/).filter(Boolean)
                ).map((term, i) => {
                  const label = Array.isArray(term)
                    ? term.join(", ")
                    : String(term ?? "").trim();
                  if (!label) return null;
                  return (
                    <span
                      key={`term-${i}-${label}`}
                      className={styles.termTag}
                      style={{ display: "inline-block", marginRight: "8px", marginBottom: "6px" }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}

    </div>
  );
}

// ── Helper sub-component ─────────────────────────────────────────
function Section({ title, accent, children }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle} style={{ color: accent }}>{title}</h3>
      {children}
    </div>
  );
}

// ── Build downloadable text ───────────────────────────────────────
function buildDownloadText(result, subject, length) {
  const lines = [
    "AI StudyMate Pro — Notes Summary",
    "=".repeat(40),
    `Subject: ${subject}`,
    `Summary Length: ${length}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "SUMMARY",
    "-".repeat(40),
    result.summary || "",
    "",
  ];

  if (result.key_points?.length > 0) {
    lines.push("KEY POINTS", "-".repeat(40));
    result.key_points.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    lines.push("");
  }

  if (result.important_terms?.length > 0) {
    lines.push("IMPORTANT TERMS", "-".repeat(40));
    lines.push(result.important_terms.join(", "));
    lines.push("");
  }

  lines.push(
    "STATS",
    "-".repeat(40),
    `Original length: ${result.original_chars} characters`,
    `Summary length:  ${result.summary_chars} characters`,
    `Reading time:    ${result.reading_time_seconds}s`,
  );

  return lines.join("\n");
}
