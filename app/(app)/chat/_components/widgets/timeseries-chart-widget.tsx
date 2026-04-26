"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeseriesChartWidget as TimeseriesChartWidgetType } from "@/lib/widgets";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface TimeseriesChartWidgetProps {
  widget: TimeseriesChartWidgetType;
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function TimeseriesChartWidget({ widget }: TimeseriesChartWidgetProps) {
  const isLoading = widget.status === "running";

  // Transform series data into recharts format:
  // [{timestamp, series1: val, series2: val}, ...]
  const chartData = (() => {
    if (!widget.series.length) return [];
    const timeMap = new Map<string, Record<string, string | number>>();
    for (const series of widget.series) {
      for (const point of series.data) {
        const existing = timeMap.get(point.timestamp) || {
          timestamp: point.timestamp,
        };
        existing[series.name] = point.value;
        timeMap.set(point.timestamp, existing);
      }
    }
    return Array.from(timeMap.values()).sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp))
    );
  })();

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
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data to display.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11 }}
                label={{
                  value: widget.x_label,
                  position: "insideBottom",
                  offset: -5,
                  fontSize: 12,
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                label={{
                  value: widget.y_label,
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 12,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {widget.series.map((s, i) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
