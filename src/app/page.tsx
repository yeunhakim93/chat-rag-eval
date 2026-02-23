"use client";

import { useState } from "react";
import ToolCallGraph from "@/components/ToolCallGraph";
import ChatMenu from "@/components/ChatMenu";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { AVAILABLE_MODELS } from "@/constants/chat";
import type { ChatFilters } from "@/types/chat";

export default function ChatPage() {
  const [inputValue, setInputValue] = useState(
    "Summarize recent high-priority tickets for Northwind Health"
  );
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [showMenu, setShowMenu] = useState(false);
  const [filters, setFilters] = useState<ChatFilters>({});

  // Custom hooks
  const {
    messages,
    setMessages,
    isLoading,
    sendMessage,
    currentAssistantMessageRef,
  } = useStreamingChat();
  const messagesEndRef = useAutoScroll(messages);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const content = inputValue.trim();
    setInputValue("");
    await sendMessage(content, selectedModel, messages, filters);
  };

  const handleClearChat = () => {
    if (window.confirm("Are you sure you want to clear the chat history?")) {
      setMessages([]);
      currentAssistantMessageRef.current = null;
    }
  };

  const handleExportChat = () => {
    const chatData = {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
      })),
      model: selectedModel,
      exportedAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(chatData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-export-${
      new Date().toISOString().split("T")[0]
    }.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const latestToolCalls =
    messages
      .slice()
      .reverse()
      .find(
        (m) => m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0
      )?.toolCalls || [];

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "Arial, sans-serif",
        backgroundColor: "#0a0a0a",
        color: "#ededed",
      }}
    >
      {/* Left Panel: Chat */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: "0 0 50%",
          maxWidth: "50%",
          minWidth: 0,
          border: "1px solid #374151",
          borderRight: "2px solid #4b5563",
          overflow: "hidden",
          backgroundColor: "#111827",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem",
            backgroundColor: "#1f2937",
            borderBottom: "1px solid #374151",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#ededed" }}
          >
            Chat
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              position: "relative",
            }}
          >
            <label
              style={{
                fontSize: "0.9rem",
                fontWeight: "500",
                color: "#d1d5db",
              }}
            >
              Model:
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading}
              style={{
                padding: "0.25rem 0.5rem",
                border: "1px solid #4b5563",
                borderRadius: "0.25rem",
                fontSize: "0.9rem",
                backgroundColor: "#374151",
                color: "#ededed",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
            <ChatMenu
              isOpen={showMenu}
              onToggle={() => setShowMenu(!showMenu)}
              onClearChat={handleClearChat}
              onExportChat={handleExportChat}
              isLoading={isLoading}
              hasMessages={messages.length > 0}
            />
          </div>
        </div>

        {/* Messages Area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            backgroundColor: "#111827",
          }}
        >
          {messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))}
          {isLoading && <LoadingSpinner message="Assistant is typing..." />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          isLoading={isLoading}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      {/* Right Panel: Agent Workflow Viewer */}
      <div
        style={{
          flex: "0 0 50%",
          maxWidth: "50%",
          minWidth: 0,
          border: "1px solid #374151",
          borderLeft: "none",
          overflow: "hidden",
          backgroundColor: "#111827",
        }}
      >
        <ToolCallGraph toolCalls={latestToolCalls} />
      </div>
    </div>
  );
}
