import React, { useEffect, useState } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

interface CopyButtonProps {
  /** The text to copy to clipboard */
  text: string;
  /** Optional accessible label (defaults to "Copy") */
  label?: string;
  /** Optional CSS class name */
  className?: string;
}

/**
 * A keyboard-accessible copy-to-clipboard button.
 * Shows a success state after copying and a fallback for unsupported browsers.
 */
export function CopyButton({ text, label = "Copy", className = "" }: CopyButtonProps) {
  const { copy, status } = useCopyToClipboard();
  const [announcement, setAnnouncement] = useState("");

  const isCopied = status === "copied";
  const isError = status === "error";

  useEffect(() => {
    if (isCopied) {
      setAnnouncement("Copied to clipboard");
    } else if (isError) {
      setAnnouncement("Copy failed");
    } else {
      setAnnouncement("");
      return;
    }

    const timeoutId = setTimeout(() => {
      setAnnouncement("");
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [isCopied, isError]);

  return (
    <>
      <button
        type="button"
        onClick={() => copy(text)}
        aria-label={isCopied ? "Copied!" : isError ? "Copy failed" : label}
        title={isCopied ? "Copied!" : isError ? "Copy failed" : label}
        className={`copy-button copy-button--${status} ${className}`.trim()}
      >
        {isCopied ? (
          // Checkmark icon — indicates success
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 8l3.5 3.5L13 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          // Copy icon
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="5"
              y="5"
              width="8"
              height="9"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M3 11V3a1 1 0 011-1h7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span className="copy-button__label">{isCopied ? "Copied!" : isError ? "Failed" : label}</span>
      </button>

      {/* Live region so screen readers announce the copy result */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
