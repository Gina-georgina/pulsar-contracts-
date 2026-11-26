import React, { useState, useEffect, useCallback } from 'react';
import ErrorBoundary from './ErrorBoundary';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || '';

function RefundManagerContent() {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/refunds`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to load refunds (status ${response.status})`);
      }
      const data = await response.json();
      setRefunds(Array.isArray(data) ? data : data.refunds || []);
    } catch (err) {
      setError(err.message || 'Unable to load refunds.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  const handleProcessRefund = async (refundId) => {
    setProcessingId(refundId);
    try {
      const response = await fetch(`${API_BASE}/api/refunds/${refundId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to process refund (status ${response.status})`);
      }
      setRefunds((prev) =>
        prev.map((refund) =>
          refund.id === refundId ? { ...refund, status: 'processed' } : refund
        )
      );
    } catch (err) {
      setError(err.message || 'Unable to process refund.');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="refund-manager" role="status" aria-live="polite">
        <p>Loading refunds…</p>
      </div>
    );
  }

  return (
    <div className="refund-manager">
      <header className="refund-manager__header">
        <h1>Refund Manager</h1>
        <button type="button" onClick={fetchRefunds}>
          Refresh
        </button>
      </header>

      {error && (
        <div className="refund-manager__error" role="alert">
          {error}
        </div>
      )}

      {refunds.length === 0 ? (
        <p className="refund-manager__empty">No refunds to display.</p>
      ) : (
        <table className="refund-manager__table">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Payer</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((refund) => (
              <tr key={refund.id}>
                <td>{refund.id}</td>
                <td>{refund.payer}</td>
                <td>{refund.amount}</td>
                <td>{refund.status}</td>
                <td>
                  {refund.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => handleProcessRefund(refund.id)}
                      disabled={processingId === refund.id}
                    >
                      {processingId === refund.id ? 'Processing…' : 'Process'}
                    </button>
                  ) : (
                    <span>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function RefundManager() {
  return (
    <ErrorBoundary>
      <RefundManagerContent />
    </ErrorBoundary>
  );
}