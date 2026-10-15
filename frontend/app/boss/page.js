import { Suspense } from "react";
import AppShell from "../components/AppShell";
import BossBattle from "../components/BossBattle";

export const metadata = { title: "Exam Boss Battles - AI StudyMate Pro" };

export default function BossPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <BossBattle />
      </Suspense>
    </AppShell>
  );
}
