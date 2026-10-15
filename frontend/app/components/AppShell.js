"use client";

import Sidebar from "./Sidebar";
import styles from "./AppShell.module.css";

export default function AppShell({ children }) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
