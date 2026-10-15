"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./Quiz.module.css";

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_CHARS = 20000;
const MIN_CHARS = 80;

const COUNTS = [5, 10, 15];
const DIFFICULTIES = [
  { value: "easy",   label: "Easy",   desc: "Mostly true statements, clear distractors" },
  { value: "medium", label: "Medium", desc: "Balanced mix of question styles"           },
  { value: "hard",   label: "Hard",   desc: "Mutated statements, similar distractors"   },
];
const TYPES = [
  { value: "mixed",     label: "Mixed",           desc: "Both MCQ and True/False" },
  { value: "mcq",       label: "Multiple Choice", desc: "Four-option questions"   },
  { value: "truefalse", label: "True / False",    desc: "Decide if the statement is correct" },
];

// ── Helper — letter labels for MCQ options ───────────────────────────────────
const OPTION_LABELS = ["A", "B", "C", "D"];

// ── Phases ───────────────────────────────────────────────────────────────────
// "input"   → user pastes notes and picks settings
// "quiz"    → user answers questions one at a time
// "results" → score and review screen

export default function Quiz() {
  const searchParams = useSearchParams();

  // ── Input state ──────────────────────────────────────────────────────────
  const [text, setText] = useState(() => {
    const prefill = searchParams.get("text");
    return prefill && prefill.trim() ? prefill.trim().slice(0, MAX_CHARS) : "";
  });
  const [count,        setCount]        = useState(5);
  const [difficulty,   setDifficulty]   = useState("medium");
  const [quizType,     setQuizType]     = useState("mixed");
  // noteSubject is set when a note is loaded via ?noteId; cleared on manual text entry
  const [noteSubject,  setNoteSubject]  = useState("Unknown");

  // ── App state ─────────────────────────────────────────────────────────────
  const [phase,     setPhase]     = useState("input"); // "input" | "quiz" | "results"
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [warnings,  setWarnings]  = useState([]);

  // ── Quiz state ────────────────────────────────────────────────────────────
  const [questions,    setQuestions]    = useState([]);   // array from API
  const [current,      setCurrent]      = useState(0);    // index of current question
  const [answers,      setAnswers]      = useState({});   // { questionIndex: optionIndex }
  const [submitted,    setSubmitted]    = useState(false);
  const [submitError,  setSubmitError]  = useState("");

  const topRef = useRef(null);

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
          // Retain the note's subject so quiz attempts are recorded accurately
          if (note.subject) setNoteSubject(note.subject);
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const charCount   = text.length;
  const charPct     = Math.min((charCount / MAX_CHARS) * 100, 100);
  const charWarn    = charCount > MAX_CHARS * 0.9;
  const totalQ      = questions.length;
  const answeredCount = Object.keys(answers).length;
  const q           = questions[current] ?? null;

  // ── Handlers — input phase ────────────────────────────────────────────────
  function handleTextChange(e) {
    if (e.target.value.length <= MAX_CHARS) {
      setText(e.target.value);
      setError("");
    }
  }

  async function handleGenerate() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Please paste your study notes before generating a quiz.");
      return;
    }
    if (trimmed.length < MIN_CHARS) {
      setError(`Notes are too short. Please enter at least ${MIN_CHARS} characters.`);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, count, difficulty, quiz_type: quizType }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Server error (${res.status}). Check that Django is running.`);
        return;
      }

      if (!data.questions || data.questions.length === 0) {
        setError(data.error || "No questions could be generated from these notes.");
        return;
      }

      setQuestions(data.questions);
      setWarnings(data.warnings ?? []);
      setAnswers({});
      setCurrent(0);
      setSubmitted(false);
      setSubmitError("");
      setPhase("quiz");
      setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        setError("Request timed out. Make sure the Django backend is running on port 8000.");
      } else {
        setError("Cannot reach the backend. Make sure Django is running: backend\\venv\\Scripts\\python manage.py runserver");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Handlers — quiz phase ─────────────────────────────────────────────────
  function handleSelectAnswer(optionIndex) {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [current]: optionIndex }));
    setSubmitError("");
  }

  function handlePrev() {
    if (current > 0) setCurrent(c => c - 1);
  }

  function handleNext() {
    if (current < totalQ - 1) setCurrent(c => c + 1);
  }

  function handleSubmit() {
    if (answeredCount < totalQ) {
      const unanswered = totalQ - answeredCount;
      setSubmitError(
        `You have ${unanswered} unanswered question${unanswered > 1 ? "s" : ""}. ` +
        "You can still submit, but unanswered questions will be marked incorrect."
      );
      return;
    }
    finishQuiz();
  }

  function handleSubmitAnyway() {
    finishQuiz();
  }

  function finishQuiz() {
    // Calculate score before state update
    let correct = 0;
    questions.forEach((q, i) => {
      if (answers[i] === q.correct_index) correct++;
    });

    setSubmitted(true);
    setSubmitError("");
    setPhase("results");
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

    // Persist the attempt — fire-and-forget (UI is never blocked by this)
    fetch("/api/quiz-attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score:           correct,
        total_questions: questions.length,
        difficulty,
        quiz_type:       quizType,
        // Use the note's subject when loaded via ?noteId; "Unknown" for pasted text.
        // The backend validates this against _VALID_ATTEMPT_SUBJECTS and falls back
        // to "Unknown" for any unrecognised value, so arbitrary input is safe.
        subject: noteSubject,
      }),
    }).catch(() => {
      // Silently ignore network failures — the quiz result is still shown
    });
  }

  // ── Handlers — results phase ──────────────────────────────────────────────
  function handleRetry() {
    setAnswers({});
    setCurrent(0);
    setSubmitted(false);
    setSubmitError("");
    setPhase("quiz");
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }

  function handleNewQuiz() {
    setQuestions([]);
    setAnswers({});
    setCurrent(0);
    setSubmitted(false);
    setSubmitError("");
    setWarnings([]);
    setError("");
    setNoteSubject("Unknown");
    setPhase("input");
  }

  // ── Score calculation ─────────────────────────────────────────────────────
  function calcScore() {
    let correct = 0;
    questions.forEach((q, i) => {
      if (answers[i] === q.correct_index) correct++;
    });
    return correct;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} ref={topRef}>

      {/* ── Page header ─────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerIcon}>🧠</div>
        <div>
          <h1 className={styles.pageTitle}>Quiz Generator</h1>
          <p className={styles.pageDesc}>
            Paste your study notes and get an instant quiz — multiple choice and
            true/false questions generated directly from your material, no AI API required.
          </p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          INPUT PHASE
      ══════════════════════════════════════════════════════ */}
      {phase === "input" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Your Study Notes</h2>
            <span className={charWarn ? styles.charCountWarn : styles.charCount}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
            </span>
          </div>

          <textarea
            className={styles.textarea}
            placeholder="Paste your notes here — lecture notes, textbook excerpts, or revision material. The more detailed, the better the quiz."
            value={text}
            onChange={handleTextChange}
            rows={11}
            aria-label="Study notes input"
            spellCheck="true"
          />

          {/* char bar */}
          <div className={styles.charBar}>
            <div
              className={styles.charBarFill}
              style={{ width: `${charPct}%`, background: charWarn ? "var(--red)" : "var(--primary)" }}
            />
          </div>

          {/* settings row */}
          <div className={styles.settingsGrid}>

            {/* Number of questions */}
            <div className={styles.settingGroup}>
              <label className={styles.settingLabel}>Number of questions</label>
              <div className={styles.toggleRow}>
                {COUNTS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`${styles.toggleBtn} ${count === n ? styles.toggleActive : ""}`}
                    onClick={() => setCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty */}
            <div className={styles.settingGroup}>
              <label className={styles.settingLabel}>Difficulty</label>
              <div className={styles.toggleRow}>
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    type="button"
                    title={d.desc}
                    className={`${styles.toggleBtn} ${difficulty === d.value ? styles.toggleActive : ""}`}
                    onClick={() => setDifficulty(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Question type */}
            <div className={styles.settingGroup}>
              <label className={styles.settingLabel}>Question type</label>
              <div className={styles.toggleRow}>
                {TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    title={t.desc}
                    className={`${styles.toggleBtn} ${quizType === t.value ? styles.toggleActive : ""}`}
                    onClick={() => setQuizType(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* error */}
          {error && (
            <div className={styles.errorBox} role="alert">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* generate button */}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <><span className={styles.spinner} aria-hidden="true" /> Generating quiz…</>
              ) : (
                <><span aria-hidden="true">⚡</span> Generate Quiz</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* loading card */}
      {loading && (
        <div className={styles.loadingCard} aria-live="polite">
          <div className={styles.loadingDots}><span /><span /><span /></div>
          <p>Analysing notes and building questions…</p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          QUIZ PHASE
      ══════════════════════════════════════════════════════ */}
      {phase === "quiz" && q && (
        <>
          {/* warnings from backend */}
          {warnings.length > 0 && (
            <div className={styles.warningBox} role="status">
              <span>ℹ️</span>
              <span>{warnings[0]}</span>
            </div>
          )}

          {/* progress bar */}
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${((current + 1) / totalQ) * 100}%` }}
            />
          </div>

          {/* question card */}
          <div className={styles.questionCard}>

            {/* meta row */}
            <div className={styles.questionMeta}>
              <span className={styles.questionNum}>
                Question {current + 1} of {totalQ}
              </span>
              <span className={`${styles.typeBadge} ${q.type === "mcq" ? styles.badgeMcq : styles.badgeTf}`}>
                {q.type === "mcq" ? "Multiple Choice" : "True / False"}
              </span>
            </div>

            {/* question text */}
            <p className={styles.questionText}>{q.question}</p>

            {/* options */}
            <div className={styles.optionsList}>
              {q.options.map((opt, i) => {
                const selected = answers[current] === i;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.optionBtn} ${selected ? styles.optionSelected : ""}`}
                    onClick={() => handleSelectAnswer(i)}
                    aria-pressed={selected}
                  >
                    {q.type === "mcq" && (
                      <span className={`${styles.optionLabel} ${selected ? styles.optionLabelSelected : ""}`}>
                        {OPTION_LABELS[i]}
                      </span>
                    )}
                    <span className={styles.optionText}>{opt}</span>
                  </button>
                );
              })}
            </div>

            {/* navigation */}
            <div className={styles.navRow}>
              <button
                type="button"
                className={styles.btnOutline}
                onClick={handlePrev}
                disabled={current === 0}
              >
                ← Previous
              </button>

              <span className={styles.answeredPill}>
                {answeredCount} / {totalQ} answered
              </span>

              {current < totalQ - 1 ? (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={handleNext}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.btnSuccess}
                  onClick={handleSubmit}
                >
                  Submit Quiz ✓
                </button>
              )}
            </div>

            {/* unanswered warning */}
            {submitError && (
              <div className={styles.submitWarnBox} role="alert">
                <p>{submitError}</p>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={handleSubmitAnyway}
                >
                  Submit anyway
                </button>
              </div>
            )}
          </div>

          {/* question dots navigator */}
          <div className={styles.dotNav} aria-label="Question navigator">
            {questions.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to question ${i + 1}`}
                className={`${styles.dot}
                  ${i === current        ? styles.dotCurrent  : ""}
                  ${answers[i] !== undefined ? styles.dotAnswered : ""}
                `}
                onClick={() => setCurrent(i)}
              />
            ))}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════
          RESULTS PHASE
      ══════════════════════════════════════════════════════ */}
      {phase === "results" && (
        <>
          <ScoreCard
            score={calcScore()}
            total={totalQ}
            difficulty={difficulty}
            quizType={quizType}
            onRetry={handleRetry}
            onNewQuiz={handleNewQuiz}
          />

          <div className={styles.reviewSection}>
            <h2 className={styles.reviewTitle}>Answer Review</h2>
            {questions.map((q, i) => {
              const userIdx    = answers[i];
              const isCorrect  = userIdx === q.correct_index;
              const unanswered = userIdx === undefined;
              return (
                <div
                  key={i}
                  className={`${styles.reviewCard}
                    ${isCorrect  ? styles.reviewCorrect  : ""}
                    ${!isCorrect && !unanswered ? styles.reviewWrong : ""}
                    ${unanswered ? styles.reviewSkipped  : ""}
                  `}
                >
                  {/* header */}
                  <div className={styles.reviewHeader}>
                    <span className={styles.reviewNum}>Q{i + 1}</span>
                    <span className={`${styles.reviewTypeBadge} ${q.type === "mcq" ? styles.badgeMcq : styles.badgeTf}`}>
                      {q.type === "mcq" ? "MCQ" : "T/F"}
                    </span>
                    <span className={styles.reviewVerdict}>
                      {unanswered ? "⚪ Skipped" : isCorrect ? "✅ Correct" : "❌ Incorrect"}
                    </span>
                  </div>

                  {/* question */}
                  <p className={styles.reviewQuestion}>{q.question}</p>

                  {/* options with colouring */}
                  <div className={styles.reviewOptions}>
                    {q.options.map((opt, oi) => {
                      const isRight  = oi === q.correct_index;
                      const isPicked = oi === userIdx;
                      return (
                        <div
                          key={oi}
                          className={`${styles.reviewOption}
                            ${isRight               ? styles.reviewOptionCorrect : ""}
                            ${isPicked && !isRight  ? styles.reviewOptionWrong   : ""}
                          `}
                        >
                          {q.type === "mcq" && (
                            <span className={styles.reviewOptLabel}>{OPTION_LABELS[oi]}</span>
                          )}
                          <span>{opt}</span>
                          {isRight  && <span className={styles.reviewMark}>✓ correct</span>}
                          {isPicked && !isRight && <span className={styles.reviewMark}>✗ your answer</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* explanation */}
                  <div className={styles.reviewExplanation}>
                    <span className={styles.reviewExpIcon}>💡</span>
                    <p>{q.explanation}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* bottom actions */}
          <div className={styles.resultActions}>
            <button type="button" className={styles.btnPrimary} onClick={handleRetry}>
              🔄 Retry Quiz
            </button>
            <button type="button" className={styles.btnOutline} onClick={handleNewQuiz}>
              📝 New Quiz
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Score card sub-component ──────────────────────────────────────────────────
function ScoreCard({ score, total, difficulty, quizType, onRetry, onNewQuiz }) {
  const pct     = total > 0 ? Math.round((score / total) * 100) : 0;
  const passing = pct >= 60;

  const grade =
    pct >= 90 ? { label: "Excellent!", color: "var(--green)"   } :
    pct >= 75 ? { label: "Good work!", color: "var(--primary)" } :
    pct >= 60 ? { label: "Passed",     color: "var(--yellow)"  } :
                { label: "Keep going", color: "var(--red)"     };

  return (
    <div className={styles.scoreCard}>
      <div className={styles.scoreCircleWrap}>
        <svg className={styles.scoreCircle} viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="50" fill="none"
            stroke={grade.color}
            strokeWidth="10"
            strokeDasharray={`${2 * Math.PI * 50}`}
            strokeDashoffset={`${2 * Math.PI * 50 * (1 - pct / 100)}`}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div className={styles.scoreInner}>
          <span className={styles.scorePct}>{pct}%</span>
          <span className={styles.scoreLabel}>{grade.label}</span>
        </div>
      </div>

      <div className={styles.scoreDetails}>
        <h2 className={styles.scoreTitle}>Quiz Complete!</h2>
        <p className={styles.scoreSubtitle}>
          You answered <strong>{score} of {total}</strong> questions correctly.
        </p>
        <div className={styles.scoreMeta}>
          <span>Difficulty: <strong style={{ textTransform: "capitalize" }}>{difficulty}</strong></span>
          <span>Type: <strong>{quizType === "mixed" ? "Mixed" : quizType === "mcq" ? "Multiple Choice" : "True / False"}</strong></span>
        </div>

        {/* mini progress bar */}
        <div className={styles.scoreBar}>
          <div className={styles.scoreBarFill} style={{ width: `${pct}%`, background: grade.color }} />
        </div>
        <div className={styles.scoreBarLabels}>
          <span>0%</span><span>60% pass</span><span>100%</span>
        </div>

        <div className={styles.scoreActions}>
          <button type="button" className={styles.btnPrimary} onClick={onRetry}>
            🔄 Retry this Quiz
          </button>
          <button type="button" className={styles.btnOutline} onClick={onNewQuiz}>
            📝 New Quiz
          </button>
        </div>
      </div>
    </div>
  );
}
