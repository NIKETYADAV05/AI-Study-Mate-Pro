"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import styles from "./Profile.module.css";

export const THEME_OPTIONS = [
  {
    id: "light",
    name: "Classic Indigo (Light)",
    icon: "☀️",
    desc: "Crisp, daylight study interface with high contrast and sharp legibility.",
    palette: ["#4f46e5", "#ffffff", "#f8f9fc", "#06b6d4"],
    previewLabel: "Daylight Focus",
  },
  {
    id: "dark",
    name: "Midnight Dark (Night)",
    icon: "🌙",
    desc: "Deep slate & indigo background optimized for night owls and low eye glare.",
    palette: ["#6366f1", "#141d2e", "#0b0f19", "#38bdf8"],
    previewLabel: "Night Reading",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk Violet",
    icon: "🔮",
    desc: "Electric neon violet and rose tones for an energized, immersive study vibe.",
    palette: ["#a855f7", "#180c30", "#0d061a", "#f43f5e"],
    previewLabel: "Neon Energy",
  },
  {
    id: "forest",
    name: "Emerald Focus",
    icon: "🌲",
    desc: "Calm botanical greens that reduce cognitive fatigue and foster calm concentration.",
    palette: ["#10b981", "#0c2b20", "#051812", "#06b6d4"],
    previewLabel: "Deep Calm",
  },
  {
    id: "sunset",
    name: "Sunset Amber",
    icon: "🌅",
    desc: "Warm charcoal and amber glow designed to minimize blue light before sleep.",
    palette: ["#f97316", "#241611", "#160d09", "#eab308"],
    previewLabel: "Warm Glow",
  },
];

function subscribeTheme(callback) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("studymate_theme_change", callback);
  return () => window.removeEventListener("studymate_theme_change", callback);
}

function getThemeSnapshot() {
  if (typeof document !== "undefined") {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  return "light";
}

function getThemeServerSnapshot() {
  return "light";
}

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [activeTab, setActiveTab] = useState("academic");
  const currentTheme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  // State data
  const [profile, setProfile] = useState({
    display_name: "",
    college: "",
    course: "",
    semester: "",
    bio: "",
    preferred_subjects: [],
    daily_study_goal_minutes: 60,
    avatar_initial: "N",
  });
  const [originalProfile, setOriginalProfile] = useState(null);

  const [stats, setStats] = useState({
    total_xp: 0,
    level: 1,
    level_title: "Apprentice Scholar",
    xp_to_next: 0,
    progress_pct: 0,
    completed_tasks: 0,
    total_tasks: 0,
    total_quizzes: 0,
    avg_quiz_score: null,
    total_notes: 0,
    study_streak: 0,
  });

  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [modal, setModal] = useState(null); // { title, desc, action }

  // ── Load Profile & Real Study Data on Mount / Refresh ───────────────────
  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setOriginalProfile(data.profile);
      }
      if (data.stats) {
        setStats(data.stats);
      }
      if (Array.isArray(data.available_subjects)) {
        setAvailableSubjects(data.available_subjects);
      }
    } catch {
      setError("Failed to load student profile from database. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!ignore) {
          if (data.profile) {
            setProfile(data.profile);
            setOriginalProfile(data.profile);
          }
          if (data.stats) {
            setStats(data.stats);
          }
          if (Array.isArray(data.available_subjects)) {
            setAvailableSubjects(data.available_subjects);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) {
          setError("Failed to load student profile from database. Please check your connection.");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // ── Form Input Change Handler ─────────────────────────────────────────────
  const handleChange = (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    setSuccessMsg("");
  };

  // ── Toggle Subject Preference ─────────────────────────────────────────────
  const handleToggleSubject = (subject) => {
    setProfile((prev) => {
      const current = prev.preferred_subjects || [];
      const exists = current.includes(subject);
      const updated = exists
        ? current.filter((s) => s !== subject)
        : [...current, subject];
      return { ...prev, preferred_subjects: updated };
    });
    setSuccessMsg("");
  };

  // ── Theme Selection ───────────────────────────────────────────────────────
  const handleSelectTheme = (themeId) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", themeId);
    }
    try {
      localStorage.setItem("studymate_theme", themeId);
      window.dispatchEvent(
        new CustomEvent("studymate_theme_change", { detail: themeId })
      );
      const found = THEME_OPTIONS.find((t) => t.id === themeId);
      setSuccessMsg(`Switched appearance to ${found ? found.name : themeId}!`);
    } catch (err) {
      console.error(err);
    }
  };

  // ── Save Profile & Preferences ────────────────────────────────────────────
  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMsg("");
    setFieldErrors({});

    // Client-side quick validation
    const errors = {};
    if (!profile.display_name.trim()) {
      errors.display_name = "Display name is required.";
    } else if (profile.display_name.trim().length > 100) {
      errors.display_name = "Display name must be 100 characters or less.";
    }

    if (profile.daily_study_goal_minutes < 5 || profile.daily_study_goal_minutes > 720) {
      errors.daily_study_goal_minutes = "Daily study goal must be between 5 and 720 minutes.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.errors) {
          setFieldErrors(data.errors);
        } else {
          setError(data.error || "Failed to update profile.");
        }
        return;
      }

      setProfile(data.profile);
      setOriginalProfile(data.profile);
      if (data.stats) setStats(data.stats);
      setSuccessMsg("Profile and study preferences updated successfully!");
    } catch {
      setError("An unexpected network error occurred while saving profile.");
    } finally {
      setSaving(false);
    }
  };

  // ── Discard Unsaved Changes ───────────────────────────────────────────────
  const handleCancel = () => {
    if (originalProfile) {
      setProfile(originalProfile);
      setFieldErrors({});
      setError("");
      setSuccessMsg("");
    }
  };

  // ── Reset Profile to Factory Defaults ─────────────────────────────────────
  const handleResetDefaults = async () => {
    setModal(null);
    setSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/profile/reset", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        setProfile(data.profile);
        setOriginalProfile(data.profile);
        setSuccessMsg("Profile details have been reset to default values.");
      } else {
        setError(data.error || "Failed to reset profile.");
      }
    } catch {
      setError("Network error while resetting profile.");
    } finally {
      setSaving(false);
    }
  };

  // ── Clear Study History (Destructive) ─────────────────────────────────────
  const handleClearHistory = async (target) => {
    setModal(null);
    setSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/profile/reset-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, target }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message || "History cleared successfully.");
        loadProfile();
      } else {
        setError(data.error || "Failed to clear history.");
      }
    } catch {
      setError("Network error while clearing study history.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.heroCard}>
          <p style={{ color: "var(--muted)", fontSize: "0.95rem" }}>
            Loading student profile and study stats...
          </p>
        </div>
      </div>
    );
  }

  const initial = (profile.display_name && profile.display_name[0].toUpperCase()) || "S";

  return (
    <div className={styles.container}>
      {/* ── Top Hero Profile Banner ── */}
      <div className={styles.heroCard}>
        <div className={styles.heroTop}>
          <div className={styles.avatarLarge}>{initial}</div>
          <div className={styles.heroInfo}>
            <h1 className={styles.heroName}>{profile.display_name || "Student"}</h1>
            <div className={styles.heroMeta}>
              {profile.course && <span>🎓 {profile.course}</span>}
              {profile.semester && <span className={styles.badge}>{profile.semester}</span>}
              {profile.college && <span>🏛️ {profile.college}</span>}
              <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                Level {stats.level} • {stats.level_title}
              </span>
            </div>
          </div>
        </div>

        {/* Level XP Progress Bar */}
        <div className={styles.heroLevelBar}>
          <div className={styles.levelBarHeader}>
            <span>
              ⚡ {stats.total_xp} Total XP &bull; Level {stats.level}
            </span>
            <span>
              {stats.xp_to_next > 0
                ? `${stats.xp_to_next} XP to next level`
                : "Max Level Reached!"}
            </span>
          </div>
          <div className={styles.progressBarBg}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${Math.min(100, stats.progress_pct || 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div className={styles.tabsBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "academic" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("academic")}
        >
          👤 Profile Details
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "stats" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 Study Statistics
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "preferences" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("preferences")}
        >
          🎯 Study Preferences
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "theme" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("theme")}
        >
          🎨 Appearance &amp; Theme
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "privacy" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("privacy")}
        >
          ⚙️ Privacy &amp; Data
        </button>
      </div>

      {/* Notification Banners */}
      {successMsg && <div className={styles.alertSuccess}>✓ {successMsg}</div>}
      {error && <div className={styles.alertError}>⚠️ {error}</div>}

      {/* ── Tab 1: Academic Profile ── */}
      {activeTab === "academic" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Academic Information</h2>
              <p className={styles.cardSubtitle}>
                Edit your display name, college, degree, and study bio.
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="display_name" className={styles.label}>
                Display Name *
              </label>
              <input
                id="display_name"
                type="text"
                className={styles.input}
                value={profile.display_name}
                onChange={(e) => handleChange("display_name", e.target.value)}
                placeholder="e.g. Niket"
                maxLength={100}
                required
              />
              {fieldErrors.display_name && (
                <span className={styles.errorText}>{fieldErrors.display_name}</span>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="college" className={styles.label}>
                College / University
              </label>
              <input
                id="college"
                type="text"
                className={styles.input}
                value={profile.college}
                onChange={(e) => handleChange("college", e.target.value)}
                placeholder="e.g. National Institute of Technology"
                maxLength={200}
              />
              {fieldErrors.college && (
                <span className={styles.errorText}>{fieldErrors.college}</span>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="course" className={styles.label}>
                Course / Major
              </label>
              <input
                id="course"
                type="text"
                className={styles.input}
                value={profile.course}
                onChange={(e) => handleChange("course", e.target.value)}
                placeholder="e.g. Computer Science & Engineering"
                maxLength={150}
              />
              {fieldErrors.course && (
                <span className={styles.errorText}>{fieldErrors.course}</span>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="semester" className={styles.label}>
                Semester / Academic Year
              </label>
              <input
                id="semester"
                type="text"
                className={styles.input}
                value={profile.semester}
                onChange={(e) => handleChange("semester", e.target.value)}
                placeholder="e.g. Semester 6 or 3rd Year"
                maxLength={50}
              />
              {fieldErrors.semester && (
                <span className={styles.errorText}>{fieldErrors.semester}</span>
              )}
            </div>

            <div className={styles.formGroupFull}>
              <label htmlFor="bio" className={styles.label}>
                Study Bio / Motto
              </label>
              <textarea
                id="bio"
                className={styles.textarea}
                value={profile.bio}
                onChange={(e) => handleChange("bio", e.target.value)}
                placeholder="Share your academic goals or learning motto..."
                rows={3}
                maxLength={1000}
              />
              {fieldErrors.bio && (
                <span className={styles.errorText}>{fieldErrors.bio}</span>
              )}
            </div>

            <div className={styles.formGroupFull}>
              <div className={styles.actionsBar}>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={saving}
                >
                  {saving ? "Saving Changes..." : "Save Profile"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Tab 2: Real Study Statistics ── */}
      {activeTab === "stats" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Study Performance &amp; Activity</h2>
              <p className={styles.cardSubtitle}>
                Derived from your real database activity records across tasks, notes, quests, and quizzes.
              </p>
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statIconRow}>
                <span className={styles.statLabel}>Current Streak</span>
                <span className={styles.statEmoji}>🔥</span>
              </div>
              <div className={styles.statValue}>{stats.study_streak} days</div>
              <span className={styles.statHint}>
                {stats.study_streak > 0
                  ? "Active study streak maintained!"
                  : "Complete a task or quiz today to start a streak!"}
              </span>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconRow}>
                <span className={styles.statLabel}>Total Quest XP</span>
                <span className={styles.statEmoji}>⚡</span>
              </div>
              <div className={styles.statValue}>{stats.total_xp} XP</div>
              <span className={styles.statHint}>
                Level {stats.level} ({stats.level_title})
              </span>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconRow}>
                <span className={styles.statLabel}>Tasks Completed</span>
                <span className={styles.statEmoji}>✅</span>
              </div>
              <div className={styles.statValue}>
                {stats.completed_tasks} / {stats.total_tasks}
              </div>
              <span className={styles.statHint}>
                {stats.total_tasks > 0
                  ? `${Math.round((stats.completed_tasks / stats.total_tasks) * 100)}% completion rate`
                  : "No study tasks scheduled yet"}
              </span>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconRow}>
                <span className={styles.statLabel}>Quizzes Completed</span>
                <span className={styles.statEmoji}>🧠</span>
              </div>
              <div className={styles.statValue}>{stats.total_quizzes}</div>
              <span className={styles.statHint}>
                {stats.avg_quiz_score !== null
                  ? `Average score: ${stats.avg_quiz_score}%`
                  : "No quiz attempts recorded"}
              </span>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconRow}>
                <span className={styles.statLabel}>Saved Notes</span>
                <span className={styles.statEmoji}>📝</span>
              </div>
              <div className={styles.statValue}>{stats.total_notes}</div>
              <span className={styles.statHint}>
                {stats.total_notes > 0 ? "Saved study guides & notes" : "No notes created yet"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 3: Study Preferences ── */}
      {activeTab === "preferences" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Study Preferences</h2>
              <p className={styles.cardSubtitle}>
                Customize your daily commitment and focus subjects.
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div className={styles.formGroupFull}>
              <label htmlFor="daily_study_goal_minutes" className={styles.label}>
                Daily Study Goal (Minutes)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", maxWidth: "240px" }}>
                <input
                  id="daily_study_goal_minutes"
                  type="number"
                  min={5}
                  max={720}
                  className={styles.input}
                  value={profile.daily_study_goal_minutes}
                  onChange={(e) =>
                    handleChange("daily_study_goal_minutes", parseInt(e.target.value, 10) || 0)
                  }
                />
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>min / day</span>
              </div>
              {fieldErrors.daily_study_goal_minutes && (
                <span className={styles.errorText}>{fieldErrors.daily_study_goal_minutes}</span>
              )}

              <div className={styles.presetRow}>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)", alignSelf: "center" }}>
                  Presets:
                </span>
                {[30, 45, 60, 90, 120].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => handleChange("daily_study_goal_minutes", mins)}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.formGroupFull}>
              <label className={styles.label}>Preferred Focus Subjects</label>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "8px" }}>
                Select the subjects you want to focus on for adaptive quests and revision reminders:
              </p>
              <div className={styles.chipContainer}>
                {availableSubjects.map((subject) => {
                  const isSelected = (profile.preferred_subjects || []).includes(subject);
                  return (
                    <button
                      key={subject}
                      type="button"
                      className={`${styles.chip} ${isSelected ? styles.chipSelected : ""}`}
                      onClick={() => handleToggleSubject(subject)}
                    >
                      {isSelected ? "✓ " : "+ "}
                      {subject}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.actionsBar}>
              <button type="submit" className={styles.primaryBtn} disabled={saving}>
                {saving ? "Saving Preferences..." : "Save Preferences"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tab 4: Appearance & Theme ── */}
      {activeTab === "theme" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Appearance &amp; Theme</h2>
              <p className={styles.cardSubtitle}>
                Select your preferred visual style. Changes apply immediately across all application pages and persist automatically.
              </p>
            </div>
          </div>

          <div className={styles.themeGrid}>
            {THEME_OPTIONS.map((t) => {
              const isActive = (currentTheme || "light") === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.themeOptionCard} ${isActive ? styles.themeOptionActive : ""}`}
                  onClick={() => handleSelectTheme(t.id)}
                  title={`Activate ${t.name}`}
                >
                  <div className={styles.themeOptionTop}>
                    <span className={styles.themeOptionTitle}>
                      <span>{t.icon}</span>
                      <span>{t.name}</span>
                    </span>
                    <span className={isActive ? styles.themeBadgeActive : styles.themeBadgeInactive}>
                      {isActive ? "Active" : "Select"}
                    </span>
                  </div>

                  <p className={styles.themeOptionDesc}>{t.desc}</p>

                  <div className={styles.themePreviewStrip}>
                    <div className={styles.themePreviewDots}>
                      {t.palette.map((c, i) => (
                        <div
                          key={i}
                          className={styles.themePreviewDot}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <span className={styles.themePreviewSample}>{t.previewLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab 5: Privacy & Data ── */}
      {activeTab === "privacy" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Active Theme Quick Status */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Active Theme</h2>
                <p className={styles.cardSubtitle}>
                  Current visual theme active in AI StudyMate Pro.
                </p>
              </div>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setActiveTab("theme")}
              >
                Change Theme 🎨
              </button>
            </div>
            <div className={styles.themeBox}>
              <div className={styles.themeSwatches}>
                {(THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0]).palette.map((c, i) => (
                  <div key={i} className={styles.swatch} style={{ background: c }} />
                ))}
              </div>
              <div>
                <strong style={{ fontSize: "0.9rem", color: "var(--text)" }}>
                  {(THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0]).name}
                </strong>
                <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  {(THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0]).desc}
                </p>
              </div>
            </div>
          </div>

          {/* Privacy & Architecture Notice */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Local Architecture &amp; Privacy</h2>
                <p className={styles.cardSubtitle}>Information about your local data and storage.</p>
              </div>
            </div>
            <p style={{ fontSize: "0.88rem", color: "var(--text-light)", lineHeight: "1.6" }}>
              AI StudyMate Pro operates as a privacy-first, local single-user application. All your
              notes, planner tasks, quiz records, and profile details are stored directly on your
              local SQLite database. No personal profile data or study records are synced to external
              clouds or third-party trackers.
            </p>
          </div>

          {/* Danger Zone */}
          <div className={styles.card} style={{ borderColor: "#fecaca" }}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle} style={{ color: "#b91c1c" }}>
                  ⚠️ Danger Zone
                </h2>
                <p className={styles.cardSubtitle}>
                  Actions here alter or reset stored data. These actions require confirmation.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <strong style={{ fontSize: "0.88rem", color: "var(--text)" }}>
                    Reset Profile to Defaults
                  </strong>
                  <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    Resets your display name, course, bio, and preferences to initial defaults. Your notes
                    and tasks remain intact.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() =>
                    setModal({
                      title: "Reset Profile to Defaults?",
                      desc: "Are you sure you want to reset your profile details and preferences to defaults? Your notes and planner tasks will NOT be affected.",
                      action: handleResetDefaults,
                    })
                  }
                >
                  Reset Profile
                </button>
              </div>

              <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <strong style={{ fontSize: "0.88rem", color: "#b91c1c" }}>
                    Clear Quiz History
                  </strong>
                  <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    Permanently deletes all completed quiz attempts from the database.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() =>
                    setModal({
                      title: "Clear Quiz History?",
                      desc: "Are you sure you want to permanently clear all completed quiz attempt records? This action cannot be undone.",
                      action: () => handleClearHistory("quizzes"),
                    })
                  }
                >
                  Clear Quizzes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {modal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBox}>
            <h3 className={styles.modalTitle}>⚠️ {modal.title}</h3>
            <p className={styles.modalDesc}>{modal.desc}</p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={modal.action}
              >
                Confirm &amp; Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
