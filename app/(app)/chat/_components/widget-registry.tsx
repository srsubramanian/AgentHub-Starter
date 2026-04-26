"use client";

import type { Widget } from "@/lib/widgets";
import { ResultsTableWidget } from "./widgets/results-table-widget";
import { SummaryCardWidget } from "./widgets/summary-card-widget";

interface WidgetRendererProps {
  widget: Widget;
}

/**
 * Maps widget types to their React components.
 * New widget types are added here as they're built.
 */
export function WidgetRenderer({ widget }: WidgetRendererProps) {
  switch (widget.type) {
    case "summary_card":
      return <SummaryCardWidget widget={widget} />;
    case "results_table":
      return <ResultsTableWidget widget={widget} />;
    case "query_plan":
    case "timeseries_chart":
    case "log_tail":
    case "confirmation":
      // Placeholder for Phase 3-4 widgets
      return (
        <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
          Widget type &quot;{widget.type}&quot; — coming soon
        </div>
      );
    default:
      return null;
  }
}
