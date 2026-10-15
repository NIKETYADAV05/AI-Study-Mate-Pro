import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Quiz from "../components/Quiz";

export const metadata = { title: "Quiz Generator - AI StudyMate Pro" };

export default function QuizPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Quiz />
      </Suspense>
    </AppShell>
  );
}
