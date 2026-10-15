import styles from "./PlaceholderPage.module.css";

export default function PlaceholderPage({ emoji, title, description, features, color, bg, comingSoon }) {
  return (
    <div className={styles.page}>
      <div className={styles.hero} style={{ background: bg, borderColor: color + "40" }}>
        <span className={styles.emoji}>{emoji}</span>
        <div>
          <div className={styles.topRow}>
            <h1 className={styles.title}>{title}</h1>
            {comingSoon && (
              <span className={styles.badge} style={{ background: color + "18", color }}>
                Coming soon
              </span>
            )}
          </div>
          <p className={styles.description}>{description}</p>
        </div>
      </div>

      <div className={styles.featuresCard}>
        <h2 className={styles.featuresTitle}>Planned features</h2>
        <ul className={styles.featuresList}>
          {features.map((f) => (
            <li key={f} className={styles.featureItem}>
              <span className={styles.check} style={{ color }}>✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.notice}>
        <span className={styles.noticeIcon}>🚧</span>
        <p>
          This feature is being built as part of the <strong>AI StudyMate Pro</strong> project.
          It will be connected to the Django backend in the next step.
        </p>
      </div>
    </div>
  );
}
