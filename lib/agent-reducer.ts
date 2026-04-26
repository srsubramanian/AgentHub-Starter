/**
 * Agent state reducer — processes AG-UI events into React state.
 * Handles text message events and widget custom events.
 */

import { applyPatch } from "fast-json-patch";
import type { Widget } from "@/lib/widgets";
import type { ChatMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AgentState {
  messages: ChatMessage[];
  widgets: Widget[];
  isStreaming: boolean;
}

export const initialAgentState: AgentState = {
  messages: [],
  widgets: [],
  isStreaming: false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AgentAction =
  | { type: "ADD_USER_MESSAGE"; message: ChatMessage }
  | { type: "START_ASSISTANT_MESSAGE"; messageId: string }
  | { type: "APPEND_TEXT"; messageId: string; delta: string }
  | { type: "SET_STREAMING"; isStreaming: boolean }
  | { type: "SET_ERROR"; messageId: string; error: string }
  | { type: "WIDGET_CREATE"; widget: Widget }
  | { type: "WIDGET_UPDATE"; widgetId: string; patch: unknown[] }
  | { type: "WIDGET_REMOVE"; widgetId: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "START_ASSISTANT_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: action.messageId, role: "assistant", content: "" },
        ],
      };

    case "APPEND_TEXT":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? { ...m, content: m.content + action.delta }
            : m
        ),
      };

    case "SET_STREAMING":
      return { ...state, isStreaming: action.isStreaming };

    case "SET_ERROR":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId ? { ...m, content: action.error } : m
        ),
      };

    case "WIDGET_CREATE":
      return { ...state, widgets: [...state.widgets, action.widget] };

    case "WIDGET_UPDATE": {
      return {
        ...state,
        widgets: state.widgets.map((w) => {
          if (w.id !== action.widgetId) return w;
          try {
            const patched = applyPatch(
              structuredClone(w),
              action.patch as Parameters<typeof applyPatch>[1],
              true, // validate
              false, // don't mutate
            );
            return patched.newDocument as Widget;
          } catch {
            console.error("Failed to apply widget patch", action.patch);
            return w;
          }
        }),
      };
    }

    case "WIDGET_REMOVE":
      return {
        ...state,
        widgets: state.widgets.filter((w) => w.id !== action.widgetId),
      };

    default:
      return state;
  }
}
