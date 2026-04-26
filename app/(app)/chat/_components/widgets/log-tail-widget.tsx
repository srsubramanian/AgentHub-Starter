"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LogTailWidget as LogTailWidgetType } from "@/lib/widgets";

interface LogTailWidgetProps {
  widget: LogTailWidgetType;
}

const SEVERITY_STYLES: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
};

const SEVERITY_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  debug: "outline",
  info: "secondary",
  warn: "default",
  error: "destructive",
};

export function LogTailWidget({ widget }: LogTailWidgetProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [widget.lines]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {widget.lines.length} / {widget.max_lines} lines
            </span>
            <Badge variant="secondary" className="text-xs">
              {widget.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] rounded-md bg-muted/50 p-3">
          <div className="space-y-0.5 font-mono text-xs">
            {widget.lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No log lines to display.
              </p>
            ) : (
              widget.lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">
                    {line.timestamp}
                  </span>
                  <Badge
                    variant={SEVERITY_BADGE[line.severity] || "secondary"}
                    className="h-4 shrink-0 px-1 text-[10px]"
                  >
                    {line.severity.toUpperCase()}
                  </Badge>
                  <span className={SEVERITY_STYLES[line.severity] || ""}>
                    {line.message}
                  </span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
