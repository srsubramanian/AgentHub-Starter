"use client";

import type { Widget } from "@/lib/widgets";
import { ConfirmationWidget } from "./widgets/confirmation-widget";
import { LogTailWidget } from "./widgets/log-tail-widget";
import { ResultsTableWidget } from "./widgets/results-table-widget";
import { SummaryCardWidget } from "./widgets/summary-card-widget";
import { TimeseriesChartWidget } from "./widgets/timeseries-chart-widget";
import { WidgetErrorBoundary } from "./widget-error-boundary";

interface WidgetRendererProps {
  widget: Widget;
}

function WidgetContent({ widget }: WidgetRendererProps) {
  switch (widget.type) {
    case "summary_card":
      return <SummaryCardWidget widget={widget} />;
    case "results_table":
      return <ResultsTableWidget widget={widget} />;
    case "timeseries_chart":
      return <TimeseriesChartWidget widget={widget} />;
    case "log_tail":
      return <LogTailWidget widget={widget} />;
    case "confirmation":
      return <ConfirmationWidget widget={widget} />;
    case "query_plan":
      return (
        <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
          Widget type &quot;query_plan&quot; — coming soon
        </div>
      );
    default:
      return null;
  }
}

/**
 * Maps widget types to their React components, wrapped in error boundaries.
 */
export function WidgetRenderer({ widget }: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary widgetType={widget.type}>
      <WidgetContent widget={widget} />
    </WidgetErrorBoundary>
  );
}
