"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { STAGES } from "@/constants/chat";

export interface ToolCallGraphProps {
  toolCalls: ToolCallState[];
}

export interface ToolCallState {
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  attempt?: number;
  maxAttempts?: number;
  result?: any;
  timestamp: number;
}

const ReactJson = dynamic(() => import("react-json-view"), {
  ssr: false,
});

export default function ToolCallGraph({ toolCalls }: ToolCallGraphProps) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<any>(null);

  // Group tool calls by tool name to get latest state
  const toolStates = new Map<string, ToolCallState>();
  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach((call) => {
      const existing = toolStates.get(call.tool);
      if (!existing || call.timestamp > existing.timestamp) {
        toolStates.set(call.tool, call);
      }
    });
  }

  // Get current stage index (find the last completed or current running stage)
  const getStageStatus = (stageId: string): ToolCallState["status"] => {
    const state = toolStates.get(stageId);
    if (!state) return "pending";

    // Check if this stage has been retried (for stages that can be retried)
    if (stageId === "retriever") {
      const allForStage = toolCalls.filter((c) => c.tool === stageId);
      const latest = allForStage[allForStage.length - 1];
      if (latest) {
        return latest.status;
      }
    }

    return state.status;
  };

  const getStageInfo = (stageId: string) => {
    const state = toolStates.get(stageId);
    if (!state) return null;

    // Get all calls for this stage (for retry attempts)
    const allForStage = toolCalls.filter((c) => c.tool === stageId);

    return {
      state,
      allAttempts: allForStage,
      latestAttempt: allForStage.length,
    };
  };

  // Helper function to parse JSON strings in results
  const parseJsonInResult = (result: any): any => {
    if (!result) return result;

    // If result has an output field that's a string, try to parse it as JSON
    if (result.output && typeof result.output === "string") {
      try {
        const parsed = JSON.parse(result.output);
        return {
          ...result,
          output: parsed,
        };
      } catch {
        // If parsing fails, keep the original string
        return result;
      }
    }

    return result;
  };

  const handleStageClick = (stageId: string) => {
    const info = getStageInfo(stageId);
    if (!info || !info.state) return;

    if (selectedStage === stageId) {
      // Deselect if clicking the same stage
      setSelectedStage(null);
      setSelectedData(null);
    } else {
      setSelectedStage(stageId);
      // Prepare data to show
      const allForStage = toolCalls.filter((c) => c.tool === stageId);
      setSelectedData({
        stage: stageId,
        label: STAGES.find((s) => s.id === stageId)?.label || stageId,
        currentStatus: info.state.status,
        attempts: allForStage.map((attempt) => ({
          attempt: attempt.attempt || 1,
          status: attempt.status,
          timestamp: new Date(attempt.timestamp).toISOString(),
          result: parseJsonInResult(attempt.result),
        })),
        latestResult: parseJsonInResult(info.state.result),
      });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        backgroundColor: "#111827",
        borderLeft: "1px solid #374151",
      }}
    >
      {/* Top Panel: Agent Workflow */}
      <div
        style={{
          padding: "1rem",
          borderBottom: "1px solid #374151",
          backgroundColor: "#1f2937",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: "0.875rem",
            fontWeight: "600",
            marginBottom: "1rem",
            color: "#ededed",
          }}
        >
          Agent Workflow
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "nowrap",
            width: "100%",
            padding: "0 0.5rem",
          }}
        >
          {STAGES.map((stage, index) => {
            const status = getStageStatus(stage.id);
            const info = getStageInfo(stage.id);
            const color = stage.color[status];
            const isSelected = selectedStage === stage.id;
            const isClickable =
              info && info.state && info.state.status !== "pending";

            return (
              <div
                key={stage.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: "1 1 0",
                  minWidth: 0,
                  position: "relative",
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    cursor: isClickable ? "pointer" : "default",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "0.5rem",
                  }}
                  onClick={() => isClickable && handleStageClick(stage.id)}
                >
                  <div
                    style={{
                      width: "50px",
                      height: "50px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.25rem",
                      border: `3px solid ${
                        isSelected
                          ? "#6366f1"
                          : status === "running"
                          ? "#60a5fa"
                          : color
                      }`,
                      boxShadow:
                        status === "running"
                          ? "0 0 10px rgba(59, 130, 246, 0.5)"
                          : isSelected
                          ? "0 0 10px rgba(99, 102, 241, 0.5)"
                          : "none",
                      transition: "all 0.3s ease",
                      position: "relative",
                      flexShrink: 0,
                    }}
                    title={stage.label}
                  >
                    {stage.icon}
                    {status === "running" && (
                      <div
                        style={{
                          position: "absolute",
                          top: "-5px",
                          right: "-5px",
                          width: "16px",
                          height: "16px",
                          borderRadius: "50%",
                          backgroundColor: "#3b82f6",
                          animation: "pulse 2s infinite",
                        }}
                      />
                    )}
                    {info && info.latestAttempt > 1 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "-8px",
                          right: "-8px",
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          backgroundColor: "#f59e0b",
                          color: "white",
                          fontSize: "0.65rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: "bold",
                        }}
                      >
                        {info.latestAttempt}
                      </div>
                    )}
                  </div>
                </div>

                {/* Label */}
                <div
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: "500",
                    color: "#9ca3af",
                    textAlign: "center",
                    width: "50px",
                    maxWidth: "50px",
                    lineHeight: "1.1",
                    minHeight: "2.4rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                    whiteSpace: "normal",
                    padding: "0",
                  }}
                >
                  {stage.label}
                </div>

                {/* Arrow to next stage - positioned absolutely to align with icon center */}
                {index < STAGES.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      left: "calc(50% + 25px + 0.75rem)",
                      top: "25px",
                      width: "calc(100% - 50px - 1.5rem)",
                      height: "2px",
                      backgroundColor:
                        status === "completed" || status === "running"
                          ? "#10b981"
                          : "#4b5563",
                      transform: "translateY(-50%)",
                    }}
                  >
                    {status === "completed" && (
                      <div
                        style={{
                          position: "absolute",
                          right: "-4px",
                          top: "-3px",
                          width: 0,
                          height: 0,
                          borderTop: "4px solid transparent",
                          borderBottom: "4px solid transparent",
                          borderLeft: "6px solid #10b981",
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Retry indicator */}
        {toolCalls.some(
          (c) => c.tool === "retriever" && (c.attempt || 0) > 1
        ) && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.5rem",
              backgroundColor: "#78350f",
              borderRadius: "0.25rem",
              fontSize: "0.7rem",
              color: "#fbbf24",
              textAlign: "center",
            }}
          >
            ⚠️ Retrieval refined and retried
          </div>
        )}
      </div>

      {/* Bottom Panel: Information/JSON Viewer */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "1rem",
          backgroundColor: "#111827",
        }}
      >
        {selectedData ? (
          <div>
            <div
              style={{
                fontSize: "0.875rem",
                fontWeight: "600",
                marginBottom: "0.75rem",
                color: "#ededed",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{selectedData.label} Details</span>
              <button
                onClick={() => {
                  setSelectedStage(null);
                  setSelectedData(null);
                }}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  backgroundColor: "#374151",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                  color: "#ededed",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                border: "1px solid #374151",
                borderRadius: "0.5rem",
                overflow: "auto",
                maxHeight: "calc(100vh - 300px)",
                width: "100%",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  padding: "1rem",
                  backgroundColor: "#1f2937",
                  width: "100%",
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                }}
              >
                <ReactJson
                  src={selectedData}
                  theme="monokai"
                  collapsed={2}
                  displayDataTypes={true}
                  displayObjectSize={true}
                  enableClipboard={false}
                  style={{
                    backgroundColor: "#1f2937",
                    wordWrap: "break-word",
                    overflowWrap: "break-word",
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#6b7280",
              fontSize: "0.875rem",
              textAlign: "center",
              padding: "1rem",
            }}
          >
            <div>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📊</div>
              <div>Click on a workflow stage to view details</div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
