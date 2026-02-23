import { useRef, useEffect } from "react";

interface ChatMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClearChat: () => void;
  onExportChat: () => void;
  isLoading: boolean;
  hasMessages: boolean;
}

export default function ChatMenu({
  isOpen,
  onToggle,
  onClearChat,
  onExportChat,
  isLoading,
  hasMessages,
}: ChatMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onToggle();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onToggle]);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={onToggle}
        disabled={isLoading}
        style={{
          padding: "0.25rem 0.5rem",
          border: "1px solid #4b5563",
          borderRadius: "0.25rem",
          fontSize: "0.9rem",
          backgroundColor: isOpen ? "#4b5563" : "#374151",
          color: "#d1d5db",
          cursor: isLoading ? "not-allowed" : "pointer",
          opacity: isLoading ? 0.6 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "28px",
          transition: "background-color 0.2s",
        }}
        onMouseEnter={(e) => {
          if (!isLoading) {
            e.currentTarget.style.backgroundColor = "#4b5563";
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.backgroundColor = "#374151";
          }
        }}
        title="More options"
      >
        <span style={{ fontSize: "1.2rem", lineHeight: "1" }}>⋮</span>
      </button>
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "0.25rem",
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: "0.25rem",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
            minWidth: "150px",
            zIndex: 1000,
          }}
        >
          <button
            onClick={() => {
              onClearChat();
              onToggle();
            }}
            disabled={isLoading || !hasMessages}
            style={{
              width: "100%",
              padding: "0.5rem 1rem",
              border: "none",
              backgroundColor: "transparent",
              color: !hasMessages ? "#6b7280" : "#ef4444",
              cursor: isLoading || !hasMessages ? "not-allowed" : "pointer",
              textAlign: "left",
              fontSize: "0.9rem",
              borderBottom: "1px solid #374151",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isLoading && hasMessages) {
                e.currentTarget.style.backgroundColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Clear Chat
          </button>
          <button
            onClick={() => {
              onExportChat();
              onToggle();
            }}
            disabled={isLoading || !hasMessages}
            style={{
              width: "100%",
              padding: "0.5rem 1rem",
              border: "none",
              backgroundColor: "transparent",
              color: !hasMessages ? "#6b7280" : "#10b981",
              cursor: isLoading || !hasMessages ? "not-allowed" : "pointer",
              textAlign: "left",
              fontSize: "0.9rem",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isLoading && hasMessages) {
                e.currentTarget.style.backgroundColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Export Chat
          </button>
        </div>
      )}
    </div>
  );
}
