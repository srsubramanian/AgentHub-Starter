"use client";

import { useCallback, useReducer, useRef } from "react";
import {
  HttpAgent,
  type CustomEvent,
  type TextMessageContentEvent,
  type TextMessageStartEvent,
} from "@ag-ui/client";
import type { ChatMessage } from "@/lib/types";
import type { Widget } from "@/lib/widgets";
import {
  agentReducer,
  initialAgentState,
  type AgentState,
} from "@/lib/agent-reducer";

/**
 * Hook wrapping @ag-ui/client HttpAgent with reducer-based state.
 * Handles text streaming and widget custom events.
 */
export function useAgent() {
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  const agentRef = useRef<HttpAgent | null>(null);
  const assistantMsgId = useRef<string | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isStreaming) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
      };

      dispatch({ type: "ADD_USER_MESSAGE", message: userMessage });
      dispatch({ type: "SET_STREAMING", isStreaming: true });

      // Reset assistant message tracking
      assistantMsgId.current = null;

      try {
        const agent = new HttpAgent({
          url: "/api/agent/run",
          threadId: crypto.randomUUID(),
          initialMessages: [],
        });
        agentRef.current = agent;

        // Set messages for the RunAgentInput payload
        const agMessages = [...state.messages, userMessage].map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        agent.setMessages(agMessages);

        await agent.runAgent(
          {},
          {
            onTextMessageStartEvent({
              event,
            }: {
              event: TextMessageStartEvent;
            }) {
              assistantMsgId.current = event.messageId;
              dispatch({
                type: "START_ASSISTANT_MESSAGE",
                messageId: event.messageId,
              });
            },

            onTextMessageContentEvent({
              event,
            }: {
              event: TextMessageContentEvent;
            }) {
              if (assistantMsgId.current) {
                dispatch({
                  type: "APPEND_TEXT",
                  messageId: assistantMsgId.current,
                  delta: event.delta,
                });
              }
            },

            onCustomEvent({ event }: { event: CustomEvent }) {
              const name = event.name as string;
              const value = event.value as Record<string, unknown>;

              if (name === "widget_create") {
                dispatch({
                  type: "WIDGET_CREATE",
                  widget: value as unknown as Widget,
                });
              } else if (name === "widget_update") {
                dispatch({
                  type: "WIDGET_UPDATE",
                  widgetId: value.widget_id as string,
                  patch: value.patch as unknown[],
                });
              } else if (name === "widget_remove") {
                dispatch({
                  type: "WIDGET_REMOVE",
                  widgetId: value.widget_id as string,
                });
              }
            },
          }
        );
      } catch (error) {
        console.error("Agent run failed:", error);
        if (assistantMsgId.current) {
          dispatch({
            type: "SET_ERROR",
            messageId: assistantMsgId.current,
            error: "Error: Failed to get a response from the agent.",
          });
        }
      } finally {
        dispatch({ type: "SET_STREAMING", isStreaming: false });
        agentRef.current = null;
        assistantMsgId.current = null;
      }
    },
    [state.messages, state.isStreaming]
  );

  return {
    messages: state.messages,
    widgets: state.widgets,
    isStreaming: state.isStreaming,
    sendMessage,
  };
}

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

export function usePinnedWidgets(state: AgentState): Widget[] {
  return state.widgets.filter((w) => w.placement === "canvas");
}

export function useInlineWidgets(state: AgentState): Widget[] {
  return state.widgets.filter((w) => w.placement === "inline");
}

export function useWidget(state: AgentState, id: string): Widget | undefined {
  return state.widgets.find((w) => w.id === id);
}
