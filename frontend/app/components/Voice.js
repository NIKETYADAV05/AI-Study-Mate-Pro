"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./Voice.module.css";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

const subscribeNoop = () => () => {};
const checkSpeechSupport = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

export default function Voice() {
  const searchParams = useSearchParams();

  // ── Text State ────────────────────────────────────────────────────────────
  const [text, setText] = useState(() => {
    const prefill = searchParams.get("text");
    return prefill && prefill.trim() ? prefill.trim() : "";
  });

  // ── Notes Dropdown State ──────────────────────────────────────────────────
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);

  // ── Web Speech API State ──────────────────────────────────────────────────
  const supported = useSyncExternalStore(
    subscribeNoop,
    checkSpeechSupport,
    () => true
  );
  const [voices, setVoices] = useState([]);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);
  const [rate, setRate] = useState(1.0);
  const [status, setStatus] = useState("idle"); // "idle" | "playing" | "paused"
  const [error, setError] = useState("");

  const utteranceRef = useRef(null);

  // ── Voice Discovery & Event Listeners ─────────────────────────────────────
  useEffect(() => {
    if (!supported) return;

    const updateVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available && available.length > 0) {
        setVoices(available);
        // Default to first English or first available voice
        const defaultIdx = available.findIndex((v) =>
          v.lang.startsWith("en") || v.default
        );
        if (defaultIdx !== -1) {
          setSelectedVoiceIndex(defaultIdx);
        }
      }
    };

    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);

    // Cancel speech on unmount or tab close
    const handleUnload = () => {
      window.speechSynthesis.cancel();
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      window.removeEventListener("beforeunload", handleUnload);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  // ── Load Saved Notes List on Mount ────────────────────────────────────────
  useEffect(() => {
    let ignore = false;
    fetch("/api/notes")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!ignore) {
          const list = Array.isArray(data) ? data : data.notes ?? [];
          setNotes(list);
        }
      })
      .catch(() => {
        // Non-fatal: user can still paste text
      })
      .finally(() => {
        if (!ignore) setNotesLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  // ── Prefill Note from ?noteId= URL Param ──────────────────────────────────
  useEffect(() => {
    const noteId = searchParams.get("noteId");
    if (!noteId) return;

    let ignore = false;
    fetch(`/api/notes/${encodeURIComponent(noteId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((note) => {
        if (!ignore) {
          setText(note.content ?? "");
          setSelectedNoteId(String(note.id));
        }
      })
      .catch(() => {
        if (!ignore) {
          setError("Could not load the requested note. Please select or paste text manually.");
        }
      });

    return () => {
      ignore = true;
    };
  }, [searchParams]);

  // ── Note Selection Handler ────────────────────────────────────────────────
  const handleSelectNote = useCallback((noteId) => {
    setSelectedNoteId(noteId);
    setError("");

    if (!noteId) return;

    setNoteLoading(true);
    fetch(`/api/notes/${encodeURIComponent(noteId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((note) => {
        setText(note.content ?? "");
      })
      .catch(() => {
        setError("Could not load the note content.");
      })
      .finally(() => {
        setNoteLoading(false);
      });
  }, []);

  // ── Play / Speak ──────────────────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (!supported) return;

    const trimmed = text.trim();
    if (!trimmed) {
      setError("Please paste some study notes or select a saved note first.");
      return;
    }

    setError("");

    // If currently paused, resume instead of restarting
    if (status === "paused" && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setStatus("playing");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    try {
      const utterance = new window.SpeechSynthesisUtterance(trimmed);
      utteranceRef.current = utterance;

      if (voices[selectedVoiceIndex]) {
        utterance.voice = voices[selectedVoiceIndex];
      }
      utterance.rate = rate;

      utterance.onstart = () => {
        setStatus("playing");
      };

      utterance.onend = () => {
        setStatus("idle");
      };

      utterance.onerror = (e) => {
        if (e.error !== "canceled" && e.error !== "interrupted") {
          setError(`Speech playback issue: ${e.error || "playback failed"}.`);
        }
        setStatus("idle");
      };

      utterance.onpause = () => {
        setStatus("paused");
      };

      utterance.onresume = () => {
        setStatus("playing");
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      setError("Failed to start speech synthesis in this browser.");
      setStatus("idle");
    }
  }, [supported, text, status, voices, selectedVoiceIndex, rate]);

  // ── Pause ─────────────────────────────────────────────────────────────────
  const handlePause = useCallback(() => {
    if (!supported) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setStatus("paused");
    }
  }, [supported]);

  // ── Resume ────────────────────────────────────────────────────────────────
  const handleResume = useCallback(() => {
    if (!supported) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setStatus("playing");
    }
  }, [supported]);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setStatus("idle");
  }, [supported]);

  // ── Speed Change ──────────────────────────────────────────────────────────
  const handleSpeedChange = useCallback((newSpeed) => {
    setRate(newSpeed);
    // If actively playing, restart speech at new speed
    if (status === "playing") {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const utterance = new window.SpeechSynthesisUtterance(trimmed);
        if (voices[selectedVoiceIndex]) {
          utterance.voice = voices[selectedVoiceIndex];
        }
        utterance.rate = newSpeed;
        utterance.onstart = () => setStatus("playing");
        utterance.onend = () => setStatus("idle");
        utterance.onerror = () => setStatus("idle");
        utterance.onpause = () => setStatus("paused");
        utterance.onresume = () => setStatus("playing");
        window.speechSynthesis.speak(utterance);
      }, 50);
    }
  }, [status, text, voices, selectedVoiceIndex]);

  // ── Clear Text ────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    handleStop();
    setText("");
    setSelectedNoteId("");
    setError("");
  }, [handleStop]);

  // Word count and estimated read time
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedMinutes = Math.max(1, Math.round(wordCount / (150 * rate)));

  return (
    <div className={styles.page}>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerIcon} aria-hidden="true">
          🎧
        </div>
        <div>
          <h1 className={styles.pageTitle}>Study Voice &mdash; Listen &amp; Learn</h1>
          <p className={styles.pageDesc}>
            Listen to your notes aloud using your browser&apos;s built-in speech engine.
            Perfect for auditory learners, multitasking revision, or hands-free study.
          </p>
        </div>
      </div>

      {/* ── Browser Support Warning ─────────────────────────────── */}
      {!supported && (
        <div className={styles.warningBox} role="alert">
          <span>⚠️</span>
          <div>
            <strong>Web Speech API is not supported in this browser.</strong>
            <p style={{ marginTop: 4 }}>
              To use Study Voice, please switch to a modern browser like Google Chrome,
              Microsoft Edge, or Apple Safari.
            </p>
          </div>
        </div>
      )}

      {/* ── Main Input & Selection Card ─────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Study Material</h2>
          {text && (
            <button
              type="button"
              className={styles.btnAction}
              onClick={handleClear}
              disabled={status === "playing"}
            >
              Clear
            </button>
          )}
        </div>

        {/* Note Selector */}
        <div className={styles.selectorRow}>
          <label className={styles.selectorLabel} htmlFor="note-picker">
            <span>📖</span> Load from Notes:
          </label>
          <select
            id="note-picker"
            className={styles.select}
            value={selectedNoteId}
            onChange={(e) => handleSelectNote(e.target.value)}
            disabled={notesLoading || noteLoading}
          >
            <option value="">
              {notesLoading ? "Loading saved notes…" : "— Choose a saved note —"}
            </option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title} {n.subject ? `(${n.subject})` : ""}
              </option>
            ))}
          </select>
          {noteLoading && (
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              Loading note content…
            </span>
          )}
        </div>

        {/* Textarea */}
        <div className={styles.textareaWrap}>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            placeholder="Paste your study notes, textbook summaries, or lecture materials here. Or pick a saved note from the dropdown above."
            rows={8}
            aria-label="Study notes to read aloud"
          />
          <div className={styles.metaRow}>
            <span>
              {wordCount.toLocaleString()} word{wordCount !== 1 ? "s" : ""}
            </span>
            {wordCount > 0 && (
              <span>Estimated listening time: ~{estimatedMinutes} min ({rate}x speed)</span>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className={styles.warningBox} role="alert">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ── Playback Controls Card ──────────────────────────────── */}
      <div className={styles.controlsCard}>
        <div className={styles.controlsTop}>
          {/* Main action buttons */}
          <div className={styles.playbackGroup}>
            {status !== "playing" ? (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={status === "paused" ? handleResume : handlePlay}
                disabled={!supported || !text.trim()}
              >
                <span>▶</span> {status === "paused" ? "Resume" : "Play Voice"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.btnAction}
                onClick={handlePause}
                disabled={!supported}
              >
                <span>⏸</span> Pause
              </button>
            )}

            <button
              type="button"
              className={`${styles.btnAction} ${styles.btnStop}`}
              onClick={handleStop}
              disabled={!supported || status === "idle"}
            >
              <span>⏹</span> Stop
            </button>
          </div>

          {/* Status badge */}
          <div
            className={`${styles.statusBadge} ${
              status === "playing"
                ? styles.statusPlaying
                : status === "paused"
                ? styles.statusPaused
                : styles.statusIdle
            }`}
          >
            {status === "playing" && <span className={styles.pulseDot} />}
            {status === "playing"
              ? "Reading aloud…"
              : status === "paused"
              ? "Paused"
              : "Ready"}
          </div>
        </div>

        {/* Voice & Speed Settings */}
        <div className={styles.settingsGrid}>
          {/* Speed Buttons */}
          <div className={styles.settingItem}>
            <span className={styles.settingTitle}>Reading Speed</span>
            <div className={styles.speedButtons}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.speedBtn} ${rate === s ? styles.speedActive : ""}`}
                  onClick={() => handleSpeedChange(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Voice Selector */}
          {voices.length > 0 && (
            <div className={styles.settingItem}>
              <label className={styles.settingTitle} htmlFor="voice-select">
                Voice Accent / Character
              </label>
              <select
                id="voice-select"
                className={styles.select}
                value={selectedVoiceIndex}
                onChange={(e) => setSelectedVoiceIndex(Number(e.target.value))}
                disabled={status === "playing"}
              >
                {voices.map((v, i) => (
                  <option key={`${v.name}-${v.lang}`} value={i}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Live Audio Waves when playing */}
        {status === "playing" && (
          <div className={styles.infoBanner}>
            <div className={styles.waveAnim} aria-hidden="true">
              <span className={styles.waveBar} />
              <span className={styles.waveBar} />
              <span className={styles.waveBar} />
              <span className={styles.waveBar} />
            </div>
            <span>
              Now reading your notes at <strong>{rate}x</strong> speed. Press Pause or Stop anytime.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
