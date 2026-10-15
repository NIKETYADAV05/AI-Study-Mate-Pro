import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Planner from "../components/Planner";

export const metadata = { title: "Study Planner - AI StudyMate Pro" };

export default function PlannerPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Planner />
      </Suspense>
    </AppShell>
  );
}
