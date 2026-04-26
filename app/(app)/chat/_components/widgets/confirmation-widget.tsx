"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConfirmationWidget as ConfirmationWidgetType } from "@/lib/widgets";
import { CheckCircle, XCircle } from "lucide-react";

interface ConfirmationWidgetProps {
  widget: ConfirmationWidgetType;
  onAction?: (action: string, payload?: Record<string, unknown>) => void;
}

export function ConfirmationWidget({
  widget,
  onAction,
}: ConfirmationWidgetProps) {
  const isDraft = widget.status === "draft";
  const isComplete = widget.status === "complete";
  const isCancelled = widget.status === "cancelled";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
          <Badge
            variant={
              isComplete
                ? "default"
                : isCancelled
                  ? "destructive"
                  : "secondary"
            }
            className="text-xs"
          >
            {widget.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{widget.message}</p>

        {isDraft && (
          <div className="flex gap-2">
            {widget.actions.confirm?.enabled && (
              <Button
                size="sm"
                onClick={() => onAction?.("confirm")}
              >
                <CheckCircle className="mr-1 h-4 w-4" />
                {widget.actions.confirm.label}
              </Button>
            )}
            {widget.actions.reject?.enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction?.("reject")}
              >
                <XCircle className="mr-1 h-4 w-4" />
                {widget.actions.reject.label}
              </Button>
            )}
          </div>
        )}

        {isComplete && (
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            Confirmed
          </p>
        )}

        {isCancelled && widget.rejection_reason && (
          <p className="text-sm text-destructive">
            Rejected: {widget.rejection_reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
