import React, { useState } from "react";
import type { PaymentFilter } from "../contract";

export function isDateRangeValid(filter: PaymentFilter): boolean {
  if (!filter.date_start || !filter.date_end) return true;
  return filter.date_end >= filter.date_start;
}

interface Props {
  filter: PaymentFilter;
  sortField: "Date" | "Amount";
  sortOrder: "Ascending" | "Descending";
  onChange: (f: PaymentFilter) => void;
  onSortField: (f: "Date" | "Amount") => void;
  onSortOrder: (o: "Ascending" | "Descending") => void;
}

export function FilterBar({ filter, sortField, sortOrder, onChange, onSortField, onSortOrder }: Props) {
  const [dateError, setDateError] = useState<string | null>(null);

  const handleFilterChange = (next: PaymentFilter) => {
    if (!isDateRangeValid(next)) {
      setDateError("End date must be on or after start date.");
      return;
    }
    setDateError(null);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <label>
        Status&nbsp;
        <select
          value={filter.status ?? "Any"}
          onChange={(e) => handleFilterChange({ ...filter, status: e.target.value as PaymentFilter["status"] })}
        >
          {["Any", "Completed", "PartiallyRefunded", "FullyRefunded"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>

      <label>
        Min amount&nbsp;
        <input
          type="number"
          value={filter.amount_min ?? ""}
          onChange={(e) => handleFilterChange({ ...filter, amount_min: e.target.value ? Number(e.target.value) : undefined })}
          style={{ width: 90 }}
        />
      </label>

      <label>
        Max amount&nbsp;
        <input
          type="number"
          value={filter.amount_max ?? ""}
          onChange={(e) => handleFilterChange({ ...filter, amount_max: e.target.value ? Number(e.target.value) : undefined })}
          style={{ width: 90 }}
        />
      </label>

      <label>
        Start date&nbsp;
        <input
          type="date"
          value={filter.date_start ?? ""}
          onChange={(e) => handleFilterChange({ ...filter, date_start: e.target.value || undefined })}
        />
      </label>

      <label>
        End date&nbsp;
        <input
          type="date"
          value={filter.date_end ?? ""}
          onChange={(e) => handleFilterChange({ ...filter, date_end: e.target.value || undefined })}
        />
      </label>

      {dateError && (
        <div role="alert" style={{ color: "#c00", flexBasis: "100%" }}>
          {dateError}
        </div>
      )}

      <label>
        Sort by&nbsp;
        <select value={sortField} onChange={(e) => onSortField(e.target.value as "Date" | "Amount")}>
          <option>Date</option>
          <option>Amount</option>
        </select>
      </label>

      <label>
        Order&nbsp;
        <select value={sortOrder} onChange={(e) => onSortOrder(e.target.value as "Ascending" | "Descending")}>
          <option>Descending</option>
          <option>Ascending</option>
        </select>
      </label>
    </div>
  );
}
