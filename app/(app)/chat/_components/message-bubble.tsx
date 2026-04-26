"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.content ? (
          <div
            className={cn(
              "prose prose-sm dark:prose-invert max-w-none",
              "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2",
              // Inline code: visible contrast against bubble bg
              "prose-code:rounded prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5",
              "prose-code:text-xs prose-code:font-medium prose-code:text-zinc-100",
              "prose-code:before:content-none prose-code:after:content-none",
              // Code blocks (pre): dark slab for readability
              "prose-pre:my-2 prose-pre:bg-zinc-950 prose-pre:text-zinc-100",
              "prose-pre:rounded-md prose-pre:p-3 prose-pre:text-xs",
              "prose-pre:border prose-pre:border-zinc-800"
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="inline-block h-4 w-1 animate-pulse bg-foreground/50" />
        )}
      </div>
    </div>
  );
}
