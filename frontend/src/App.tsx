import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Timeline, useTransactionFlow, type TrackedStatus } from '@genlayer/transaction-kit-react';
import { Landmark, Menu, Wallet, X } from 'lucide-react';
import { connectWallet, contractAddress, discoverWallets, readRound, type WalletChoice, useMandateKit } from './genlayer';

const twoGen = 2_000_000_000_000_000_000n;
function Header({ account, onWallet, onAccount }: { account: string | null; onWallet: () => void; onAccount: () => void }) { const [open, setOpen] = useState(false); const location = useLocation(); const nav = [['/', 'Home'], ['/rounds', 'Rounds'], ['/history', 'History'], ['/help', 'Help']]; return <header><a className="brand" href="/"><Landmark /> MandateMesh</a><button className="menu" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Menu /></button><nav aria-label="Primary" className={open ? 'open' : ''}>{nav.map(([to, label]) => <Link className={location.pathname === to ? 'active' : ''} to={to} key={to}>{label}</Link>)}</nav><button className="wallet" onClick={account ? onAccount : onWallet} aria-haspopup={account ? 'menu' : undefined}><Wallet size={18} />{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'Connect wallet'}</button></header>; }
function WalletModal({ close, connected }: { close: () => void; connected: (choice: WalletChoice) => Promise<void> }) {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    discoverWallets().then(setWallets);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" aria-describedby="wallet-description" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon" type="button" aria-label="Close wallet selection" onClick={close}><X size={20} /></button>
      <p className="dialog-kicker">Wallet connection</p>
      <h2 id="wallet-title">Choose a wallet</h2>
      <p id="wallet-description">Connect an EVM wallet to continue on Studio Dev. MandateMesh never selects a wallet for you.</p>
      <div className="wallet-list" aria-live="polite">
        {wallets.length ? wallets.map((wallet) => <button className="wallet-choice" type="button" key={wallet.name} onClick={() => connected(wallet).catch((cause) => setError(cause.message || 'Connection failed.'))}><Wallet size={18} aria-hidden="true" /><span>{wallet.name}</span><span className="wallet-arrow" aria-hidden="true">→</span></button>) : <p className="wallet-searching" role="status">Searching for EVM wallet extensions…</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  </div>;
}
function Home() { return <><section className="hero"><p>Transparent planning allocation</p><h1>Fund plans, not private decisions.</h1><p>Validator consensus maps proposals to locked public mandates before capped GEN credits are available.</p><Link className="button" to="/rounds/new">Start a round</Link> <Link className="plain" to="/rounds">Explore rounds</Link></section><section><h2>Three clear stages</h2><div className="grid"><article><b>1</b><h3>Lock context</h3><p>Fund a 2 GEN planning round around public mandates.</p></article><article><b>2</b><h3>Invite plans</h3><p>Registered proposers submit one bounded planning proposal.</p></article><article><b>3</b><h3>Read result</h3><p>Canonical state reloads after finality.</p></article></div></section></>; }
function localDateTime(hoursFromNow: number) {
  const value = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

type CreateRoundTransaction = { kind: 'write'; address: `0x${string}`; method: string; args: unknown[] };
type MandateKit = NonNullable<ReturnType<typeof useMandateKit>>;

function AutoSignTransaction({ kit, tx, onDone }: { kit: MandateKit; tx: CreateRoundTransaction; onDone: (status: TrackedStatus) => void }) {
  const flow = useTransactionFlow({ kit, tx, userValue: twoGen, trackUntil: 'finalized' });
  const started = useRef(false);
  const completed = useRef(false);

  useEffect(() => {
    if (flow.state.step === 'review' && !started.current) {
      started.current = true;
      void flow.approve();
    }
    if (flow.state.step === 'done' && !completed.current) {
      completed.current = true;
      onDone(flow.state.status);
    }
  }, [flow.state.step, flow.approve, onDone]);

  const retry = () => {
    started.current = false;
    completed.current = false;
    flow.reset();
  };

  if (flow.state.step === 'estimating' || flow.state.step === 'review') return <p className="transaction-status" role="status">Opening secure wallet approval…</p>;
  if (flow.state.step === 'signing') return <p className="transaction-status" role="status">Confirm the 2 GEN transaction in your wallet.</p>;
  if (flow.state.step === 'tracking') return <><Timeline status={flow.state.status} /><p className="transaction-status" role="status">Waiting for Studio Next finality…</p></>;
  if (flow.state.step === 'done') return <><Timeline status={flow.state.status} /><p className={flow.state.status.successful === false ? 'error transaction-status' : 'success transaction-status'} role={flow.state.status.successful === false ? 'alert' : 'status'}>{flow.state.status.successful === false ? 'Transaction finalized without success.' : 'Round creation finalized.'}</p></>;
  return <><p className="error transaction-status" role="alert">The transaction could not be completed. You can retry without changing the round data.</p><button className="retry-button" type="button" onClick={retry}>Try again</button></>;
}

function Start({ provider, account }: { provider: WalletChoice['provider'] | null; account: `0x${string}` | null }) {
  const kit = useMandateKit(provider, account);
  const [roundId, setRoundId] = useState('');
  const [people, setPeople] = useState(['', '', '']);
  const [proposalAt, setProposalAt] = useState(() => localDateTime(24));
  const [recoveryAt, setRecoveryAt] = useState(() => localDateTime(48));
  const [submitted, setSubmitted] = useState(false);
  const time = (value: string) => Math.floor(new Date(value).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const proposalTime = time(proposalAt);
  const recoveryTime = time(recoveryAt);
  const deadlinesValid = Number.isFinite(proposalTime) && Number.isFinite(recoveryTime) && proposalTime > now + 60 && recoveryTime > proposalTime;
  const valid = !!kit && !!contractAddress && /^[a-z0-9-]{1,48}$/.test(roundId) && people.every((value) => /^0x[a-fA-F0-9]{40}$/.test(value)) && deadlinesValid;
  const minDeadline = localDateTime(1 / 4);
  const deadlineError = !!proposalAt && !!recoveryAt && !deadlinesValid;
  return <><h1>Start a transparent planning round</h1><p>Creation locks exactly 2 GEN. The fee review comes from Studio Dev live policy.</p>{!contractAddress && <p className="error" role="alert">Contract configuration is missing; writes are disabled.</p>}<form onSubmit={(event: FormEvent) => { event.preventDefault(); if (valid) setSubmitted(true); }}><label>Round ID<input required value={roundId} onChange={(event) => setRoundId(event.target.value)} pattern="[a-z0-9-]+" /></label>{people.map((value, index) => <label key={index}>Proposer {index + 1} address<input required value={value} onChange={(event) => setPeople(people.map((person, cursor) => cursor === index ? event.target.value : person))} /></label>)}<label>Proposal deadline<input required type="datetime-local" min={minDeadline} step={60} value={proposalAt} aria-invalid={deadlineError} onChange={(event) => setProposalAt(event.target.value)} /><small className="field-hint">Choose a future local date and time.</small></label><label>Recovery deadline<input required type="datetime-local" min={proposalAt || minDeadline} step={60} value={recoveryAt} aria-invalid={deadlineError} onChange={(event) => setRecoveryAt(event.target.value)} /><small className="field-hint">Must be later than the proposal deadline.</small></label>{deadlineError && <p className="error" role="alert">Choose valid future deadlines; recovery must be later than proposal.</p>}<p>Planning purse: <strong>2 GEN</strong></p><button className="button" disabled={!valid}>{kit ? 'Create round · 2 GEN' : 'Connect a wallet to create'}</button></form>{submitted && kit && contractAddress && <section className="transaction-review" aria-live="polite"><p className="dialog-kicker">Round funding</p><h2>Creating a 2 GEN round</h2><p>One click opens your wallet for approval. The round is created only after you sign and Studio Next finalizes it.</p><div className="auto-transaction-panel"><AutoSignTransaction kit={kit} tx={{ kind: 'write', address: contractAddress, method: 'create_round', args: [roundId, ...people, proposalTime, recoveryTime] }} onDone={() => readRound(roundId).catch(() => undefined)} /></div></section>}</>;
}
type CanonicalRound = {
  round_id: string;
  phase: string;
  proposal_deadline: string;
  recovery_deadline: string;
  submitted_count: number;
  attempt_count: number;
  remaining_liability_gen: string;
  sponsor_credit_gen: string;
};

function parseCanonicalRound(value: unknown): CanonicalRound {
  const parsed = JSON.parse(String(value)) as Record<string, unknown>;
  return {
    round_id: String(parsed.round_id ?? ''),
    phase: String(parsed.phase ?? 'UNKNOWN'),
    proposal_deadline: String(parsed.proposal_deadline ?? ''),
    recovery_deadline: String(parsed.recovery_deadline ?? ''),
    submitted_count: Number(parsed.submitted_count ?? 0),
    attempt_count: Number(parsed.attempt_count ?? 0),
    remaining_liability_gen: `${Number(parsed.remaining_liability ?? 0) / 1e18} GEN`,
    sponsor_credit_gen: `${Number(parsed.sponsor_credit ?? 0) / 1e18} GEN`,
  };
}

function formatDeadline(timestamp: string) {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function phaseLabel(phase: string) {
  return ({
    OPEN: 'Open for proposals',
    FROZEN: 'Ready for review',
    RETRYABLE: 'Retryable review',
    ALLOCATED: 'Allocated',
    EXPIRED_REFUNDED: 'Refunded',
  } as Record<string, string>)[phase] ?? 'Unknown state';
}

function RoundLookup() {
  const [id, setId] = useState('');
  const [round, setRound] = useState<CanonicalRound | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadRound = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setRound(null);
    setLoading(true);
    try {
      setRound(parseCanonicalRound(await readRound(id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The canonical round could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  return <>
    <form onSubmit={loadRound}>
      <label>Round ID<input required value={id} onChange={(event) => setId(event.target.value)} /></label>
      <button className="button" disabled={!contractAddress || loading}>{loading ? 'Loading canonical state…' : 'Load canonical state'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
    {round && <section className="round-result" aria-live="polite" aria-label="Canonical round state">
      <div className="round-result-heading">
        <div>
          <p className="round-result-kicker">Canonical round</p>
          <h2>{round.round_id}</h2>
        </div>
        <span className={`round-phase round-phase-${round.phase.toLowerCase()}`}>{phaseLabel(round.phase)}</span>
      </div>
      <dl className="round-result-grid">
        <div><dt>Proposal deadline</dt><dd>{formatDeadline(round.proposal_deadline)}</dd></div>
        <div><dt>Recovery deadline</dt><dd>{formatDeadline(round.recovery_deadline)}</dd></div>
        <div><dt>Plans submitted</dt><dd>{round.submitted_count}</dd></div>
        <div><dt>Review attempts</dt><dd>{round.attempt_count}</dd></div>
      </dl>
      <div className="round-ledger">
        <div><span>Remaining purse</span><strong>{round.remaining_liability_gen}</strong></div>
        <div><span>Sponsor credit</span><strong>{round.sponsor_credit_gen}</strong></div>
      </div>
      <p className="round-footnote">Read directly from Studio Next canonical state after finality.</p>
    </section>}
  </>;
}
function Rounds() { return <><div className="title"><div><p>Rounds</p><h1>Read a canonical round</h1></div><Link className="button" to="/rounds/new">Start a round</Link></div><RoundLookup /></>; }
function History() { return <><h1>Past allocations stay explainable</h1><article className="empty"><h2>Read a round to inspect canonical history</h2><p>This app does not simulate balances, receipts, or finality.</p></article></>; }
function Help() { return <><h1>What MandateMesh does — and does not do</h1><article className="card"><h2>What is decided?</h2><p>Validators assess proposal coverage of locked mandates, not whether a plan was completed or endorsed.</p><h2>When is GEN available?</h2><p>Only after finality and canonical state reload, never at wallet signature.</p></article></>; }
function Shell() { const [modal, setModal] = useState(false); const [accountMenu, setAccountMenu] = useState(false); const [wallet, setWallet] = useState<WalletChoice | null>(null); const [account, setAccount] = useState<`0x${string}` | null>(null); const disconnect = () => { setAccount(null); setWallet(null); setAccountMenu(false); }; return <><a className="skip" href="#main">Skip to content</a><Header account={account} onWallet={() => setModal(true)} onAccount={() => setAccountMenu(!accountMenu)} />{accountMenu && account && <section className="account-menu" role="menu" aria-label="Wallet account"><p>{account}</p><button onClick={disconnect}>Disconnect wallet</button></section>}{modal && <WalletModal close={() => setModal(false)} connected={async (choice) => { setAccount(await connectWallet(choice.provider)); setWallet(choice); setModal(false); }} />}<main id="main"><Routes><Route path="/" element={<Home />} /><Route path="/rounds" element={<Rounds />} /><Route path="/rounds/new" element={<Start provider={wallet?.provider ?? null} account={account} />} /><Route path="/history" element={<History />} /><Route path="/help" element={<Help />} /></Routes></main></>; }
export default function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
