import AppShell from "../components/AppShell";
import Notes from "../components/Notes";

export const metadata = { title: "My Notes - AI StudyMate Pro" };

export default function NotesPage() {
  return (
    <AppShell>
      <Notes />
    </AppShell>
  );
}
