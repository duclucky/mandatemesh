import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./genlayer', () => ({
  contractAddress: '0xD267BF7A3d45F7cfbB321D9dCe6A05e6B8173057',
  connectWallet: vi.fn(),
  discoverWallets: vi.fn().mockResolvedValue([]),
  readRound: vi.fn().mockResolvedValue(JSON.stringify({
    round_id: 'round-1',
    phase: 'OPEN',
    proposal_deadline: '1790153040',
    recovery_deadline: '1790239440',
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

  it('gives a visitor a value-first entry and an accessible route to start a round', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /fund plans, not private decisions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start a round/i })).toHaveAttribute('href', '/rounds/new');
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });

  it('renders canonical round data as a human-readable card instead of raw JSON', async () => {
    window.history.pushState({}, '', '/rounds');
    render(<App />);

    fireEvent.change(screen.getByLabelText('Round ID'), { target: { value: 'round-1' } });
    fireEvent.click(screen.getByRole('button', { name: /load canonical state/i }));

    expect(await screen.findByRole('heading', { name: 'round-1' })).toBeInTheDocument();
    expect(screen.getByText('Open for proposals')).toBeInTheDocument();
    expect(screen.getByText('2 GEN')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/"round_id"/)).not.toBeInTheDocument());
  });
});
