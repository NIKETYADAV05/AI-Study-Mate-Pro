"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Chat.module.css";

const MAX_INPUT_CHARS = 1500;
const MAX_HISTORY_TURNS = 8;

const INITIAL_MESSAGE = {
  id: "init-1",
  role: "model",
  text: "Hello! I'm Nova, your AI Study Mate powered by Groq. Ask me any study question, paste tricky lecture notes, request simple explanations with examples, or ask for quick revision quizzes!",
  timestamp: "Just now",
};

const SUGGESTIONS = [
  "Explain Big-O notation with simple analogies",
  "How does the HTTP request-response cycle work?",
  "Give me 3 quick practice questions on binary search",
  "Help me break down a difficult exam topic",
];

function formatTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const chatBottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  const handleSend = useCallback(async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    if (query.length > MAX_INPUT_CHARS) {
      setError(`Message exceeds the maximum limit of ${MAX_INPUT_CHARS} characters.`);
      return;
    }

    setError("");
    setInput("");

    const userMsg = {
      id: `usr-${Date.now()}`,
      role: "user",
      text: query,
      timestamp: formatTime(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setLoading(true);

    // Limit context history turns to save tokens & stay focused
    const payloadMessages = nextHistory
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({
        role: m.role,
        text: m.text.slice(0, 2000),
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      const modelMsg = {
        id: `mod-${Date.now()}`,
        role: "model",
        text: data.reply || "I didn't receive a response. Please try again.",
        timestamp: formatTime(),
        model: data.model,
      };

      setMessages((prev) => [...prev, modelMsg]);
    } catch (err) {
      setError(err.message || "Failed to reach Gemini. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (window.confirm("Start a fresh chat conversation?")) {
      setMessages([
        {
          id: `init-${Date.now()}`,
          role: "model",
          text: "Fresh chat started! What subject or concept would you like to study today?",
          timestamp: formatTime(),
        },
      ]);
      setError("");
    }
  };

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.headerIcon}>💬</div>
          <div>
            <h1 className={styles.title}>Study Chatbot</h1>
            <p className={styles.subtitle}>
              Ask questions, get concept breakdowns, and revise with Nova
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.modelBadge}>
            <span className={styles.modelDot} />
            Groq AI
          </span>
          {messages.length > 1 && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleClear}
              title="Clear conversation"
            >
              Clear Chat
            </button>
          )}
        </div>
      </div>

      {/* Suggestion Chips */}
      <div className={styles.suggestionsRow}>
        {SUGGESTIONS.map((s, idx) => (
          <button
            key={idx}
            type="button"
            className={styles.suggestionChip}
            onClick={() => handleSuggestionClick(s)}
          >
            💡 {s}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className={styles.chatBox}>
        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              className={`${styles.messageRow} ${isUser ? styles.rowUser : styles.rowModel}`}
            >
              <div
                className={`${styles.avatar} ${isUser ? styles.avatarUser : styles.avatarModel}`}
              >
                {isUser ? "👤" : "🤖"}
              </div>

              <div className={styles.bubbleCol}>
                <div
                  className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleModel}`}
                >
                  {isUser ? (
                    <div className={styles.userText}>{m.text}</div>
                  ) : (
                    <div className={styles.markdownContent}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ ...props }) => (
                            <div className={styles.tableWrapper}>
                              <table {...props} />
                            </div>
                          ),
                          pre: ({ ...props }) => (
                            <pre className={styles.codeBlock} {...props} />
                          ),
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                <div className={styles.metaRow}>
                  <span>{m.timestamp}</span>
                  {!isUser && (
                    <button
                      type="button"
                      className={styles.copyBtn}
                      onClick={() => handleCopy(m.id, m.text)}
                    >
                      {copiedId === m.id ? "✓ Copied" : "Copy"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator while loading */}
        {loading && (
          <div className={`${styles.messageRow} ${styles.rowModel}`}>
            <div className={`${styles.avatar} ${styles.avatarModel}`}>🤖</div>
            <div className={styles.bubbleCol}>
              <div className={styles.typingContainer}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingText}>Nova is thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error notification if request fails */}
        {error && (
          <div className={styles.errorBanner}>
            <span>⚠️ {error}</span>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => handleSend()}
            >
              Retry
            </button>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Input Box */}
      <div className={styles.inputCard}>
        <div className={styles.inputRow}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or paste notes to explain (e.g. 'Explain the difference between TCP and UDP')..."
            rows={2}
            disabled={loading}
          />
          <button
            type="button"
            className={styles.sendBtn}
            onClick={() => handleSend()}
            disabled={loading || !input.trim() || input.length > MAX_INPUT_CHARS}
            aria-label="Send question"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <div className={styles.inputFooter}>
          <span>Press Enter to send, Shift + Enter for new line</span>
          <span
            className={input.length > MAX_INPUT_CHARS ? styles.charCountOver : undefined}
          >
            {input.length}/{MAX_INPUT_CHARS}
          </span>
        </div>
      </div>
    </div>
  );
}
