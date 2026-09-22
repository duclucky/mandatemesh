import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('MandateMesh product shell', () => {
  it('gives a visitor a value-first entry and an accessible route to start a round', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /fund plans, not private decisions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start a round/i })).toHaveAttribute('href', '/rounds/new');
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });
});
