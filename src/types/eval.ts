import type { RetrievalResult } from "@/service/agent/retriever";
import type { JudgeResult } from "@/service/eval/eval-judge";
import type { ChatFilters } from "@/types/chat";

export interface EvalPrompt {
  prompt: string;
  filters?: ChatFilters | null;
}

export interface EvalSummary {
  total: number;
  successful: number;
  failed: number;
  withTools: number;
  withoutTools: number;
  avgDuration: number;
  avgAttempts: number;
  retrievalStats: {
    totalRecords: number;
    avgRecordsPerPrompt: number;
    successfulRetrievals: number;
  };
  judgeStats: {
    evaluated: number;
    avgScore: number;
    validCount: number;
    invalidCount: number;
  };
}

export type Tab = "results" | "statistics";

export interface EvalResult {
  prompt: string;
  planningResult: {
    needsTools: boolean;
    reasoning: string;
  };
  toolResults: {
    retrievalResults?: RetrievalResult;
    answer?: string;
    totalAttempts: number;
  };
  judgeResult: JudgeResult; // Always present now
  success: boolean;
  error?: string;
  duration: number;
}

export interface EvalConfig {
  model: string; // Model to eval with (agent model)
  judgeModel: string; // Model to eval against (judge model) - required
}
