/**
 * Widget type definitions — mirrors agent/agent/widgets.py.
 *
 * This file is hand-maintained. If you change the Pydantic schemas,
 * update these types in the same commit.
 */

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export type WidgetType =
  | "query_plan"
  | "results_table"
  | "timeseries_chart"
  | "log_tail"
  | "summary_card"
  | "confirmation";

export type WidgetPlacement = "canvas" | "inline";

export type WidgetStatus =
  | "draft"
  | "submitted"
  | "running"
  | "complete"
  | "error"
  | "cancelled";

export interface WidgetAction {
  label: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Base widget
// ---------------------------------------------------------------------------

export interface BaseWidget {
  id: string; // ULID
  type: WidgetType;
  placement: WidgetPlacement;
  status: WidgetStatus;
  title: string;
  created_at: string;
  created_by_run: string;
  error_message?: string | null;
}

// ---------------------------------------------------------------------------
// Widget types
// ---------------------------------------------------------------------------

export interface QueryPlanWidget extends BaseWidget {
  type: "query_plan";
  query: string;
  log_groups: string[];
  available_log_groups: string[];
  start_time?: string | null;
  end_time?: string | null;
  actions: Record<string, WidgetAction>;
}

export interface ResultsTableColumn {
  key: string;
  label: string;
}

export interface ResultsTableWidget extends BaseWidget {
  type: "results_table";
  columns: ResultsTableColumn[];
  rows: Record<string, unknown>[];
}

export interface TimeseriesPoint {
  timestamp: string;
  value: number;
}

export interface TimeseriesSeries {
  name: string;
  data: TimeseriesPoint[];
}

export interface TimeseriesChartWidget extends BaseWidget {
  type: "timeseries_chart";
  series: TimeseriesSeries[];
  x_label: string;
  y_label: string;
}

export interface LogLine {
  timestamp: string;
  message: string;
  severity: "debug" | "info" | "warn" | "error";
}

export interface LogTailWidget extends BaseWidget {
  type: "log_tail";
  lines: LogLine[];
  max_lines: number;
}

export interface SummaryItem {
  label: string;
  value: string;
  trend: "up" | "down" | "flat" | "none";
}

export interface SummaryCardWidget extends BaseWidget {
  type: "summary_card";
  items: SummaryItem[];
}

export interface ConfirmationWidget extends BaseWidget {
  type: "confirmation";
  message: string;
  actions: Record<string, WidgetAction>;
  rejection_reason?: string | null;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type Widget =
  | QueryPlanWidget
  | ResultsTableWidget
  | TimeseriesChartWidget
  | LogTailWidget
  | SummaryCardWidget
  | ConfirmationWidget;

// ---------------------------------------------------------------------------
// Widget event payloads (from AG-UI custom events)
// ---------------------------------------------------------------------------

export interface WidgetCreateEvent {
  name: "widget_create";
  value: Widget;
}

export interface WidgetUpdateEvent {
  name: "widget_update";
  value: {
    widget_id: string;
    patch: unknown[]; // JSON Patch (RFC 6902)
  };
}

export interface WidgetRemoveEvent {
  name: "widget_remove";
  value: {
    widget_id: string;
  };
}

export type WidgetEvent =
  | WidgetCreateEvent
  | WidgetUpdateEvent
  | WidgetRemoveEvent;
