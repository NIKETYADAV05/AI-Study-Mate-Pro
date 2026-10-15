"use client";

/**
 * BossBattle.js — Exam Boss Battles feature
 *
 * Self-contained component. Reuses:
 *   - POST /api/quiz  (same endpoint + same params as Quiz.js)
 *   - POST /api/quiz-attempts  (same fire-and-forget recording as Quiz.js)
 *
 * Does NOT modify Quiz.js, backend, or any existing component.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./BossBattle.module.css";

// ─── Constants (mirror Quiz.js exactly so the same API is hit) ─────────────
const MAX_CHARS = 20000;
const MIN_CHARS = 80;
const COUNTS      = [5, 10, 15];
const DIFFICULTIES = ["easy", "medium", "hard"];
const TYPES        = [
  { value: "mixed",     label: "Mixed"      },
  { value: "mcq",       label: "Multiple Choice" },
  { value: "truefalse", label: "True / False"    },
];
const OPTION_LABELS = ["A", "B", "C", "D"];

// ─── Boss definitions ────────────────────────────────────────────────────────
// Each "boss" is a CSS-drawn confusion monster with a flavour name and colour.
const BOSSES = [
  { id: "grumble",  name: "Grumble the Confuser",   emoji: "👾", accent: "#6d28d9", aura: "#ede9fe" },
  { id: "gloom",    name: "Gloom the Forgetter",    emoji: "💀", accent: "#dc2626", aura: "#fee2e2" },
  { id: "tangle",   name: "Tangle the Trickster",   emoji: "🕷️", accent: "#0891b2", aura: "#cffafe" },
  { id: "scorch",   name: "Scorch the Time Eater",  emoji: "🔥", accent: "#d97706", aura: "#fef3c7" },
];

// ─── Nova messages ────────────────────────────────────────────────────────────
const NOVA_CORRECT   = ["Nice hit! 🎯","You got it! ⚡","Brilliant! ✨","That's the one! 🌟","Perfect! 🔥"];
const NOVA_WRONG     = ["Don't give up! 💪","Keep fighting! 🛡️","You'll get the next one 🌈","Study that one again! 📚","Almost! Stay focused 🎯"];
const NOVA_INTRO     = "I'm Nova — your study companion. Defeat the boss by answering correctly! ✨";
const NOVA_WIN       = "You crushed it! The boss is defeated! 🎉 Keep studying and you'll be unstoppable!";
const NOVA_LOSE_50   = "So close! Review the explanations and try again — you've got this! 💪";
const NOVA_LOSE_0    = "Every expert was once a beginner. Let's review and come back stronger! 📚";

function pickNova(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Health helpers ──────────────────────────────────────────────────────────
// Boss starts at full HP (= total questions). Each correct answer deals 1 HP.
// Player starts at full HP (= total questions). Each wrong answer deals 1 HP.
function calcHP(total, correct, wrong) {
  return {
    bossHP:   Math.max(0, total - correct),
    playerHP: Math.max(0, total - wrong),
    maxHP:    total,
  };
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function BossBattle() {
  // phases: "setup" | "battle" | "result"
  const [phase,       setPhase]      = useState("setup");
  const [text,        setText]       = useState("");
  const [count,       setCount]      = useState(5);
  const [difficulty,  setDifficulty] = useState("medium");
  const [quizType,    setQuizType]   = useState("mixed");
  const [loading,     setLoading]    = useState(false);
  const [error,       setError]      = useState("");

  // battle state
  const [questions,   setQuestions]  = useState([]);
  const [current,     setCurrent]    = useState(0);
  const [answers,     setAnswers]    = useState({});   // { qIdx: optionIdx }
  const [revealed,    setRevealed]   = useState(false); // whether current Q is revealed after pick
  const [novaMsg,     setNovaMsg]    = useState(NOVA_INTRO);
  const [boss,        setBoss]       = useState(BOSSES[0]);
  const [flashCorrect, setFlashCorrect] = useState(false);
  const [flashWrong,   setFlashWrong]   = useState(false);
  const [bossHit,      setBossHit]      = useState(false);
  const [playerHit,    setPlayerHit]    = useState(false);

  const topRef = useRef(null);

  const charCount = text.length;
  const charPct   = Math.min((charCount / MAX_CHARS) * 100, 100);
  const charWarn  = charCount > MAX_CHARS * 0.9;

  // Derived battle values
  const totalQ      = questions.length;
  const q           = questions[current] ?? null;
  // Only count questions the player has already submitted an answer for.
  // Excluding the current question (which has no answer yet) prevents boss HP
  // from dropping before the player actually answers.
  const correctSoFar = Object.keys(answers).filter(
    i => answers[i] === questions[parseInt(i)]?.correct_index
  ).length;
  const wrongSoFar   = Object.keys(answers).filter(
    i => answers[i] !== questions[parseInt(i)]?.correct_index
  ).length;
  const { bossHP, playerHP, maxHP } = calcHP(totalQ, correctSoFar, wrongSoFar);
  const bossPct   = maxHP > 0 ? Math.round((bossHP   / maxHP) * 100) : 100;
  const playerPct = maxHP > 0 ? Math.round((playerHP / maxHP) * 100) : 100;


  // ── Scroll to top when phase changes ─────────────────────────────────────
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase]);

  // ── API call — identical params to Quiz.js ────────────────────────────────
  async function handleStartBattle() {
    const trimmed = text.trim();
    if (!trimmed)             { setError("Paste your study notes to summon the boss!"); return; }
    if (trimmed.length < MIN_CHARS) { setError(`Notes too short — need at least ${MIN_CHARS} characters.`); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/quiz", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: trimmed, count, difficulty, quiz_type: quizType }),
        signal:  AbortSignal.timeout(30000),
      });
      const data = await res.json();

      if (!res.ok || !data.questions?.length) {
        setError(data.error || "Could not generate questions from these notes. Try more detailed text.");
        return;
      }

      // Pick a fresh random boss for each battle
      setBoss(BOSSES[Math.floor(Math.random() * BOSSES.length)]);
      setQuestions(data.questions);
      setAnswers({});
      setCurrent(0);
      setRevealed(false);
      setNovaMsg(NOVA_INTRO);
      setFlashCorrect(false);
      setFlashWrong(false);
      setBossHit(false);
      setPlayerHit(false);
      setPhase("battle");

    } catch (err) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      setError(isTimeout
        ? "Request timed out. Make sure Django is running on port 8000."
        : "Cannot reach the backend. Make sure Django is running.");
    } finally {
      setLoading(false);
    }
  }

  // ── Answer selection ──────────────────────────────────────────────────────
  function handleAnswer(optIdx) {
    if (revealed) return; // already answered this question
    const isCorrect = optIdx === q.correct_index;

    setAnswers(prev => ({ ...prev, [current]: optIdx }));
    setRevealed(true);

    if (isCorrect) {
      setFlashCorrect(true);
      setBossHit(true);
      setNovaMsg(pickNova(NOVA_CORRECT));
      setTimeout(() => { setFlashCorrect(false); setBossHit(false); }, 700);
    } else {
      setFlashWrong(true);
      setPlayerHit(true);
      setNovaMsg(pickNova(NOVA_WRONG));
      setTimeout(() => { setFlashWrong(false); setPlayerHit(false); }, 700);
    }
  }

  // ── Advance to next question ──────────────────────────────────────────────
  function handleNext() {
    if (current + 1 >= totalQ) {
      // Battle over — record attempt and show result
      const finalCorrect = Object.keys({ ...answers }).filter(
        i => answers[i] === questions[i]?.correct_index
      ).length;

      // Fire-and-forget — same as Quiz.js
      fetch("/api/quiz-attempts", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          score:           finalCorrect,
          total_questions: totalQ,
          difficulty,
          quiz_type:       quizType,
          // Boss Battles always use pasted text, so no note subject is available.
          subject: "Unknown",
        }),
      }).catch(() => {});

      setPhase("result");
    } else {
      setCurrent(c => c + 1);
      setRevealed(false);
    }
  }

  // ── Restart same settings ─────────────────────────────────────────────────
  function handleRetry() {
    setAnswers({});
    setCurrent(0);
    setRevealed(false);
    setNovaMsg(NOVA_INTRO);
    setBoss(BOSSES[Math.floor(Math.random() * BOSSES.length)]);
    setPhase("battle");
  }

  // ── New battle (back to setup) ────────────────────────────────────────────
  function handleNewBattle() {
    setQuestions([]);
    setAnswers({});
    setCurrent(0);
    setRevealed(false);
    setError("");
    setPhase("setup");
  }

  // ── Final score for result screen ─────────────────────────────────────────
  const finalCorrect = Object.keys(answers).filter(
    i => answers[i] === questions[parseInt(i)]?.correct_index
  ).length;
  const finalPct = totalQ > 0 ? Math.round((finalCorrect / totalQ) * 100) : 0;
  const won      = finalPct >= 60;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} ref={topRef}>

      {/* ══ SETUP PHASE ══════════════════════════════════════════════════════ */}
      {phase === "setup" && (
        <>
          {/* Hero header */}
          <div className={styles.hero}>
            <div className={styles.heroBg} aria-hidden="true" />
            <div className={styles.heroContent}>
              <p className={styles.heroEyebrow}>⚔️ Exam Boss Battles</p>
              <h1 className={styles.heroTitle}>Defeat the Confusion Monster</h1>
              <p className={styles.heroDesc}>
                Paste your study notes. Nova and you will face a boss together — answer
                correctly to drain its health and prove your mastery!
              </p>
            </div>
            {/* Nova companion */}
            <div className={styles.novaSetup} aria-label="Nova companion">
              <NovaFigure />
              <div className={styles.novaBubble}>{NOVA_INTRO}</div>
            </div>
          </div>

          {/* Setup card */}
          <div className={styles.setupCard}>
            <h2 className={styles.setupTitle}>
              <span className={styles.setupTitleIcon}>📜</span>
              Paste Your Study Notes
            </h2>

            <textarea
              className={`${styles.textarea} ${charWarn ? styles.textareaWarn : ""}`}
              placeholder="Paste lecture notes, textbook excerpts, or revision material here. The boss draws its power from your notes!"
              value={text}
              onChange={e => { if (e.target.value.length <= MAX_CHARS) { setText(e.target.value); setError(""); } }}
              rows={10}
              aria-label="Study notes"
              spellCheck="true"
            />

            <div className={styles.charBar}>
              <div
                className={styles.charBarFill}
                style={{ width: `${charPct}%`, background: charWarn ? "var(--red)" : "var(--primary)" }}
              />
            </div>

            <p className={styles.charHint}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
              {charWarn && <span className={styles.charWarnText}> — approaching limit</span>}
            </p>

            {/* Settings */}
            <div className={styles.settingsRow}>
              <div className={styles.settingGroup}>
                <span className={styles.settingLabel}>Questions</span>
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

              <div className={styles.settingGroup}>
                <span className={styles.settingLabel}>Difficulty</span>
                <div className={styles.toggleRow}>
                  {DIFFICULTIES.map(d => (
                    <button
                      key={d}
                      type="button"
                      className={`${styles.toggleBtn} ${difficulty === d ? styles.toggleActive : ""}`}
                      onClick={() => setDifficulty(d)}
                    >
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingGroup}>
                <span className={styles.settingLabel}>Type</span>
                <div className={styles.toggleRow}>
                  {TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      className={`${styles.toggleBtn} ${quizType === t.value ? styles.toggleActive : ""}`}
                      onClick={() => setQuizType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className={styles.errorBox} role="alert">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              className={styles.btnBattle}
              onClick={handleStartBattle}
              disabled={loading}
            >
              {loading ? (
                <><span className={styles.spinner} aria-hidden="true" /> Summoning Boss…</>
              ) : (
                <>⚔️ Begin Battle!</>
              )}
            </button>
          </div>
        </>
      )}

      {/* loading overlay — only shown during setup phase while the API call is in flight */}
      {loading && phase === "setup" && (
        <div className={styles.loadingCard} aria-live="polite">
          <div className={styles.loadingDots}><span /><span /><span /></div>
          <p>Summoning your boss…</p>
        </div>
      )}

      {/* ══ BATTLE PHASE ═════════════════════════════════════════════════════ */}
      {phase === "battle" && q && (
        <div className={styles.battlePage}>

          {/* ── Arena ──────────────────────────────────────────────────────── */}
          <div className={styles.arena} style={{ "--boss-aura": boss.aura }}>

            {/* Player (Nova) side */}
            <div className={styles.playerSide}>
              <div className={styles.combatantLabel}>You + Nova</div>
              <div className={`${styles.novaFigureWrap} ${playerHit ? styles.shakeAnim : ""}`}>
                <NovaFigure size="lg" />
              </div>
              <HealthBar pct={playerPct} color="var(--green)" label={`HP ${playerHP}/${maxHP}`} />
            </div>

            {/* VS divider */}
            <div className={styles.vsLabel}>VS</div>

            {/* Boss side */}
            <div className={styles.bossSide}>
              <div className={styles.combatantLabel}>{boss.name}</div>
              <div className={`${styles.bossFigureWrap} ${bossHit ? styles.bossHitAnim : ""}`}
                   style={{ "--boss-accent": boss.accent }}>
                <BossFigure emoji={boss.emoji} accent={boss.accent} />
              </div>
              <HealthBar pct={bossPct} color={boss.accent} label={`HP ${bossHP}/${maxHP}`} />
            </div>
          </div>

          {/* Flash feedback overlay */}
          {flashCorrect && <div className={styles.flashCorrect} aria-hidden="true">✅ Correct!</div>}
          {flashWrong   && <div className={styles.flashWrong}   aria-hidden="true">❌ Wrong!</div>}

          {/* Nova message bubble */}
          <div className={styles.novaBar}>
            <span className={styles.novaMini} aria-hidden="true">✨</span>
            <span className={styles.novaMiniMsg}>{novaMsg}</span>
          </div>

          {/* Progress pill */}
          <div className={styles.progressRow}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${((current + 1) / totalQ) * 100}%` }}
              />
            </div>
            <span className={styles.progressPill}>
              {current + 1} / {totalQ}
            </span>
          </div>

          {/* ── Question card ─────────────────────────────────────────────── */}
          <div className={`${styles.questionCard} ${flashCorrect ? styles.questionFlashCorrect : ""} ${flashWrong ? styles.questionFlashWrong : ""}`}>
            <div className={styles.questionMeta}>
              <span className={styles.qNum}>Q{current + 1}</span>
              <span className={`${styles.qBadge} ${q.type === "mcq" ? styles.badgeMcq : styles.badgeTf}`}>
                {q.type === "mcq" ? "Multiple Choice" : "True / False"}
              </span>
              <span className={`${styles.diffBadge} ${styles["diff_" + difficulty]}`}>
                {difficulty}
              </span>
            </div>

            <p className={styles.questionText}>{q.question}</p>

            {/* Options */}
            <div className={styles.optionsList}>
              {q.options.map((opt, i) => {
                const picked   = answers[current] === i;
                const isRight  = i === q.correct_index;
                // After reveal: show correct green, wrong red
                const revealClass = revealed
                  ? isRight  ? styles.optionCorrect
                  : picked   ? styles.optionWrong
                  : ""
                  : picked ? styles.optionSelected : "";

                return (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.optionBtn} ${revealClass}`}
                    onClick={() => handleAnswer(i)}
                    disabled={revealed}
                    aria-pressed={picked}
                  >
                    {q.type === "mcq" && (
                      <span className={`${styles.optionLabel}
                        ${revealed && isRight  ? styles.optionLabelCorrect : ""}
                        ${revealed && picked && !isRight ? styles.optionLabelWrong : ""}
                        ${!revealed && picked  ? styles.optionLabelSelected : ""}
                      `}>
                        {OPTION_LABELS[i]}
                      </span>
                    )}
                    <span className={styles.optionText}>{opt}</span>
                    {revealed && isRight  && <span className={styles.optionMark}>✓</span>}
                    {revealed && picked && !isRight && <span className={styles.optionMark}>✗</span>}
                  </button>
                );
              })}
            </div>

            {/* Explanation (shown after answer) */}
            {revealed && (
              <div className={styles.explanation}>
                <span>💡</span>
                <p>{q.explanation}</p>
              </div>
            )}

            {/* Next / Finish */}
            {revealed && (
              <div className={styles.nextRow}>
                <button
                  type="button"
                  className={current + 1 < totalQ ? styles.btnNext : styles.btnFinish}
                  onClick={handleNext}
                >
                  {current + 1 < totalQ ? "Next Question →" : "Finish Battle ⚔️"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ RESULT PHASE ══════════════════════════════════════════════════════ */}
      {phase === "result" && (
        <div className={styles.resultPage}>

          {/* Victory / defeat banner */}
          <div className={`${styles.resultBanner} ${won ? styles.bannerWin : styles.bannerLose}`}>
            <div className={styles.resultBannerBg} aria-hidden="true" />
            <div className={styles.resultBannerContent}>
              <p className={styles.resultOutcomeLabel}>{won ? "🏆 Victory!" : "💀 Defeated!"}</p>
              <h2 className={styles.resultTitle}>
                {won ? `${boss.name} has been defeated!` : `${boss.name} wins this round…`}
              </h2>
              <p className={styles.resultScore}>{finalCorrect} / {totalQ} correct — {finalPct}%</p>
            </div>
            <div className={styles.resultFigures}>
              <div className={`${styles.resultBoss} ${won ? styles.resultBossDefeated : ""}`}>
                <BossFigure emoji={boss.emoji} accent={boss.accent} />
              </div>
              <div className={styles.resultNova}>
                <NovaFigure size="lg" />
              </div>
            </div>
          </div>

          {/* Nova message */}
          <div className={styles.novaBar}>
            <span className={styles.novaMini} aria-hidden="true">✨</span>
            <span className={styles.novaMiniMsg}>
              {won ? NOVA_WIN : finalPct >= 50 ? NOVA_LOSE_50 : NOVA_LOSE_0}
            </span>
          </div>

          {/* Review of all questions */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewHeading}>Answer Review</h3>
            {questions.map((qr, i) => {
              const picked      = answers[i];
              const isCorrect   = picked === qr.correct_index;
              const isSkipped   = picked === undefined;
              return (
                <div key={i} className={`${styles.reviewCard}
                  ${isCorrect ? styles.reviewCorrect : isSkipped ? styles.reviewSkipped : styles.reviewWrong}`}>
                  <div className={styles.reviewMeta}>
                    <span className={styles.reviewNum}>Q{i + 1}</span>
                    <span className={`${styles.reviewBadge} ${qr.type === "mcq" ? styles.badgeMcq : styles.badgeTf}`}>
                      {qr.type === "mcq" ? "MCQ" : "T/F"}
                    </span>
                    <span className={styles.reviewVerdict}>
                      {isSkipped ? "⚪ Skipped" : isCorrect ? "✅ Correct" : "❌ Wrong"}
                    </span>
                  </div>
                  <p className={styles.reviewQuestion}>{qr.question}</p>
                  <div className={styles.reviewOptions}>
                    {qr.options.map((opt, oi) => {
                      const isRight = oi === qr.correct_index;
                      const wasPicked = oi === picked;
                      return (
                        <div key={oi} className={`${styles.reviewOption}
                          ${isRight ? styles.reviewOptionCorrect : ""}
                          ${wasPicked && !isRight ? styles.reviewOptionWrong : ""}
                        `}>
                          {qr.type === "mcq" && <span className={styles.reviewOptLabel}>{OPTION_LABELS[oi]}</span>}
                          <span>{opt}</span>
                          {isRight && <span className={styles.reviewMark}>✓ correct</span>}
                          {wasPicked && !isRight && <span className={styles.reviewMark}>✗ your answer</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className={styles.explanation}>
                    <span>💡</span>
                    <p>{qr.explanation}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className={styles.resultActions}>
            <button type="button" className={styles.btnBattle} onClick={handleRetry}>
              ⚔️ Battle Again (same notes)
            </button>
            <button type="button" className={styles.btnOutline} onClick={handleNewBattle}>
              📜 New Battle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Health Bar sub-component ─────────────────────────────────────────────────
function HealthBar({ pct, color, label }) {
  const safePct = Math.max(0, Math.min(100, pct));
  return (
    <div className={styles.hpWrap}>
      <div className={styles.hpTrack}>
        <div
          className={styles.hpFill}
          style={{
            width:      `${safePct}%`,
            background: color,
            transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </div>
      <span className={styles.hpLabel}>{label}</span>
    </div>
  );
}

// ─── Nova figure — CSS art study companion ────────────────────────────────────
function NovaFigure({ size = "md" }) {
  return (
    <div className={`${styles.nova} ${size === "lg" ? styles.novaLg : ""}`} aria-label="Nova companion">
      {/* body */}
      <div className={styles.novaBody}>
        {/* face */}
        <div className={styles.novaFace}>
          <div className={styles.novaEyes}>
            <div className={styles.novaEye} />
            <div className={styles.novaEye} />
          </div>
          <div className={styles.novaMouth} />
        </div>
        {/* sparkle antenna */}
        <div className={styles.novaAntenna}>
          <div className={styles.novaStar}>✨</div>
        </div>
      </div>
      {/* cape */}
      <div className={styles.novaCape} />
    </div>
  );
}

// ─── Boss figure — CSS art confusion monster ──────────────────────────────────
function BossFigure({ emoji, accent }) {
  return (
    <div className={styles.boss} style={{ "--boss-accent": accent }} aria-label="Boss monster">
      {/* aura glow rings */}
      <div className={styles.bossAura} />
      {/* body */}
      <div className={styles.bossBody}>
        {/* eyes */}
        <div className={styles.bossEyes}>
          <div className={styles.bossEye} />
          <div className={styles.bossEye} />
        </div>
        {/* emoji core */}
        <div className={styles.bossEmoji}>{emoji}</div>
        {/* tentacles */}
        <div className={styles.bossTentacles}>
          <div className={styles.bossTentacle} />
          <div className={styles.bossTentacle} />
          <div className={styles.bossTentacle} />
          <div className={styles.bossTentacle} />
        </div>
      </div>
    </div>
  );
}
