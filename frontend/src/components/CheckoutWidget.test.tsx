import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---- Mocks for @stellar/stellar-sdk ----
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue('unsigned-xdr') }),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({}),
    })),
    nativeToScVal: jest.fn().mockReturnValue({}),
    Address: jest.fn().mockImplementation(() => ({ toScVal: jest.fn().mockReturnValue({}) })),
    Networks: {
      ...actual.Networks,
      TESTNET: 'Test SDF Network ; September 2015',
    },
    BASE_FEE: '100',
    Account: jest.fn().mockImplementation(() => ({})),
    Transaction: jest.fn().mockImplementation(() => ({
      toXDR: jest.fn().mockReturnValue('signed-xdr'),
    })),
  };
});

// ---- Mock Freighter ----
const mockRequestAccess = jest.fn();
const mockGetPublicKey = jest.fn();
const mockSignTransaction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (window as any).freighter = {
    requestAccess: mockRequestAccess,
    getPublicKey: mockGetPublicKey,
    signTransaction: mockSignTransaction,
  };
  mockRequestAccess.mockResolvedValue({ error: null });
  mockGetPublicKey.mockResolvedValue('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV');
  mockSignTransaction.mockResolvedValue({
    signedXDR: 'signed-xdr',
    error: null,
  });
});

afterEach(() => {
  delete (window as any).freighter;
});

// Import after mocks are set up
import CheckoutWidget from './CheckoutWidget';

describe('CheckoutWidget submitPayment', () => {
  const defaultProps = {
    merchantId: 'merchant-1',
    amount: '10.00',
    asset: 'XLM',
    destination: 'GDESTINATIONADDRESS234567ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    onSuccess: jest.fn(),
    onError: jest.fn(),
  };

  it('builds, prepares, signs, sends, polls, and returns the transaction hash', async () => {
    const preparedTx = {
      toXDR: jest.fn().mockReturnValue('prepared-xdr'),
    };
    mockPrepareTransaction.mockResolvedValue(preparedTx);
    mockSendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'tx-hash-123',
    });
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      hash: 'tx-hash-123',
    });

    const onSuccess = jest.fn();
    render(<CheckoutWidget {...defaultProps} onSuccess={onSuccess} />);

    const payButton = screen.getByRole('button', { name: /pay now/i });
    fireEvent.click(payButton);

    await waitFor(() => {
      expect(mockPrepareTransaction).toHaveBeenCalledTimes(1);
    });

    expect(mockSignTransaction).toHaveBeenCalledWith('prepared-xdr', {
      network: expect.any(String),
    });

    await waitFor(() => {
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockGetTransaction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('tx-hash-123');
    });
  });

  it('polls transaction status until confirmed', async () => {
    const preparedTx = {
      toXDR: jest.fn().mockReturnValue('prepared-xdr'),
    };
    mockPrepareTransaction.mockResolvedValue(preparedTx);
    mockSendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'tx-hash-456',
    });
    mockGetTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND', hash: 'tx-hash-456' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND', hash: 'tx-hash-456' })
      .mockResolvedValueOnce({ status: 'SUCCESS', hash: 'tx-hash-456' });

    const onSuccess = jest.fn();
    render(<CheckoutWidget {...defaultProps} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(
      () => {
        expect(onSuccess).toHaveBeenCalledWith('tx-hash-456');
      },
      { timeout: 10000 }
    );

    expect(mockGetTransaction.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('calls onError when the SDK call fails', async () => {
    mockPrepareTransaction.mockRejectedValue(new Error('SDK failure'));

    const onError = jest.fn();
    render(<CheckoutWidget {...defaultProps} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const errorArg = onError.mock.calls[0][0];
    expect(String(errorArg)).toMatch(/SDK failure/);
  });

  it('calls onError when sendTransaction fails', async () => {
    const preparedTx = {
      toXDR: jest.fn().mockReturnValue('prepared-xdr'),
    };
    mockPrepareTransaction.mockResolvedValue(preparedTx);
    mockSendTransaction.mockRejectedValue(new Error('send failed'));

    const onError = jest.fn();
    render(<CheckoutWidget {...defaultProps} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const errorArg = onError.mock.calls[0][0];
    expect(String(errorArg)).toMatch(/send failed/);
  });

  it('calls onError when the transaction fails on-chain', async () => {
    const preparedTx = {
      toXDR: jest.fn().mockReturnValue('prepared-xdr'),
    };
    mockPrepareTransaction.mockResolvedValue(preparedTx);
    mockSendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'tx-hash-789',
    });
    mockGetTransaction.mockResolvedValue({
      status: 'FAILED',
      hash: 'tx-hash-789',
    });

    const onError = jest.fn();
    render(<CheckoutWidget {...defaultProps} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(
      () => {
        expect(onError).toHaveBeenCalled();
      },
      { timeout: 10000 }
    );
  });

  it('calls onError when Freighter signing fails', async () => {
    const preparedTx = {
      toXDR: jest.fn().mockReturnValue('prepared-xdr'),
    };
    mockPrepareTransaction.mockResolvedValue(preparedTx);
    mockSignTransaction.mockResolvedValue({
      signedXDR: null,
      error: 'User rejected',
    });

    const onError = jest.fn();
    render(<CheckoutWidget {...defaultProps} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });
});