"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { EvalResult, EvalSummary, Tab } from "@/types/eval";

// Dynamically import ReactJson with SSR disabled to avoid document is not defined error
const ReactJson = dynamic(() => import("react-json-view"), {
  ssr: false,
}) as any;

export default function EvalPage() {
  const [prompts, setPrompts] = useState<string>("");
  const [results, setResults] = useState<EvalResult[]>([]);
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("results");
  const [model, setModel] = useState("gpt-4o-mini");
  const [judgeModel, setJudgeModel] = useState("gpt-4o-mini");
  const [batchSize, setBatchSize] = useState(3);
  const [promptLimit, setPromptLimit] = useState<number | "">(12);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const handleRunEval = async () => {
    if (!prompts.trim()) return;

    setIsLoading(true);
    setResults([]);
    setSummary(null);
    setSelectedResult(null);
    setProgress(null);

    try {
      const promptArray = prompts
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const response = await fetch("/api/eval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompts: promptArray.length === 1 ? promptArray[0] : promptArray,
          model,
          judgeModel,
          parallel: promptArray.length > 1,
          concurrency: batchSize,
          summary: true,
          stream: promptArray.length > 1, // Stream if multiple prompts
        }),
      });

      if (!response.ok) {
        throw new Error(`Evaluation failed: ${response.statusText}`);
      }

      // Check if response is streaming (SSE) or JSON
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("text/event-stream")) {
        // Handle streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const streamResults: EvalResult[] = [];

        if (!reader) {
          throw new Error("No response body");
        }

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            const match = line.match(/^event: (\w+)\ndata: ([\s\S]+)$/);
            if (!match) continue;

            const [, eventType, dataStr] = match;
            try {
              const data = JSON.parse(dataStr);

              if (eventType === "result") {
                // Add or update result at correct index
                while (streamResults.length <= data.index) {
                  streamResults.push(null as any);
                }
                streamResults[data.index] = data.result;
                setResults(streamResults.filter((r) => r !== null));
              } else if (eventType === "progress") {
                setProgress({
                  current: data.completed,
                  total: data.total,
                });
              } else if (eventType === "summary") {
                setSummary(data);
                setActiveTab("statistics");
              } else if (eventType === "done") {
                // Final update
                const finalResults = streamResults.filter((r) => r !== null);
                setResults(finalResults);
              } else if (eventType === "error") {
                throw new Error(data.error || "Streaming error");
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError);
            }
          }
        }

        // Final update
        const finalResults = streamResults.filter((r) => r !== null);
        setResults(finalResults);
        setActiveTab("results");
      } else {
        // Non-streaming JSON response
        const data = await response.json();
        setResults(data.results || []);
        setSummary(data.summary || null);
        setActiveTab("results");
      }
    } catch (error: any) {
      console.error("Eval error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  const handleLoadFromFile = async () => {
    setIsLoading(true);
    setResults([]);
    setSummary(null);
    setSelectedResult(null);

    try {
      // Load prompts from file
      const fileResponse = await fetch("/data/eval-prompts.json");

      if (!fileResponse.ok) {
        throw new Error(
          `Failed to load prompts file: ${fileResponse.status} ${fileResponse.statusText}`
        );
      }

      const contentType = fileResponse.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await fileResponse.text();
        throw new Error(
          `Expected JSON but got ${contentType}. Response: ${text.substring(
            0,
            100
          )}`
        );
      }

      const promptsData = await fileResponse.json();
      const allPrompts = Array.isArray(promptsData) ? promptsData : [];

      if (allPrompts.length === 0) {
        throw new Error("No prompts found in file");
      }

      // Determine final prompts count - apply limit if specified
      const finalCount =
        promptLimit && typeof promptLimit === "number" && promptLimit > 0
          ? Math.min(promptLimit, allPrompts.length)
          : allPrompts.length;

      // Set progress with final prompts count
      setProgress({ current: 0, total: finalCount });

      // Run eval with streaming
      const response = await fetch("/api/eval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompts: allPrompts,
          limit:
            promptLimit && typeof promptLimit === "number" && promptLimit > 0
              ? promptLimit
              : undefined,
          model,
          judgeModel,
          parallel: true,
          concurrency: batchSize,
          summary: true,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Batch eval failed: ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const streamResults: EvalResult[] = new Array(finalCount);

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const match = line.match(/^event: (\w+)\ndata: ([\s\S]+)$/);
          if (!match) continue;

          const [, eventType, dataStr] = match;
          try {
            const data = JSON.parse(dataStr);

            if (eventType === "result") {
              streamResults[data.index] = data.result;
              setResults([...streamResults.filter((r) => r !== undefined)]);
            } else if (eventType === "progress") {
              setProgress({
                current: data.completed,
                total: data.total,
              });
            } else if (eventType === "summary") {
              setSummary(data);
              setActiveTab("statistics");
            } else if (eventType === "done") {
              // Final update with all results
              const finalResults = streamResults.filter((r) => r !== undefined);
              setResults(finalResults);
            } else if (eventType === "error") {
              throw new Error(data.error || "Streaming error");
            }
          } catch (parseError) {
            console.error("Error parsing SSE data:", parseError);
          }
        }
      }

      // Final update
      const finalResults = streamResults.filter((r) => r !== undefined);
      setResults(finalResults);
      setActiveTab("statistics");
    } catch (error: any) {
      console.error("Batch eval error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "Arial, sans-serif",
        backgroundColor: "#0a0a0a",
        color: "#ededed",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem",
          backgroundColor: "#1f2937",
          borderBottom: "1px solid #374151",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: "bold",
            color: "#ededed",
          }}
        >
          Agent Evaluation Interface
        </h1>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel: Configuration */}
        <div
          style={{
            width: "350px",
            padding: "1rem",
            backgroundColor: "#111827",
            borderRight: "1px solid #374151",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            overflowY: "auto",
          }}
        >
          {/* Model Configuration */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: "500",
                marginBottom: "0.5rem",
                color: "#d1d5db",
              }}
            >
              Model to Eval With (Agent)
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #4b5563",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                backgroundColor: "#374151",
                color: "#ededed",
              }}
            >
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: "500",
                marginBottom: "0.5rem",
                color: "#d1d5db",
              }}
            >
              Model to Eval Against (Judge)
            </label>
            <select
              value={judgeModel}
              onChange={(e) => setJudgeModel(e.target.value)}
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #4b5563",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                backgroundColor: "#374151",
                color: "#ededed",
              }}
            >
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  marginBottom: "0.5rem",
                  color: "#d1d5db",
                }}
              >
                Batch Size
              </label>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 10)}
                disabled={isLoading}
                min={1}
                max={50}
                placeholder="3"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                  backgroundColor: "#374151",
                  color: "#ededed",
                }}
              />
              <p
                style={{
                  margin: "0.25rem 0 0 0",
                  fontSize: "0.75rem",
                  color: "#9ca3af",
                }}
              >
                Number of prompts to process in parallel (1-50)
              </p>
            </div>

            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  marginBottom: "0.5rem",
                  color: "#d1d5db",
                }}
              >
                Prompt Limit
              </label>
              <input
                type="number"
                value={promptLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  setPromptLimit(val === "" ? "" : parseInt(val) || "");
                }}
                disabled={isLoading}
                min={1}
                placeholder="Leave empty for all"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                  backgroundColor: "#374151",
                  color: "#ededed",
                }}
              />
              <p
                style={{
                  margin: "0.25rem 0 0 0",
                  fontSize: "0.75rem",
                  color: "#9ca3af",
                }}
              >
                Randomly select n prompts from file (leave empty for all)
              </p>
            </div>
          </div>

          {/* Prompts Input */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: "500",
                marginBottom: "0.5rem",
                color: "#d1d5db",
              }}
            >
              Prompts (one per line, or leave empty for batch)
            </label>
            <textarea
              value={prompts}
              onChange={(e) => setPrompts(e.target.value)}
              disabled={isLoading}
              placeholder="Enter prompts here, one per line... (Leave empty to run batch from file)"
              style={{
                flex: 1,
                padding: "0.75rem",
                border: "1px solid #4b5563",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                fontFamily: "monospace",
                resize: "none",
                backgroundColor: "#374151",
                color: "#ededed",
              }}
            />
          </div>

          {/* Actions */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <button
              onClick={handleRunEval}
              disabled={isLoading || !prompts.trim()}
              style={{
                width: "100%",
                padding: "0.75rem",
                backgroundColor:
                  isLoading || !prompts.trim() ? "#4b5563" : "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                fontWeight: "500",
                cursor:
                  isLoading || !prompts.trim() ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Running..." : "Run Custom Prompts"}
            </button>
            <button
              onClick={handleLoadFromFile}
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "0.75rem",
                backgroundColor: isLoading ? "#4b5563" : "#10b981",
                color: "white",
                border: "none",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                fontWeight: "500",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading
                ? "Running..."
                : `Run Batch (${
                    promptLimit &&
                    typeof promptLimit === "number" &&
                    promptLimit > 0
                      ? `${promptLimit} randomly selected`
                      : "all"
                  } prompts, ${batchSize} parallel)`}
            </button>
          </div>

          {progress && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#9ca3af",
                textAlign: "center",
              }}
            >
              Processing: {progress.current} / {progress.total}
            </div>
          )}
        </div>

        {/* Right Panel: Results & Statistics Tabs */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #374151",
              backgroundColor: "#1f2937",
            }}
          >
            <button
              onClick={() => setActiveTab("results")}
              style={{
                padding: "0.75rem 1.5rem",
                border: "none",
                borderBottom:
                  activeTab === "results"
                    ? "2px solid #2563eb"
                    : "2px solid transparent",
                backgroundColor: "transparent",
                color: activeTab === "results" ? "#60a5fa" : "#9ca3af",
                fontWeight: activeTab === "results" ? "600" : "400",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Results ({results.length})
            </button>
            <button
              onClick={() => setActiveTab("statistics")}
              style={{
                padding: "0.75rem 1.5rem",
                border: "none",
                borderBottom:
                  activeTab === "statistics"
                    ? "2px solid #2563eb"
                    : "2px solid transparent",
                backgroundColor: "transparent",
                color: activeTab === "statistics" ? "#60a5fa" : "#9ca3af",
                fontWeight: activeTab === "statistics" ? "600" : "400",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Statistics
            </button>
          </div>

          {/* Tab Content */}
          <div
            style={{ flex: 1, overflow: "auto", backgroundColor: "#111827" }}
          >
            {activeTab === "results" ? (
              <div style={{ display: "flex", height: "100%" }}>
                {/* Results List */}
                <div
                  style={{
                    width: "300px",
                    borderRight: "1px solid #374151",
                    overflowY: "auto",
                    backgroundColor: "#111827",
                  }}
                >
                  <div style={{ padding: "1rem" }}>
                    <h3
                      style={{
                        margin: "0 0 0.75rem 0",
                        fontSize: "1rem",
                        fontWeight: "600",
                        color: "#ededed",
                      }}
                    >
                      Results
                    </h3>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {results.map((result, index) => (
                        <div
                          key={index}
                          onClick={() =>
                            setSelectedResult(
                              selectedResult === index ? null : index
                            )
                          }
                          style={{
                            padding: "0.75rem",
                            border: `1px solid ${
                              selectedResult === index ? "#2563eb" : "#374151"
                            }`,
                            borderRadius: "0.25rem",
                            cursor: "pointer",
                            backgroundColor:
                              selectedResult === index
                                ? "#1e3a8a"
                                : result.success
                                ? "#064e3b"
                                : "#7f1d1d",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: "500",
                              marginBottom: "0.25rem",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              color: "#ededed",
                            }}
                          >
                            <span>
                              #{index + 1} {result.success ? "✓" : "✗"}
                            </span>
                            <span
                              style={{
                                padding: "0.125rem 0.5rem",
                                borderRadius: "0.125rem",
                                backgroundColor:
                                  result.judgeResult.score >= 0.7
                                    ? "#065f46"
                                    : result.judgeResult.score >= 0.5
                                    ? "#78350f"
                                    : "#991b1b",
                                fontSize: "0.65rem",
                                color: "#ededed",
                              }}
                            >
                              {(result.judgeResult.score * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.875rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "#ededed",
                              marginBottom: "0.25rem",
                            }}
                          >
                            {result.prompt}
                          </div>
                          {/* Show filter info if we can infer from prompt */}
                          {(result.prompt.toLowerCase().includes("customer") ||
                            result.prompt.toLowerCase().includes("assigned to") ||
                            result.prompt.toLowerCase().includes("priority") ||
                            result.prompt.includes("2025") ||
                            result.prompt.includes("2026")) && (
                            <div
                              style={{
                                fontSize: "0.65rem",
                                color: "#9ca3af",
                                display: "flex",
                                gap: "0.5rem",
                                flexWrap: "wrap",
                              }}
                            >
                              {result.prompt.toLowerCase().includes("customer") && (
                                <span
                                  style={{
                                    padding: "0.125rem 0.375rem",
                                    borderRadius: "0.125rem",
                                    backgroundColor: "#374151",
                                  }}
                                >
                                  Customer Filter
                                </span>
                              )}
                              {result.prompt.toLowerCase().includes("assigned to") && (
                                <span
                                  style={{
                                    padding: "0.125rem 0.375rem",
                                    borderRadius: "0.125rem",
                                    backgroundColor: "#374151",
                                  }}
                                >
                                  Assignee Filter
                                </span>
                              )}
                              {result.prompt.toLowerCase().includes("priority") && (
                                <span
                                  style={{
                                    padding: "0.125rem 0.375rem",
                                    borderRadius: "0.125rem",
                                    backgroundColor: "#374151",
                                  }}
                                >
                                  Priority Filter
                                </span>
                              )}
                              {(result.prompt.includes("2025") ||
                                result.prompt.includes("2026")) && (
                                <span
                                  style={{
                                    padding: "0.125rem 0.375rem",
                                    borderRadius: "0.125rem",
                                    backgroundColor: "#374151",
                                  }}
                                >
                                  Date Filter
                                </span>
                              )}
                            </div>
                          )}
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#9ca3af",
                              marginTop: "0.25rem",
                            }}
                          >
                            {result.planningResult.needsTools
                              ? `Tools: ${result.toolResults.totalAttempts}`
                              : "No tools"}
                            {" • "}
                            {result.duration}ms
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Selected Result Detail */}
                <div
                  style={{
                    flex: 1,
                    overflow: "auto",
                    padding: "1rem",
                    backgroundColor: "#111827",
                  }}
                >
                  {selectedResult !== null && results[selectedResult] ? (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "1rem",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1.125rem",
                            fontWeight: "600",
                            color: "#ededed",
                          }}
                        >
                          Result #{selectedResult + 1}
                        </h3>
                        <div
                          style={{
                            padding: "0.25rem 0.75rem",
                            borderRadius: "0.25rem",
                            backgroundColor: results[selectedResult].success
                              ? "#065f46"
                              : "#991b1b",
                            color: "#ededed",
                            fontSize: "0.75rem",
                            fontWeight: "500",
                          }}
                        >
                          {results[selectedResult].success
                            ? "Success"
                            : "Failed"}
                        </div>
                      </div>

                      {/* User Prompt Section */}
                      <div
                        style={{
                          marginBottom: "1.5rem",
                          padding: "1rem",
                          backgroundColor: "#1f2937",
                          borderRadius: "0.5rem",
                          border: "1px solid #374151",
                        }}
                      >
                        <h4
                          style={{
                            margin: "0 0 0.75rem 0",
                            fontSize: "1rem",
                            fontWeight: "600",
                            color: "#ededed",
                          }}
                        >
                          User Prompt
                        </h4>
                        <div
                          style={{
                            padding: "0.75rem",
                            backgroundColor: "#374151",
                            borderRadius: "0.25rem",
                            border: "1px solid #4b5563",
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: "0.875rem",
                              lineHeight: "1.6",
                              color: "#ededed",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {results[selectedResult].prompt}
                          </p>
                        </div>
                      </div>

                      {/* Assistant Response Section */}
                      <div
                        style={{
                          marginBottom: "1.5rem",
                          padding: "1rem",
                          backgroundColor: "#1f2937",
                          borderRadius: "0.5rem",
                          border: "1px solid #374151",
                        }}
                      >
                        <h4
                          style={{
                            margin: "0 0 0.75rem 0",
                            fontSize: "1rem",
                            fontWeight: "600",
                            color: "#ededed",
                          }}
                        >
                          Assistant Response
                        </h4>
                        <div
                          style={{
                            padding: "0.75rem",
                            backgroundColor: "#374151",
                            borderRadius: "0.25rem",
                            border: "1px solid #4b5563",
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: "0.875rem",
                              lineHeight: "1.6",
                              color: "#ededed",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {results[selectedResult].toolResults.answer ||
                              (results[selectedResult].planningResult.needsTools
                                ? "No answer generated"
                                : "No tools needed - query was not knowledge base-related")}
                          </p>
                        </div>
                      </div>

                      {/* Judge Evaluation Section */}
                      <div
                        style={{
                          marginBottom: "1.5rem",
                          padding: "1rem",
                          backgroundColor: "#1f2937",
                          borderRadius: "0.5rem",
                          border: "1px solid #374151",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "0.75rem",
                          }}
                        >
                          <h4
                            style={{
                              margin: 0,
                              fontSize: "1rem",
                              fontWeight: "600",
                              color: "#ededed",
                            }}
                          >
                            Judge Evaluation
                          </h4>
                          <div
                            style={{
                              display: "flex",
                              gap: "1rem",
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                padding: "0.25rem 0.75rem",
                                borderRadius: "0.25rem",
                                backgroundColor:
                                  results[selectedResult].judgeResult.score >=
                                  0.7
                                    ? "#065f46"
                                    : results[selectedResult].judgeResult
                                        .score >= 0.5
                                    ? "#78350f"
                                    : "#991b1b",
                                color: "#ededed",
                                fontSize: "0.875rem",
                                fontWeight: "600",
                              }}
                            >
                              Score:{" "}
                              {(
                                results[selectedResult].judgeResult.score * 100
                              ).toFixed(1)}
                              %
                            </span>
                            <span
                              style={{
                                padding: "0.25rem 0.75rem",
                                borderRadius: "0.25rem",
                                backgroundColor: results[selectedResult]
                                  .judgeResult.valid
                                  ? "#065f46"
                                  : "#991b1b",
                                color: "#ededed",
                                fontSize: "0.875rem",
                                fontWeight: "500",
                              }}
                            >
                              {results[selectedResult].judgeResult.valid
                                ? "Valid"
                                : "Invalid"}
                            </span>
                          </div>
                        </div>
                        <div
                          style={{
                            padding: "0.75rem",
                            backgroundColor: "#374151",
                            borderRadius: "0.25rem",
                            border: "1px solid #4b5563",
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: "0.875rem",
                              lineHeight: "1.6",
                              color: "#ededed",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {results[selectedResult].judgeResult.reasoning}
                          </p>
                        </div>
                      </div>

                      <div
                        style={{
                          border: "1px solid #374151",
                          borderRadius: "0.5rem",
                          overflow: "hidden",
                        }}
                      >
                        <ReactJson
                          src={results[selectedResult]}
                          theme="monokai"
                          collapsed={1}
                          displayDataTypes={true}
                          displayObjectSize={true}
                          enableClipboard={false}
                          style={{
                            padding: "1rem",
                            backgroundColor: "#1f2937",
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        color: "#9ca3af",
                        fontSize: "0.875rem",
                      }}
                    >
                      Select a result to view details
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Statistics Tab */
              <div style={{ padding: "2rem", backgroundColor: "#111827" }}>
                {summary ? (
                  <div>
                    <h2
                      style={{
                        margin: "0 0 1.5rem 0",
                        fontSize: "1.5rem",
                        fontWeight: "bold",
                        color: "#ededed",
                      }}
                    >
                      Evaluation Statistics
                    </h2>

                    {/* Overview Cards */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "1rem",
                        marginBottom: "2rem",
                      }}
                    >
                      <div
                        style={{
                          padding: "1.5rem",
                          backgroundColor: "#1f2937",
                          borderRadius: "0.5rem",
                          border: "1px solid #374151",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.875rem",
                            color: "#9ca3af",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Total Prompts
                        </div>
                        <div
                          style={{
                            fontSize: "2rem",
                            fontWeight: "bold",
                            color: "#ededed",
                          }}
                        >
                          {summary.total}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "1.5rem",
                          backgroundColor: "#064e3b",
                          borderRadius: "0.5rem",
                          border: "1px solid #059669",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.875rem",
                            color: "#6ee7b7",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Successful
                        </div>
                        <div
                          style={{
                            fontSize: "2rem",
                            fontWeight: "bold",
                            color: "#34d399",
                          }}
                        >
                          {summary.successful}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#34d399" }}>
                          {((summary.successful / summary.total) * 100).toFixed(
                            1
                          )}
                          %
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "1.5rem",
                          backgroundColor: "#7f1d1d",
                          borderRadius: "0.5rem",
                          border: "1px solid #dc2626",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.875rem",
                            color: "#fca5a5",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Failed
                        </div>
                        <div
                          style={{
                            fontSize: "2rem",
                            fontWeight: "bold",
                            color: "#f87171",
                          }}
                        >
                          {summary.failed}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#f87171" }}>
                          {((summary.failed / summary.total) * 100).toFixed(1)}%
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "1.5rem",
                          backgroundColor: "#1e3a8a",
                          borderRadius: "0.5rem",
                          border: "1px solid #3b82f6",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.875rem",
                            color: "#93c5fd",
                            marginBottom: "0.5rem",
                          }}
                        >
                          With Tools
                        </div>
                        <div
                          style={{
                            fontSize: "2rem",
                            fontWeight: "bold",
                            color: "#60a5fa",
                          }}
                        >
                          {summary.withTools}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#60a5fa" }}>
                          {((summary.withTools / summary.total) * 100).toFixed(
                            1
                          )}
                          %
                        </div>
                      </div>
                    </div>

                    {/* Judge Stats */}
                    <div
                      style={{
                        padding: "1.5rem",
                        backgroundColor: "#1f2937",
                        borderRadius: "0.5rem",
                        border: "1px solid #374151",
                        marginBottom: "2rem",
                      }}
                    >
                      <h3
                        style={{
                          margin: "0 0 1rem 0",
                          fontSize: "1.25rem",
                          fontWeight: "600",
                          color: "#ededed",
                        }}
                      >
                        Judge Evaluation
                      </h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(150px, 1fr))",
                          gap: "1rem",
                        }}
                      >
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Evaluated
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#ededed",
                            }}
                          >
                            {summary.judgeStats.evaluated}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Avg Score
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#ededed",
                            }}
                          >
                            {(summary.judgeStats.avgScore * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Valid
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#34d399",
                            }}
                          >
                            {summary.judgeStats.validCount}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Invalid
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#f87171",
                            }}
                          >
                            {summary.judgeStats.invalidCount}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Performance Stats */}
                    <div
                      style={{
                        padding: "1.5rem",
                        backgroundColor: "#1f2937",
                        borderRadius: "0.5rem",
                        border: "1px solid #374151",
                        marginBottom: "2rem",
                      }}
                    >
                      <h3
                        style={{
                          margin: "0 0 1rem 0",
                          fontSize: "1.25rem",
                          fontWeight: "600",
                          color: "#ededed",
                        }}
                      >
                        Performance
                      </h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(150px, 1fr))",
                          gap: "1rem",
                        }}
                      >
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Avg Duration
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#ededed",
                            }}
                          >
                            {Math.round(summary.avgDuration)}ms
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Avg Attempts
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#ededed",
                            }}
                          >
                            {summary.avgAttempts.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Total Records
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#ededed",
                            }}
                          >
                            {summary.retrievalStats.totalRecords}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{ fontSize: "0.875rem", color: "#9ca3af" }}
                          >
                            Successful Retrievals
                          </div>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: "bold",
                              color: "#34d399",
                            }}
                          >
                            {summary.retrievalStats.successfulRetrievals}
                          </div>
                        </div>
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
                      color: "#9ca3af",
                      fontSize: "0.875rem",
                    }}
                  >
                    No evaluation results yet. Run an evaluation to see
                    statistics.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        select option {
          background-color: #374151;
          color: #ededed;
        }
      `}</style>
    </div>
  );
}
