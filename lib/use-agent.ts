"use client";

import { useCallback, useRef, useState } from "react";
import { HttpAgent, type TextMessageContentEvent } from "@ag-ui/client";
import type { ChatMessage } from "@/lib/types";

/**
 * Hook that wraps @ag-ui/client HttpAgent for streaming chat.
 * Phase 1: text-only streaming, no widgets.
 */
export function useAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const agentRef = useRef<HttpAgent | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: content.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    // Build the assistant message placeholder
    const assistantMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    try {
      // Create the HttpAgent pointing at our Route Handler proxy
      const agent = new HttpAgent({
        url: "/api/agent/run",
        threadId: crypto.randomUUID(),
        initialMessages: [],
      });
      agentRef.current = agent;

      // Convert our messages to AG-UI format for the request
      const agMessages = [...messages, userMessage].map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Assign messages so they're included in the RunAgentInput
      agent.setMessages(agMessages);

      await agent.runAgent({}, {
        onTextMessageContentEvent({ event }: { event: TextMessageContentEvent }) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? { ...m, content: m.content + event.delta }
                : m
            )
          );
        },
      });
    } catch (error) {
      console.error("Agent run failed:", error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: "Error: Failed to get a response from the agent." }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      agentRef.current = null;
    }
  }, [messages, isStreaming]);

  return { messages, isStreaming, sendMessage };
}
