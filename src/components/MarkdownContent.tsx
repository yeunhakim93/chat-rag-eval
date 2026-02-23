import ReactMarkdown from "react-markdown";

export interface MarkdownContentProps {
  content: string;
}

export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={{
        code: ({ node, inline, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <pre
              style={{
                backgroundColor: "#1f2937",
                padding: "0.75rem",
                borderRadius: "0.25rem",
                overflowX: "auto",
                margin: "0.5rem 0",
                border: "1px solid #374151",
              }}
            >
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  color: "#ededed",
                }}
                {...props}
              >
                {children}
              </code>
            </pre>
          ) : (
            <code
              style={{
                backgroundColor: "#374151",
                padding: "0.125rem 0.25rem",
                borderRadius: "0.125rem",
                fontFamily: "monospace",
                fontSize: "0.875rem",
                color: "#ededed",
              }}
              {...props}
            >
              {children}
            </code>
          );
        },
        p: ({ children }) => (
          <p style={{ margin: "0.5rem 0", lineHeight: "1.6" }}>{children}</p>
        ),
        ul: ({ children }) => (
          <ul
            style={{
              margin: "0.5rem 0",
              paddingLeft: "1.5rem",
            }}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            style={{
              margin: "0.5rem 0",
              paddingLeft: "1.5rem",
            }}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li style={{ margin: "0.25rem 0" }}>{children}</li>
        ),
        h1: ({ children }) => (
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              margin: "0.75rem 0",
            }}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: "bold",
              margin: "0.75rem 0",
            }}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            style={{
              fontSize: "1.125rem",
              fontWeight: "bold",
              margin: "0.5rem 0",
            }}
          >
            {children}
          </h3>
        ),
        blockquote: ({ children }) => (
          <blockquote
            style={{
              borderLeft: "3px solid #4b5563",
              paddingLeft: "1rem",
              margin: "0.5rem 0",
              fontStyle: "italic",
              color: "#9ca3af",
            }}
          >
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#60a5fa",
              textDecoration: "underline",
            }}
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              margin: "0.5rem 0",
            }}
          >
            {children}
          </table>
        ),
        th: ({ children }) => (
          <th
            style={{
              border: "1px solid #4b5563",
              padding: "0.5rem",
              backgroundColor: "#374151",
              fontWeight: "bold",
              color: "#ededed",
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            style={{
              border: "1px solid #4b5563",
              padding: "0.5rem",
              color: "#ededed",
            }}
          >
            {children}
          </td>
        ),
        hr: () => (
          <hr
            style={{
              margin: "1rem 0",
              border: "none",
              borderTop: "1px solid #4b5563",
            }}
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
