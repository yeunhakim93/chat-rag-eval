export interface LoadingSpinnerProps {
  message?: string;
  size?: number;
}

export default function LoadingSpinner({
  message = "Loading...",
  size = 20,
}: LoadingSpinnerProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        color: "#9ca3af",
      }}
    >
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: "2px solid #374151",
          borderTop: "2px solid #2563eb",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      {message}
    </div>
  );
}
