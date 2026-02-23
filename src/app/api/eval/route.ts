import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePrompts,
  evaluatePromptsParallelStream,
  generateEvalSummary,
  type EvalResult,
} from "@/service/eval";
import type { EvalPrompt } from "@/types/eval";
import { randomSelect } from "@/utils/universal";

/**
 * POST /api/eval
 * Evaluates one or more prompts through the agent workflow
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompts,
      limit,
      model = "gpt-4.1",
      judgeModel = "gpt-4.1",
      parallel = false,
      summary = true,
      concurrency = 10,
      stream = false,
    } = body;

    if (!prompts) {
      return NextResponse.json(
        { error: "Prompts are required" },
        { status: 400 }
      );
    }

    let promptArray = Array.isArray(prompts) ? prompts : [prompts];

    // Normalize prompts: if they're objects with filters containing date strings, parse dates
    promptArray = promptArray.map((p): string | EvalPrompt => {
      if (typeof p === "string") return p;
      const evalPrompt = p as EvalPrompt;
      if (!evalPrompt.filters) return evalPrompt;

      const normalized: EvalPrompt = {
        prompt: evalPrompt.prompt,
        filters: {
          ...(evalPrompt.filters.customer && {
            customer: evalPrompt.filters.customer,
          }),
          ...(evalPrompt.filters.assignedTo && {
            assignedTo: evalPrompt.filters.assignedTo,
          }),
          ...(evalPrompt.filters.priority && {
            priority: evalPrompt.filters.priority,
          }),
        },
      };

      if (evalPrompt.filters.dateRange) {
        normalized.filters = normalized.filters || {};
        normalized.filters.dateRange = {
          ...(evalPrompt.filters.dateRange.startDate && {
            startDate:
              typeof evalPrompt.filters.dateRange.startDate === "string"
                ? new Date(evalPrompt.filters.dateRange.startDate)
                : evalPrompt.filters.dateRange.startDate,
          }),
          ...(evalPrompt.filters.dateRange.endDate && {
            endDate:
              typeof evalPrompt.filters.dateRange.endDate === "string"
                ? new Date(evalPrompt.filters.dateRange.endDate)
                : evalPrompt.filters.dateRange.endDate,
          }),
        };
      }

      return normalized;
    });

    if (limit && typeof limit === "number" && limit > 0) {
      if (limit > promptArray.length) {
        return NextResponse.json(
          {
            error: `Limit (${limit}) exceeds number of prompts (${promptArray.length})`,
          },
          { status: 400 }
        );
      }
      promptArray = randomSelect(promptArray, limit);
    }
    const config = {
      model,
      judgeModel,
    };

    if (stream && parallel && promptArray.length > 1) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (type: string, data: any) => {
            const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          };

          try {
            const allResults: EvalResult[] = new Array(promptArray.length);

            for await (const {
              result,
              index,
              completed,
              total,
            } of evaluatePromptsParallelStream(
              promptArray,
              config,
              concurrency
            )) {
              allResults[index] = result;

              sendEvent("result", {
                result,
                index,
                completed,
                total,
              });

              sendEvent("progress", {
                completed,
                total,
              });

              if (completed === total) {
                const finalResults = allResults.filter((r) => r !== undefined);

                if (summary) {
                  sendEvent("summary", generateEvalSummary(finalResults));
                }

                sendEvent("done", {});
                controller.close();
              }
            }
          } catch (error: any) {
            console.error("Streaming eval error:", error);
            sendEvent("error", { error: error.message });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    let results: EvalResult[];

    if (parallel && promptArray.length > 1) {
      const { evaluatePromptsParallel } = await import("@/service/eval");
      results = await evaluatePromptsParallel(promptArray, config, concurrency);
    } else {
      results = await evaluatePrompts(promptArray, config);
    }

    const response: any = {
      results,
    };

    if (summary) {
      response.summary = generateEvalSummary(results);
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Eval API error:", error);
    return NextResponse.json(
      { error: error.message || "Evaluation failed" },
      { status: 500 }
    );
  }
}
