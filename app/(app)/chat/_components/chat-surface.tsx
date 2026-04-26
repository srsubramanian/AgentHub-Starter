"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAgent } from "@/lib/use-agent";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { Canvas } from "./canvas";

export function ChatSurface() {
  const { messages, widgets, isStreaming, sendMessage } = useAgent();

  const canvasWidgets = widgets.filter((w) => w.placement === "canvas");

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* Chat column */}
      <ResizablePanel defaultSize={30} minSize={20}>
        <div className="flex h-full flex-col">
          <MessageList messages={messages} />
          <Composer onSend={sendMessage} disabled={isStreaming} />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Canvas column */}
      <ResizablePanel defaultSize={70} minSize={30}>
        <Canvas widgets={canvasWidgets} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
