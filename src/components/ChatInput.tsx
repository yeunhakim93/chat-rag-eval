"use client";

import { useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import type { ChatFilters } from "@/types/chat";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
  placeholder?: string;
  filters?: ChatFilters;
  onFiltersChange?: (filters: ChatFilters) => void;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
  placeholder = "Type your message...",
  filters,
  onFiltersChange,
}: ChatInputProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(filters?.customer || "");
  const [localAssignedTo, setLocalAssignedTo] = useState(
    filters?.assignedTo || ""
  );
  const [localPriority, setLocalPriority] = useState(filters?.priority || "");
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    filters?.dateRange?.startDate || null,
    filters?.dateRange?.endDate || null,
  ]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newCustomer = e.target.value;
    setLocalCustomer(newCustomer);
    if (onFiltersChange) {
      onFiltersChange({
        ...filters,
        customer: newCustomer.trim() || undefined,
        assignedTo: localAssignedTo.trim() || undefined,
        priority: localPriority.trim() || undefined,
      });
    }
  };

  const handleAssignedToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAssignedTo = e.target.value;
    setLocalAssignedTo(newAssignedTo);
    if (onFiltersChange) {
      onFiltersChange({
        ...filters,
        customer: localCustomer.trim() || undefined,
        assignedTo: newAssignedTo.trim() || undefined,
        priority: localPriority.trim() || undefined,
      });
    }
  };

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPriority = e.target.value;
    setLocalPriority(newPriority);
    if (onFiltersChange) {
      onFiltersChange({
        ...filters,
        customer: localCustomer.trim() || undefined,
        assignedTo: localAssignedTo.trim() || undefined,
        priority: newPriority || undefined,
      });
    }
  };

  const handleDateRangeChange = (dates: [Date | null, Date | null]) => {
    setDateRange(dates);
    if (onFiltersChange) {
      // Create dateRange if at least one date exists
      const newDateRange =
        dates[0] || dates[1]
          ? {
              ...(dates[0] && { startDate: dates[0] }),
              ...(dates[1] && { endDate: dates[1] }),
            }
          : undefined;

      onFiltersChange({
        ...filters,
        customer: localCustomer.trim() || undefined,
        assignedTo: localAssignedTo.trim() || undefined,
        priority: localPriority.trim() || undefined,
        dateRange: newDateRange,
      });
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid #374151",
        backgroundColor: "#1f2937",
      }}
    >
      {showFilters && (
        <div
          style={{
            padding: "1rem",
            borderBottom: "1px solid #374151",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            backgroundColor: "#1f2937",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                minWidth: "200px",
              }}
            >
              <label
                style={{
                  fontSize: "0.875rem",
                  color: "#d1d5db",
                  fontWeight: "500",
                }}
              >
                Customer (optional)
              </label>
              <input
                type="text"
                value={localCustomer}
                onChange={handleCustomerChange}
                placeholder="e.g., Northwind Health"
                disabled={isLoading}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  backgroundColor: "#374151",
                  color: "#ededed",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                minWidth: "200px",
              }}
            >
              <label
                style={{
                  fontSize: "0.875rem",
                  color: "#d1d5db",
                  fontWeight: "500",
                }}
              >
                Assigned To (optional)
              </label>
              <input
                type="text"
                value={localAssignedTo}
                onChange={handleAssignedToChange}
                placeholder="e.g., Ava Patel"
                disabled={isLoading}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  backgroundColor: "#374151",
                  color: "#ededed",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                minWidth: "140px",
              }}
            >
              <label
                style={{
                  fontSize: "0.875rem",
                  color: "#d1d5db",
                  fontWeight: "500",
                }}
              >
                Priority (optional)
              </label>
              <select
                value={localPriority}
                onChange={handlePriorityChange}
                disabled={isLoading}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #4b5563",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  backgroundColor: "#374151",
                  color: "#ededed",
                }}
              >
                <option value="">Any</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                minWidth: "300px",
              }}
            >
              <label
                style={{
                  fontSize: "0.875rem",
                  color: "#d1d5db",
                  fontWeight: "500",
                }}
              >
                Date Range (optional)
              </label>
              <DatePicker
                selected={dateRange[0]}
                onChange={handleDateRangeChange}
                startDate={dateRange[0]}
                endDate={dateRange[1]}
                selectsRange
                isClearable
                disabled={isLoading}
                placeholderText="Select date range"
                dateFormat="MM/dd/yyyy"
                wrapperClassName="date-picker-wrapper"
              />
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          padding: "1rem",
          display: "flex",
          gap: "0.5rem",
        }}
      >
        <button
          onClick={() => setShowFilters(!showFilters)}
          disabled={isLoading}
          style={{
            padding: "0.5rem",
            backgroundColor: showFilters ? "#2563eb" : "#374151",
            color: "white",
            border: "1px solid #4b5563",
            borderRadius: "0.25rem",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontSize: "0.875rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "60px",
          }}
          title="Toggle filters"
        >
          {showFilters ? "Hide" : "Filters"}
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "0.5rem",
            border: "1px solid #4b5563",
            borderRadius: "0.25rem",
            fontSize: "1rem",
            backgroundColor: "#374151",
            color: "#ededed",
          }}
        />
        <button
          onClick={onSend}
          disabled={isLoading || !value.trim()}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: isLoading || !value.trim() ? "#4b5563" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "0.25rem",
            cursor: isLoading || !value.trim() ? "not-allowed" : "pointer",
            fontSize: "1rem",
          }}
        >
          Send
        </button>
      </div>
      <style jsx global>{`
        .date-picker-wrapper {
          width: 100%;
        }
        .react-datepicker-wrapper {
          width: 100%;
        }
        .react-datepicker__input-container input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #4b5563;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          background-color: #374151;
          color: #ededed;
        }
        .react-datepicker__input-container input:focus {
          outline: none;
          border-color: #2563eb;
        }
        .react-datepicker {
          font-family: Arial, sans-serif;
          background-color: #1f2937;
          border: 1px solid #4b5563;
        }
        .react-datepicker__header {
          background-color: #374151;
          border-bottom: 1px solid #4b5563;
        }
        .react-datepicker__current-month {
          color: #ededed;
        }
        .react-datepicker__day-name {
          color: #d1d5db;
        }
        .react-datepicker__day {
          color: #ededed;
        }
        .react-datepicker__day:hover {
          background-color: #4b5563;
        }
        .react-datepicker__day--selected,
        .react-datepicker__day--in-range {
          background-color: #2563eb;
        }
        .react-datepicker__day--in-selecting-range {
          background-color: #3b82f6;
        }
      `}</style>
    </div>
  );
}
