interface StageConfig {
  id: string;
  label: string;
  icon: string;
  color: {
    pending: string;
    running: string;
    completed: string;
    error: string;
  };
}

export const AVAILABLE_MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
] as const;

export const STAGES: StageConfig[] = [
  {
    id: "retriever",
    label: "Retrieve Records",
    icon: "🔍",
    color: {
      pending: "#4b5563",
      running: "#3b82f6",
      completed: "#10b981",
      error: "#ef4444",
    },
  },
  {
    id: "summary_generator",
    label: "Generate Summary",
    icon: "✍️",
    color: {
      pending: "#4b5563",
      running: "#3b82f6",
      completed: "#10b981",
      error: "#ef4444",
    },
  },
  {
    id: "fact_verifier",
    label: "Verify Facts",
    icon: "🔎",
    color: {
      pending: "#4b5563",
      running: "#3b82f6",
      completed: "#10b981",
      error: "#ef4444",
    },
  },
];
