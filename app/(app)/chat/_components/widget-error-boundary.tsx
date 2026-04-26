"use client";

import { Component, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

interface Props {
  widgetType: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Widget Error
              </CardTitle>
              <Badge variant="destructive" className="text-xs">
                {this.props.widgetType}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This widget failed to render.{" "}
              {this.state.error?.message && (
                <span className="text-destructive">
                  {this.state.error.message}
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
