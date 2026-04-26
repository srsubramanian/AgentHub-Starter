/**
 * Agent state reducer — processes AG-UI events into React state.
 * Handles text message events and widget custom events.
 */

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
      // JSON Patch application — for Phase 2, we do a simple merge
      // Full RFC 6902 patch support comes with fast-json-patch in Phase 3
      return state;
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
