import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Nova from "../components/Nova";

export const metadata = { title: "Explain to Nova - AI StudyMate Pro" };

export default function NovaPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Nova />
      </Suspense>
    </AppShell>
  );
}
