"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ResultsTableWidget as ResultsTableWidgetType } from "@/lib/widgets";
import { AlertCircle } from "lucide-react";

interface ResultsTableWidgetProps {
  widget: ResultsTableWidgetType;
}

export function ResultsTableWidget({ widget }: ResultsTableWidgetProps) {
  const isLoading = widget.status === "running";
  const isError = widget.status === "error";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
          <Badge
            variant={isError ? "destructive" : "secondary"}
            className="text-xs"
          >
            {widget.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isError && widget.error_message && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{widget.error_message}</p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {!isLoading && widget.columns.length > 0 && (
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  {widget.columns.map((col) => (
                    <TableHead key={col.key}>{col.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {widget.rows.length === 0 && !isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={widget.columns.length}
                      className="text-center text-muted-foreground"
                    >
                      No results found.
                    </TableCell>
                  </TableRow>
                ) : (
                  widget.rows.map((row, i) => (
                    <TableRow key={i}>
                      {widget.columns.map((col) => (
                        <TableCell key={col.key} className="text-sm">
                          {String(row[col.key] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
