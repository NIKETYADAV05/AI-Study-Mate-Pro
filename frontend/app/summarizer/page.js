import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Summarizer from "../components/Summarizer";

export const metadata = { title: "Notes Summarizer - AI StudyMate Pro" };

export default function SummarizerPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Summarizer />
      </Suspense>
    </AppShell>
  );
}
