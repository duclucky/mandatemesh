import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { readRound } from './genlayer';

vi.mock('./genlayer', () => ({
  contractAddress: '0x78BdB37D788905801aa1b6e4CC2f4C2B2d19B249',
  connectWallet: vi.fn(),
  discoverWallets: vi.fn().mockResolvedValue([]),
  readRound: vi.fn().mockResolvedValue(JSON.stringify({
    round_id: 'round-1',
    phase: 'OPEN',
    proposal_deadline: String(Math.floor(Date.now() / 1000) + 3600),
    recovery_deadline: String(Math.floor(Date.now() / 1000) + 7200),
    submitted_count: 1,
    attempt_count: 0,
    remaining_liability: '2000000000000000000',
    sponsor_credit: '0',
  })),
  useMandateKit: vi.fn(() => null),
}));

describe('MandateMesh product shell', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('gives a visitor a value-first entry and an accessible route to start a round', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /fund plans, not private decisions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start a round/i })).toHaveAttribute('href', '/rounds/new');
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });

  it('defaults a new test round to a short, clearly ordered lifecycle window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T08:00:00'));
    window.history.pushState({}, '', '/rounds/new');
    render(<App />);

    const deadlines = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(deadlines[0]).toHaveValue('2026-09-22T08:05');
    expect(deadlines[1]).toHaveValue('2026-09-22T08:10');
  });

  it('renders canonical round data as a human-readable card instead of raw JSON', async () => {
    window.history.pushState({}, '', '/rounds');
    render(<App />);

    fireEvent.change(screen.getByLabelText('Round ID'), { target: { value: 'round-1' } });
    fireEvent.click(screen.getByRole('button', { name: /load canonical state/i }));

    expect(await screen.findByRole('heading', { name: 'round-1' })).toBeInTheDocument();
    expect(screen.getByText('Open for proposals')).toBeInTheDocument();
    expect(screen.getByText('2 GEN')).toBeInTheDocument();
    expect(screen.getByLabelText('Planning proposal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect wallet to submit' })).toBeDisabled();
    await waitFor(() => expect(screen.queryByText(/"round_id"/)).not.toBeInTheDocument());
  });

  it('does not offer a sponsor withdrawal after the credit has been withdrawn', async () => {
    vi.mocked(readRound).mockResolvedValueOnce(JSON.stringify({
      round_id: 'closed-round',
      phase: 'EXPIRED_REFUNDED',
      proposal_deadline: '1790153040',
      recovery_deadline: '1790239440',
      submitted_count: 0,
      attempt_count: 0,
      remaining_liability: '0',
      sponsor_credit: '0',
    }));
    window.history.pushState({}, '', '/rounds');
    render(<App />);

    fireEvent.change(screen.getByLabelText('Round ID'), { target: { value: 'closed-round' } });
    fireEvent.click(screen.getByRole('button', { name: /load canonical state/i }));

    expect(await screen.findByText('Sponsor credit has already been withdrawn.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw sponsor credit' })).not.toBeInTheDocument();
  });
});
