/** Shared types for the AgentHub Starter frontend. */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
