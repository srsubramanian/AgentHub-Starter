"use client";

import { useAgent } from "@/lib/use-agent";
import { MessageList } from "./message-list";
import { Composer } from "./composer";

export function ChatSurface() {
  const { messages, isStreaming, sendMessage } = useAgent();

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} />
      <Composer onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
