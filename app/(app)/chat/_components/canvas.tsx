"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { WidgetRenderer } from "./widget-registry";
import type { Widget } from "@/lib/widgets";

interface CanvasProps {
  widgets: Widget[];
}

export function Canvas({ widgets }: CanvasProps) {
  if (widgets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Widgets will appear here as the agent responds.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {widgets.map((widget) => (
          <WidgetRenderer key={widget.id} widget={widget} />
        ))}
      </div>
    </ScrollArea>
  );
}
