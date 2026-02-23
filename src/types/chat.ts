import { ToolCallState } from "@/components/ToolCallGraph";

export interface ChatMessage {
  role: "user" | "assistant" | "agent" | "system";
  content: string;
  toolCalls?: ToolCallState[];
}

export interface ChatFilters {
  customer?: string;
  assignedTo?: string;
  priority?: string;
  dateRange?: {
    startDate?: Date;
    endDate?: Date;
  };
}
