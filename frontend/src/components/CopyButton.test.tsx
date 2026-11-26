import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

// ── Clipboard API mock ────────────────────────────────────────────────────────

const mockWriteText = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(navigator, {
    clipboard: { writeText: mockWriteText },
  });
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("renders copy button with icon", () => {
  render(<CopyButton text="abc123" />);
  expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
});

test("shows 'Copied!' and live region after successful copy", async () => {
  mockWriteText.mockResolvedValue(undefined);
  render(<CopyButton text="abc123" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
});

test("clears the live region announcement after 2 s", async () => {
  mockWriteText.mockResolvedValue(undefined);
  render(<CopyButton text="abc123" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  const liveRegion = screen.getByRole("status");
  expect(liveRegion).toHaveTextContent("Copied to clipboard");

  act(() => {
    jest.advanceTimersByTime(2000);
  });

  expect(screen.getByRole("status")).toHaveTextContent("");
});

test("shows error state when clipboard write fails", async () => {
  mockWriteText.mockRejectedValue(new Error("denied"));
  render(<CopyButton text="abc123" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  expect(screen.getByRole("button", { name: /copy failed/i })).toBeInTheDocument();
});

test("resets to idle after resetDelay", async () => {
  mockWriteText.mockResolvedValue(undefined);
  render(<CopyButton text="abc123" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
});

test("falls back to execCommand when clipboard API is absent", async () => {
  // Remove clipboard API
  Object.assign(navigator, { clipboard: undefined });
  const execSpy = jest.spyOn(document, "execCommand").mockReturnValue(true);

  render(<CopyButton text="fallback" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  expect(execSpy).toHaveBeenCalledWith("copy");
  expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  execSpy.mockRestore();
});

test("is keyboard accessible via Enter key", async () => {
  mockWriteText.mockResolvedValue(undefined);
  render(<CopyButton text="kbd" />);

  const btn = screen.getByRole("button");
  btn.focus();
  await act(async () => {
    fireEvent.keyDown(btn, { key: "Enter", code: "Enter" });
    fireEvent.click(btn); // buttons fire click on Enter natively
  });

  expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
});
