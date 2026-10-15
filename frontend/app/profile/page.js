import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Profile from "../components/Profile";

export const metadata = {
  title: "Student Profile & Settings - AI StudyMate Pro",
  description: "View your study statistics, edit your student profile, configure study goals, and manage app preferences.",
};

export default function ProfilePage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Profile />
      </Suspense>
    </AppShell>
  );
}
