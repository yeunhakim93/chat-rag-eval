import { chatCompletion } from "../chat";
import type { ChatMessage } from "@/types/chat";

export interface JudgeResult {
  score: number; // 0.0 to 1.0
  reasoning: string;
  valid: boolean;
}

/**
 * LLM Judge: Evaluates if the agent's response is valid based on retrieved data
 */
export async function judgeResponse(
  prompt: string,
  agentResponse: string,
  retrievedData: any[],
  judgeModel: string = "gpt-4o"
): Promise<JudgeResult> {
  const systemPrompt = `You are an expert judge evaluating the quality and accuracy of AI assistant responses.

Your task is to evaluate if the agent's response is:
1. **Accurate** - Does it correctly reflect the data from retrieved documents?
2. **Complete** - Does it provide sufficient information to answer the question?
3. **Relevant** - Does it address what the user asked?
4. **Technically sound** - Are concepts and relationships correctly explained?

Evaluation Criteria:
- **Score 0.9-1.0**: Response is highly accurate, complete, and addresses the question perfectly
- **Score 0.7-0.89**: Response is mostly accurate but missing some details or has minor inaccuracies
- **Score 0.5-0.69**: Response is partially correct but has notable gaps or inaccuracies
- **Score 0.3-0.49**: Response has significant errors or misses major aspects of the question
- **Score 0.0-0.29**: Response is largely incorrect, misleading, or doesn't address the question

IMPORTANT: You MUST provide detailed reasoning that explains:
1. What aspects of the response are correct or incorrect
2. What information is missing or incomplete
3. How well the response addresses the user's question
4. Any factual inaccuracies or misleading information
5. The rationale for the assigned score

Respond with JSON:
{
  "score": 0.0-1.0,
  "reasoning": "detailed explanation (minimum 2-3 sentences explaining your evaluation)",
  "valid": true/false (true if score >= 0.5)
}`;

  const userPrompt = `User Question: ${prompt}

Agent Response:
${agentResponse}

Retrieved Data Summary:
${JSON.stringify(retrievedData.slice(0, 5), null, 2)}

Evaluate the agent's response. Consider:
- Does the response accurately reflect the data from the retrieved documents?
- Is the information complete enough to answer the user's question?
- Are concepts and relationships correctly explained?
- Are there any factual errors or misleading information?`;

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await chatCompletion({
      messages,
      model: judgeModel,
    });

    let content = response.choices?.[0]?.message?.content || "{}";

    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    content = content.trim();
    if (content.startsWith("```")) {
      const lines = content.split("\n");
      // Remove first line (could be ``` or ```json)
      lines.shift();
      // Remove last line if it's just ```
      if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
        lines.pop();
      }
      content = lines.join("\n").trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError: any) {
      // If JSON parsing fails, try to extract JSON from the content
      console.error(
        "Judge JSON parse error. Content:",
        content.substring(0, 200)
      );
      throw new Error(
        `Failed to parse judge response as JSON: ${
          parseError.message
        }. Content preview: ${content.substring(0, 100)}`
      );
    }

    return {
      score: Math.max(0, Math.min(1, parseFloat(parsed.score) || 0)),
      reasoning: parsed.reasoning || "No reasoning provided",
      valid: parsed.valid === true || (parseFloat(parsed.score) || 0) >= 0.5,
    };
  } catch (error: any) {
    console.error("Judge evaluation error:", error);
    return {
      score: 0,
      reasoning: `Judge error: ${error.message}`,
      valid: false,
    };
  }
}
