import { createRetrieverTool } from "./retriever";
import { createSummaryGeneratorTool } from "./summary-generator";
import { createFactVerifierTool } from "./fact-verifier";
import type { ChatFilters } from "@/types/chat";

export interface AgentTools {
  retriever: ReturnType<typeof createRetrieverTool>;
  summaryGenerator: ReturnType<typeof createSummaryGeneratorTool>;
  factVerifier: ReturnType<typeof createFactVerifierTool>;
}

export function createAgentTools(
  model: string,
  filters?: ChatFilters
): AgentTools {
  return {
    retriever: createRetrieverTool(filters),
    summaryGenerator: createSummaryGeneratorTool(model),
    factVerifier: createFactVerifierTool(model),
  };
}
