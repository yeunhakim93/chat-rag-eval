import { NextRequest, NextResponse } from "next/server";
import { streamAgentResponse } from "@/service/agent-streaming";
import type { ChatFilters } from "@/types/chat";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages = [], model = "gpt-4o", max_tokens, filters } = body ?? {};

    // Parse filters if provided
    let parsedFilters: ChatFilters | undefined;
    if (filters) {
      const dateRange =
        filters.dateRange &&
        (filters.dateRange.startDate || filters.dateRange.endDate)
          ? {
              ...(filters.dateRange.startDate && {
                startDate: new Date(filters.dateRange.startDate),
              }),
              ...(filters.dateRange.endDate && {
                endDate: new Date(filters.dateRange.endDate),
              }),
            }
          : undefined;

      parsedFilters = {
        customer: filters.customer,
        assignedTo: filters.assignedTo,
        priority: filters.priority,
        ...(dateRange && { dateRange }),
      };
    }

    const streamResponse = await streamAgentResponse(
      messages,
      model,
      max_tokens,
      parsedFilters
    );

    return new Response(streamResponse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: any) {
    console.error("API error:", error);
    if (
      error.message.includes("must be an array") ||
      error.message.includes("cannot be empty") ||
      error.message.includes("is not configured") ||
      error.message.includes("is not set")
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("is not") ? 500 : 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
