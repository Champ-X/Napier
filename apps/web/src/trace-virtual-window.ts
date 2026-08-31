import type {
  TraceSemanticRow,
  TraceRunSemanticCollection,
} from "./trace-semantic-rows";

export const TRACE_VIRTUAL_OVERSCAN_PX = 240;
export const TRACE_VIRTUAL_VIEWPORT_PX = 520;
const TURN_HEADER_HEIGHT_PX = 27;
const EVENT_ROW_HEIGHT_PX = 58;
export const TRACE_COMPACT_EVENT_ROW_HEIGHT_PX = 84;
const FOLD_ROW_HEIGHT_PX = 38;

export type TraceVirtualItem = TraceVirtualTurnItem | TraceVirtualRowItem;

export interface TraceVirtualTurnItem {
  kind: "turn";
  key: string;
  top: number;
  height: number;
  turnIndex: number;
  eventCount: number;
}

export interface TraceVirtualRowItem {
  kind: "row";
  key: string;
  top: number;
  height: number;
  turnIndex: number;
  row: TraceSemanticRow;
}

export interface TraceVirtualLayout {
  items: TraceVirtualItem[];
  eventTopById: Map<string, number>;
  totalHeight: number;
  totalRowCount: number;
}

export interface TraceVirtualWindow {
  endIndex: number;
  items: TraceVirtualItem[];
  mountedRowCount: number;
  scrollTop: number;
  startIndex: number;
}

export function createTraceVirtualLayout(
  collection: TraceRunSemanticCollection,
  options: { eventRowHeightPx?: number } = {},
): TraceVirtualLayout {
  const items: TraceVirtualItem[] = [];
  const eventTopById = new Map<string, number>();
  let top = 0;
  for (const turn of collection.turns) {
    items.push({
      kind: "turn",
      key: `turn:${String(turn.index)}`,
      top,
      height: TURN_HEADER_HEIGHT_PX,
      turnIndex: turn.index,
      eventCount: turn.eventCount,
    });
    top += TURN_HEADER_HEIGHT_PX;
    for (const row of turn.rows) {
      const height =
        row.kind === "event"
          ? (options.eventRowHeightPx ?? EVENT_ROW_HEIGHT_PX)
          : FOLD_ROW_HEIGHT_PX;
      items.push({
        kind: "row",
        key: row.key,
        top,
        height,
        turnIndex: turn.index,
        row,
      });
      if (row.kind === "event") eventTopById.set(row.event.event.id, top);
      top += height;
    }
  }
  return {
    items,
    eventTopById,
    totalHeight: top,
    totalRowCount: collection.totalRowCount,
  };
}

export function createTraceVirtualWindow(
  layout: TraceVirtualLayout,
  scrollTopInput: number,
  viewportHeightInput: number,
  overscanPx = TRACE_VIRTUAL_OVERSCAN_PX,
): TraceVirtualWindow {
  const viewportHeight = Math.max(1, viewportHeightInput);
  const maximumScrollTop = Math.max(0, layout.totalHeight - viewportHeight);
  const scrollTop = Math.min(maximumScrollTop, Math.max(0, scrollTopInput));
  const visibleStart = Math.max(0, scrollTop - Math.max(0, overscanPx));
  const visibleEnd = Math.min(
    layout.totalHeight,
    scrollTop + viewportHeight + Math.max(0, overscanPx),
  );
  const startIndex = firstItemEndingAfter(layout.items, visibleStart);
  let endIndex = startIndex;
  while (
    endIndex < layout.items.length &&
    layout.items[endIndex]!.top < visibleEnd
  ) {
    endIndex += 1;
  }
  const items = layout.items.slice(startIndex, endIndex);
  return {
    endIndex,
    items,
    mountedRowCount: items.filter((item) => item.kind === "row").length,
    scrollTop,
    startIndex,
  };
}

function firstItemEndingAfter(
  items: readonly TraceVirtualItem[],
  position: number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = items[middle]!;
    if (item.top + item.height <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}
