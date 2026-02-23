import {
  createAgentWithTools,
  executeAgentWithStreaming,
} from "../agent/langchain-agent";
import { judgeResponse, type JudgeResult } from "./eval-judge";
import type { RetrievalResult } from "../agent/retriever";
import type {
  EvalResult,
  EvalConfig,
  EvalSummary,
  EvalPrompt,
} from "@/types/eval";
import type { ChatFilters } from "@/types/chat";

/**
 * Executes the agent workflow for eval (non-streaming, collects tool results)
 */
async function executeAgentForEval(
  prompt: string,
  model: string,
  filters?: ChatFilters
): Promise<{
  answer: string;
  retrievalResult?: RetrievalResult;
  error?: string;
}> {
  let finalAnswer = "";
  let retrievalResult: RetrievalResult | undefined;
  let agentError: string | undefined;

  try {
    const { agent } = await createAgentWithTools(model, undefined, filters);

    // Collect tool results during execution
    await executeAgentWithStreaming(
      agent,
      prompt,
      (event) => {
        if (event.type === "tool_result") {
          const { tool, output } = event.data;
          if (tool === "retriever" && output) {
            try {
              // The retriever tool returns either:
              // 1. JSON stringified array of documents (success case)
              // 2. Error message string (error case)
              const outputStr =
                typeof output === "string" ? output : JSON.stringify(output);
              const parsed = JSON.parse(outputStr);

              // If parsed is an array, it's the documents array (success case)
              if (Array.isArray(parsed)) {
                retrievalResult = {
                  documents: parsed,
                  count: parsed.length,
                  success: true,
                };
              } else {
                // Non-array means it's likely an error structure
                retrievalResult = {
                  documents: [],
                  count: 0,
                  success: false,
                  error: typeof parsed === "string" ? parsed : "Unknown error",
                };
              }
            } catch (e) {
              // If parsing fails, it might be a plain error message string
              // Try to construct a RetrievalResult from the error
              if (typeof output === "string") {
                retrievalResult = {
                  documents: [],
                  count: 0,
                  success: false,
                  error: output,
                };
              }
            }
          }
        } else if (event.type === "agent_response") {
          finalAnswer = event.data.content || finalAnswer;
        } else if (event.type === "error") {
          agentError = event.data.error;
        }
      },
      undefined,
      filters
    );
  } catch (error: any) {
    agentError = error.message || String(error);
  }

  return {
    answer: finalAnswer,
    retrievalResult,
    error: agentError,
  };
}

/**
 * Evaluates a single prompt through the agent workflow
 */
export async function evaluatePrompt(
  promptOrEvalPrompt: string | EvalPrompt,
  config: EvalConfig
): Promise<EvalResult> {
  const startTime = Date.now();

  // Handle both string prompts and EvalPrompt objects
  const prompt =
    typeof promptOrEvalPrompt === "string"
      ? promptOrEvalPrompt
      : promptOrEvalPrompt.prompt;
  const filters =
    typeof promptOrEvalPrompt === "string"
      ? undefined
      : promptOrEvalPrompt.filters || undefined;

  try {
    // Note: For eval, we assume all prompts may need tools
    // The agent workflow will handle cases where tools aren't needed
    const planningResult = {
      needsTools: true,
      reasoning: "Eval framework - using agent workflow",
    };

    // Use the langchain agent instead of calling tools directly
    const { answer, retrievalResult, error } = await executeAgentForEval(
      prompt,
      config.model,
      filters
    );

    const finalAnswer = answer || undefined;

    // Always run judge evaluation
    let judgeResult: JudgeResult;
    if (finalAnswer && !error) {
      const allDocuments = retrievalResult?.documents || [];
      judgeResult = await judgeResponse(
        prompt,
        finalAnswer,
        allDocuments,
        config.judgeModel
      );
    } else {
      // If no answer generated or error occurred, still evaluate
      judgeResult = await judgeResponse(
        prompt,
        error ? `Error: ${error}` : "No answer generated",
        [],
        config.judgeModel
      );
    }

    return {
      prompt,
      planningResult,
      toolResults: {
        retrievalResults: retrievalResult,
        answer: finalAnswer,
        totalAttempts: error ? 0 : 1,
      },
      judgeResult,
      success: !error && !!finalAnswer,
      error: error,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    // Still run judge evaluation for errors
    let judgeResult: JudgeResult;
    try {
      judgeResult = await judgeResponse(
        prompt,
        `Error: ${error.message}`,
        [],
        config.judgeModel
      );
    } catch (judgeError: any) {
      judgeResult = {
        score: 0,
        reasoning: `Judge error: ${judgeError.message}`,
        valid: false,
      };
    }

    return {
      prompt,
      planningResult: {
        needsTools: true,
        reasoning: `Error during evaluation: ${error.message}`,
      },
      toolResults: {
        totalAttempts: 0,
      },
      judgeResult,
      success: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Evaluates multiple prompts in sequence
 */
export async function evaluatePrompts(
  prompts: (string | EvalPrompt)[],
  config: EvalConfig
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const prompt of prompts) {
    const result = await evaluatePrompt(prompt, config);
    results.push(result);
  }

  return results;
}

/**
 * Evaluates prompts in parallel with controlled concurrency
 */
export async function evaluatePromptsParallel(
  prompts: (string | EvalPrompt)[],
  config: EvalConfig,
  concurrency: number = 10
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const executing: Promise<EvalResult>[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];

    const promise = evaluatePrompt(prompt, config).then((result) => {
      // Remove from executing when done
      const index = executing.indexOf(promise);
      if (index > -1) {
        executing.splice(index, 1);
      }
      return result;
    });

    executing.push(promise);

    // Wait if we hit concurrency limit
    if (executing.length >= concurrency) {
      const completed = await Promise.race(executing);
      results.push(completed);
    }
  }

  // Wait for remaining
  const remaining = await Promise.all(executing);
  results.push(...remaining);

  // Reorder results to match prompt order (if needed)
  const promptTextMap = new Map(results.map((r) => [r.prompt, r]));

  return prompts.map((p) => {
    const promptText = typeof p === "string" ? p : p.prompt;
    return promptTextMap.get(promptText) || results[results.length - 1];
  });
}

/**
 * Streams evaluation results as they complete (after agent + judge)
 * Each result is yielded once the full evaluation (including judge) is complete
 */
export async function* evaluatePromptsParallelStream(
  prompts: (string | EvalPrompt)[],
  config: EvalConfig,
  concurrency: number = 10
): AsyncGenerator<
  { result: EvalResult; index: number; completed: number; total: number },
  void,
  unknown
> {
  const executing: Array<{ promise: Promise<EvalResult>; index: number }> = [];
  let completed = 0;

  // Start evaluating prompts up to concurrency limit
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const index = i;

    // Create promise for this evaluation (includes both agent and judge)
    const promise = evaluatePrompt(prompt, config);
    executing.push({ promise, index });

    // When we hit concurrency limit, wait for one to complete before starting next
    if (executing.length >= concurrency || i === prompts.length - 1) {
      // Wait for any promise to complete
      const raceResult = await Promise.race(
        executing.map((e) =>
          e.promise
            .then((r) => ({ result: r, index: e.index }))
            .catch((error) => {
              // Handle errors and return error result
              const promptObj = prompts[e.index];
              const promptText =
                typeof promptObj === "string" ? promptObj : promptObj.prompt;
              return {
                result: {
                  prompt: promptText,
                  planningResult: {
                    needsTools: true,
                    reasoning: `Error: ${error.message}`,
                  },
                  toolResults: {
                    totalAttempts: 0,
                  },
                  judgeResult: {
                    score: 0,
                    reasoning: `Evaluation failed: ${error.message}`,
                    valid: false,
                  },
                  success: false,
                  error: error.message,
                  duration: 0,
                },
                index: e.index,
              };
            })
        )
      );

      completed++;

      // Remove completed from executing
      const execIndex = executing.findIndex(
        (e) => e.index === raceResult.index
      );
      if (execIndex > -1) {
        executing.splice(execIndex, 1);
      }

      // Yield the complete result (agent + judge already done)
      yield {
        result: raceResult.result,
        index: raceResult.index,
        completed,
        total: prompts.length,
      };
    }
  }

  // Wait for any remaining evaluations
  while (executing.length > 0) {
    const raceResult = await Promise.race(
      executing.map((e) =>
        e.promise
          .then((r) => ({ result: r, index: e.index }))
          .catch((error) => {
            const promptObj = prompts[e.index];
            const promptText =
              typeof promptObj === "string" ? promptObj : promptObj.prompt;
            return {
              result: {
                prompt: promptText,
                planningResult: {
                  needsTools: true,
                  reasoning: `Error: ${error.message}`,
                },
                toolResults: {
                  totalAttempts: 0,
                },
                judgeResult: {
                  score: 0,
                  reasoning: `Evaluation failed: ${error.message}`,
                  valid: false,
                },
                success: false,
                error: error.message,
                duration: 0,
              },
              index: e.index,
            };
          })
      )
    );

    completed++;

    // Remove completed from executing
    const execIndex = executing.findIndex((e) => e.index === raceResult.index);
    if (execIndex > -1) {
      executing.splice(execIndex, 1);
    }

    // Yield the complete result
    yield {
      result: raceResult.result,
      index: raceResult.index,
      completed,
      total: prompts.length,
    };
  }
}

/**
 * Generates an evaluation summary
 */
export function generateEvalSummary(results: EvalResult[]): EvalSummary {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const withTools = results.filter((r) => r.planningResult.needsTools).length;
  const withoutTools = results.filter(
    (r) => !r.planningResult.needsTools
  ).length;

  const avgDuration =
    results.reduce((sum, r) => sum + r.duration, 0) / results.length;

  const toolResults = results.filter((r) => r.toolResults.totalAttempts > 0);
  const avgAttempts =
    toolResults.length > 0
      ? toolResults.reduce((sum, r) => sum + r.toolResults.totalAttempts, 0) /
        toolResults.length
      : 0;

  const allRetrievalResults = results
    .filter((r) => r.toolResults.retrievalResults)
    .map((r) => r.toolResults.retrievalResults!);
  const successfulRetrievals = allRetrievalResults.filter(
    (r) => r.success
  ).length;
  const totalDocuments = allRetrievalResults.reduce(
    (sum, r) => sum + (r.count || 0),
    0
  );

  const judgeResults = results.filter((r) => r.judgeResult);
  const avgScore =
    judgeResults.length > 0
      ? judgeResults.reduce((sum, r) => sum + (r.judgeResult?.score || 0), 0) /
        judgeResults.length
      : 0;
  const validCount = judgeResults.filter((r) => r.judgeResult?.valid).length;

  return {
    total: results.length,
    successful,
    failed,
    withTools,
    withoutTools,
    avgDuration,
    avgAttempts,
    retrievalStats: {
      totalRecords: totalDocuments,
      avgRecordsPerPrompt: totalDocuments / results.length,
      successfulRetrievals,
    },
    judgeStats: {
      evaluated: judgeResults.length,
      avgScore,
      validCount,
      invalidCount: judgeResults.length - validCount,
    },
  };
}
