import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearchBar } from "./GlobalSearchBar";
import type { GroupedResults } from "../types/search";

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyResults: GroupedResults = {
  Merchants: [],
  Payments: [],
  Customers: [],
};

const sampleResults: GroupedResults = {
  Merchants: [{ id: "m1", type: "Merchant", title: "Acme Store", subtitle: "acme@store.com" }],
  Payments: [{ id: "p1", type: "Payment", title: "ORDER_001", subtitle: "$100" }],
  Customers: [{ id: "c1", type: "Customer", title: "Alice Smith" }],
};

function makeSearch(result = sampleResults) {
  return jest.fn().mockResolvedValue(result);
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("renders search input", () => {
  render(<GlobalSearchBar onSearch={makeSearch()} />);
  expect(screen.getByRole("combobox")).toBeInTheDocument();
});

test("debounces API calls by 300ms minimum", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.change(input, { target: { value: "ac" } });
  fireEvent.change(input, { target: { value: "acm" } });

  // Not called yet
  expect(onSearch).not.toHaveBeenCalled();

  act(() => { jest.advanceTimersByTime(300); });
  await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
  expect(onSearch).toHaveBeenCalledWith("acm");
});

test("fires query only once within the debounce window", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.change(input, { target: { value: "ac" } });
  fireEvent.change(input, { target: { value: "acm" } });
  fireEvent.change(input, { target: { value: "acme" } });

  // Still inside the debounce window — no query yet
  act(() => { jest.advanceTimersByTime(299); });
  expect(onSearch).not.toHaveBeenCalled();

  // Window elapses — exactly one query for the final value
  act(() => { jest.advanceTimersByTime(1); });
  await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
  expect(onSearch).toHaveBeenCalledWith("acme");

  // Further time passing does not trigger additional queries
  act(() => { jest.advanceTimersByTime(1000); });
  expect(onSearch).toHaveBeenCalledTimes(1);
});

test("shows in-flight indicator while search is pending", async () => {
  let resolveSearch: (value: GroupedResults) => void = () => {};
  const onSearch = jest.fn(
    () => new Promise<GroupedResults>((resolve) => { resolveSearch = resolve; }),
  );
  render(<GlobalSearchBar onSearch={onSearch} />);

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "acme" } });
  act(() => { jest.advanceTimersByTime(300); });

  // Query fired but promise unresolved — in-flight status visible
  await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/searching/i);

  // Resolve the promise — indicator disappears
  await act(async () => { resolveSearch(sampleResults); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows results grouped by Merchants, Payments, Customers", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "acm" } });
  act(() => { jest.advanceTimersByTime(300); });
  await waitFor(() => expect(onSearch).toHaveBeenCalled());
  // Resolve the promise
  await act(async () => {});

  expect(screen.getByText("Merchants")).toBeInTheDocument();
  expect(screen.getByText("Payments")).toBeInTheDocument();
  expect(screen.getByText("Customers")).toBeInTheDocument();
  expect(screen.getByText("Acme Store")).toBeInTheDocument();
  expect(screen.getByText("ORDER_001")).toBeInTheDocument();
  expect(screen.getByText("Alice Smith")).toBeInTheDocument();
});

test("highlights matched text in results", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Acme" } });
  act(() => { jest.advanceTimersByTime(300); });
  await act(async () => {});

  // The title "Acme Store" should contain a <mark> around "Acme"
  const mark = document.querySelector("mark.search-highlight");
  expect(mark).not.toBeNull();
  expect(mark?.textContent).toBe("Acme");
});

test("keyboard navigation: ArrowDown/Up moves active option", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "acme" } });
  act(() => { jest.advanceTimersByTime(300); });
  await act(async () => {});

  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /acme store/i })).toHaveAttribute("aria-selected", "true");

  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /order_001/i })).toHaveAttribute("aria-selected", "true");
});

test("Escape closes the dropdown", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "acme" } });
  act(() => { jest.advanceTimersByTime(300); });
  await act(async () => {});

  expect(screen.getByRole("listbox")).toBeInTheDocument();

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("shows recent searches when input is empty", async () => {
  // Pre-populate history
  localStorage.setItem(
    "pulsar_search_history",
    JSON.stringify(["ORDER_001", "Alice"]),
  );

  render(<GlobalSearchBar onSearch={makeSearch(emptyResults)} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);

  expect(screen.getByText("Recent searches")).toBeInTheDocument();
  expect(screen.getByText("ORDER_001")).toBeInTheDocument();
  expect(screen.getByText("Alice")).toBeInTheDocument();
});

test("search history is persisted to localStorage on submit", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "acme" } });
  act(() => { jest.advanceTimersByTime(300); });
  await act(async () => {});

  // Submit via Enter key
  fireEvent.keyDown(input, { key: "Enter" });

  const stored = JSON.parse(localStorage.getItem("pulsar_search_history") ?? "[]");
  expect(stored).toContain("acme");
});

test("partial terms are not stored in search history", async () => {
  const onSearch = makeSearch();
  render(<GlobalSearchBar onSearch={onSearch} />);

  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "G" } });
  fireEvent.change(input, { target: { value: "GA" } });
  fireEvent.change(input, { target: { value: "GAT" } });

  // Advance past the debounce window without submitting
  act(() => { jest.advanceTimersByTime(1000); });
  await act(async () => {});

  const storedAfterTyping = JSON.parse(
    localStorage.getItem("pulsar_search_history") ?? "[]",
  );
  expect(storedAfterTyping).not.toContain("G");
  expect(storedAfterTyping).not.toContain("GA");
  expect(storedAfterTyping).not.toContain("GAT");

  // Now submit the full query
  fireEvent.keyDown(input, { key: "Enter" });

  const storedAfterSubmit = JSON.parse(
    localStorage.getItem("pulsar_search_history") ?? "[]",
  );
  expect(storedAfterSubmit).toContain("GAT");
  expect(storedAfterSubmit).not.toContain("G");
  expect(storedAfterSubmit).not.toContain("GA");
});

test("shows 'No results' message when search returns empty", async () => {
  const onSearch = makeSearch(emptyResults);
  render(<GlobalSearchBar onSearch={onSearch} />);

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "xyz" } });
  act(() => { jest.advanceTimersByTime(300); });
  await act(async () => {});

  expect(screen.getByText(/no results for/i)).toBeInTheDocument();
});
