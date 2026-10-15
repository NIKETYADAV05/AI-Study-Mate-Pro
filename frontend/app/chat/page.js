import { Suspense } from "react";
import AppShell from "../components/AppShell";
import Chat from "../components/Chat";

export const metadata = {
  title: "Study Chatbot - AI StudyMate Pro",
  description: "Ask study questions, get simple explanations, examples, and revision help with Nova powered by Gemini.",
};

export default function ChatPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Chat />
      </Suspense>
    </AppShell>
  );
}
