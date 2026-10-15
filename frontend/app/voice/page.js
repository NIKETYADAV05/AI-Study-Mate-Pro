import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Voice from "../components/Voice";

export const metadata = { title: "Study Voice - AI StudyMate Pro" };

export default function VoicePage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Voice />
      </Suspense>
    </AppShell>
  );
}
