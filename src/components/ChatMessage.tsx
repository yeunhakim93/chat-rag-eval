import type { ChatMessage } from "@/types/chat";
import MarkdownContent from "./MarkdownContent";

export interface ChatMessageProps {
  message: ChatMessage;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: message.role === "user" ? "flex-end" : "flex-start",
        width: "100%",
      }}
    >
      <div
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "1rem",
          maxWidth: "70%",
          backgroundColor: message.role === "user" ? "#2563eb" : "#374151",
          color: message.role === "user" ? "white" : "#ededed",
          wordWrap: "break-word",
        }}
      >
        <div
          style={{
            fontSize: "0.8rem",
            opacity: 0.7,
            marginBottom: "0.25rem",
          }}
        >
          {message.role === "user" ? "User" : "Assistant"}
        </div>
        {message.role === "assistant" ? (
          <div style={{ lineHeight: "1.6" }}>
            {message.content ? (
              <MarkdownContent content={message.content} />
            ) : (
              <div>
                {message.toolCalls && message.toolCalls.length > 0
                  ? "Processing..."
                  : ""}
              </div>
            )}
          </div>
        ) : (
          <div>{message.content}</div>
        )}
      </div>
    </div>
  );
}
