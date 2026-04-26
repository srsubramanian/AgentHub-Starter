"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SummaryCardWidget as SummaryCardWidgetType } from "@/lib/widgets";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface SummaryCardWidgetProps {
  widget: SummaryCardWidgetType;
}

function TrendIcon({ trend }: { trend: string }) {
  switch (trend) {
    case "up":
      return <ArrowUp className="h-3 w-3 text-green-500" />;
    case "down":
      return <ArrowDown className="h-3 w-3 text-red-500" />;
    case "flat":
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    default:
      return null;
  }
}

export function SummaryCardWidget({ widget }: SummaryCardWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {widget.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {widget.items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">{item.label}</span>
              <span className="flex items-center gap-1 font-medium">
                <TrendIcon trend={item.trend} />
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
