# MandateMesh — project specification

## Identity

- Idea ID: IDEA-033
- Project name / slug: MandateMesh / `mandatemesh`
- Category: Projects
- Status: VERIFIED — NO BLOCKER
- Repository: https://github.com/duclucky/mandatemesh
- Target network: Studio Dev / Studio Next RPC, chain 61997; active contract `0xD267BF7A3d45F7cfbB321D9dCe6A05e6B8173057`

## Product hook, trust problem and fingerprint

MandateMesh turns a validator-agreed coverage matrix for a fixed public-mandate text set into deterministic, capped GEN credits, so a sponsor cannot privately choose which planning proposal receives the purse.

- **Decision:** allocation from a sponsor's locked 2 GEN purse across proposers.
- **Why ordinary software fails:** a sponsor-hosted database/backend could alter coverage, omit a proposal, or pay a favorite. Validator-visible semantic review plus an onchain ledger binds the consequential result.
- **Value at risk:** the 2 GEN purse and each eligible proposer's credit.
- **Adversaries:** sponsor favoritism; proposer injection/duplicates; leader omission/fabrication; keeper replay; premature/duplicate recovery.
- **Evidence/authenticity:** V1 has *no actor-supplied consequential evidence*. Exact mandate bytes, their individual SHA-256 digests, the aggregate configuration digest, IDs, explicit coverage criteria, and three tranche shares are contract-locked configuration. The only decision is coverage of these locked bytes; MandateMesh makes no claim that an outside party endorses a plan or that any outside fact is true.
- **Consensus question:** for every active proposal × locked mandate pair, is coverage `SUBSTANTIVE`, `PARTIAL`, or `NONE`?
- **State model:** `OPEN → FROZEN → REVIEWING → ALLOCATED → CLOSED`, plus non-penalizing `RETRYABLE` and `EXPIRED_REFUNDED`.
- **Consequence/reuse:** code derives credits from a complete valid matrix and fixed formula; a generic fixed-context planning-round primitive exposes canonical state, matrix, credit, and liability views.

## Mandatory gate matrix

| Gate | PASS | Evidence/reason |
| --- | --- | --- |
| Replacement | PASS | no party can privately alter finalized matrix-derived credits |
| Judgment | PASS | validators answer bounded semantic coverage, not lookup |
| Evidence availability | PASS | selected CEC source returned 200 on 2026-09-22; V1 pins bytes/digests |
| Evidence authenticity | PASS | no claimant-controlled artifact affects value; V1 uses only contract-locked configuration |
| Equivalence | PASS | validators compare normalized matrix meaning against same locked bytes |
| Consequence | PASS | valid matrix deterministically creates GEN credits |
| Adversarial | PASS | invalid/omitted/replayed/injected/timed actions are rejected |
| State model | PASS | keyed rounds/proposals/credits/attempts/liability and terminal states |
| Reuse | PASS | fixed-context allocation rounds are integration-facing |
| Contract count | PASS | exactly one `gl.Contract` class owns V1 |
| Differentiation | PASS | plan × mandate allocation, not credentials, disclosures, scope gate, or tender bid |
| Claim-to-code | PASS | claims map below to method/view/test; deployment and smoke evidence recorded |
| Full lifecycle | PASS | create → submit → freeze → adjudicate/retry → allocate → withdraw/refund is covered by direct tests; live Studio smoke covers real create and canonical reload |
| Scope honesty | PASS | no NYC endorsement/delivery/grant/live-wallet claim |

## Roles, scope, and non-goals

| Actor | Permissions | Value at risk | Bias incentive |
| --- | --- | --- | --- |
| Sponsor | creates/funds, freezes, safely recovers unresolved expiry | 2 GEN | favor a plan/recover early |
| Proposer | submits one bounded plan, withdraws own credit | earned credit | overclaim/inject |
| Keeper | calls adjudication/retry | none | replay malformed review |
| Validator network | semantic matrix judgment | no direct purse control | malformed leader output |
| Visitor | canonical reads | none | none |

**In scope:** a 2 GEN purse, three immutable mandate tranches, at most three proposers and one plan each, consensus matrix, deterministic credits/refunds, views and EVM-wallet UI. **Out:** NYC representation/approval, delivery verification, dynamic source registration, arbitrary payout, offchain balance, private evidence, legal advice, conversion, operator ranking, consumer/callback contract.

## Product/frontend blueprint

| Route | Purpose/action | Required states | Mobile |
| --- | --- | --- | --- |
| `/` | understand / browse | loading, empty, source unavailable | cards stack |
| `/rounds` | find / open | loading, empty, error | filters collapse |
| `/rounds/new` | fund / create | absent wallet, submitted, finalized, error | steps stack |
| `/rounds/:id` | context / legal action | every canonical state | summary first |
| `/rounds/:id/propose` | submit plan | absent wallet, submitted, finalized, error | safe-area action |
| `/history` | read allocations | loading, empty, error | chips wrap |
| `/account` | select/disconnect/withdraw | no wallet, wrong network, pending, error | sheet |
| `/help` | limits/source/recovery | content/error | one column |

Persistent navigation: Home, Rounds, History, Help and clickable account. The current local shell is preview-only until connected to a contract adapter.

| Function/data | Visibility | Eligible context | Reason |
| --- | --- | --- | --- |
| mandate summaries, allocation, source citation | USER_PRIMARY | visitor | decision context |
| create/submit/freeze/retry/withdraw/recover | USER_CONTEXTUAL | correct role/state | prevents unsafe actions |
| wallet choice/disconnect | USER_CONTEXTUAL | account flow | user controls provider |
| raw storage/prompts/digests/validator JSON | SYSTEM_ONLY | never primary | not user decision aid |

| Visible control | Method | Caller/state | Value | Finality/recovery |
| --- | --- | --- | --- | --- |
| Start | `create_round` | sponsor, unique ID | exactly 2 GEN | submitted → accepted → finalized |
| Submit | `submit_plan` | proposer, OPEN and before deadline | 0 GEN | retry before deadline |
| Freeze | `freeze_round` | sponsor, OPEN and deadline reached | 0 GEN | final state change |
| Review | `adjudicate_round` / `retry_adjudication` | keeper, FROZEN/RETRYABLE | 0 GEN | retryable or allocated |
| Withdraw | `withdraw_credit` | credited proposer, ALLOCATED | own credit GEN | once only transfer |
| Recover | `recover_expired` | sponsor, unresolved expiry | remaining GEN | once only refund |

Labels: OPEN “Accepting plans”; FROZEN “Plans locked”; REVIEWING “Coverage review in progress”; RETRYABLE “Evidence needs another review”; ALLOCATED “Allocation ready”; CLOSED “Round complete”; EXPIRED_REFUNDED “Round closed and refunded.” A wallet signature or submission is never displayed as allocation success.

**FE-PRESERVE:** preserve verified Minimalism & Swiss Style: white/slate, navy `#0F172A`, blue `#1E3A8A`, gold `#A16207`, Lexend/Source Sans 3, visible focus, reduced motion, source citation, persistent navigation. **FE-HONEST:** explicit preview/data/config gaps. **FE-SURFACE:** state-aware planning data/actions only; system internals excluded.

## State model and safety cards

`round_id` is a unique bounded ASCII slug. `proposal_id` derives from round/address. Mandates are immutable `M1..M3`. Keyed storage holds round metadata/state/times/purse/liability, one proposal/address, cells by `(round,proposal,mandate)`, credits by `(round,address)`, and monotonic attempt. No global `last_*` state.

```text
OPEN -- sponsor freeze at/after proposal deadline --> FROZEN
FROZEN -- keeper adjudicate --> REVIEWING -- complete valid verdict --> ALLOCATED
REVIEWING -- unavailable/invalid --> RETRYABLE -- keeper retry --> REVIEWING
ALLOCATED -- liability/credits zero --> CLOSED
FROZEN|RETRYABLE -- sponsor expiry recovery --> EXPIRED_REFUNDED
```

Canonical time is GenVM message time. Default window is `open_time <= now < deadline`; equality is late. Each temporal entrypoint independently checks time even under a stale stored phase.

| Method | Caller | Allowed / forbidden | Exact time guard | Idempotency | Value effect | Views | Negative tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `create_round` | sponsor | absent / existing ID | N/A: stores activation | duplicate rejects | receives exactly 2 GEN, liability=2 | round/liability | wrong value, duplicate, config |
| `submit_plan` | registered proposer | OPEN / all else | `open <= now < proposal_deadline` | one per address | none | round/proposal | role, −1/equality/+1 stale OPEN, duplicate |
| `freeze_round` | sponsor | OPEN / all else | `now >= proposal_deadline` | second rejects | none | round | caller, −1/equality/+1 stale OPEN |
| `adjudicate_round` | keeper | FROZEN / rest | `now < recovery_deadline` | one active attempt | none until valid | round/attempt | state, expiry, replay, malformed |
| `retry_adjudication` | keeper | RETRYABLE / rest | `now < recovery_deadline` | increment once | none | round/attempt | state/stale phase/duplicate |
| `withdraw_credit` | credited proposer | ALLOCATED / rest | N/A: terminal credit | zero-before-transfer | debit credit/liability then GEN transfer | credit/liability | caller, zero, duplicate/accounting |
| `recover_expired` | sponsor | FROZEN/RETRYABLE / OPEN, REVIEWING, ALLOCATED, terminal | `now >= recovery_deadline` | zero-before-transfer | refund remaining liability | round/liability | caller, −1/equality/+1, active review, duplicate |
| `close_empty_round` | sponsor | ALLOCATED / rest | N/A: liability/credits must zero | second rejects | none | round | caller, credit outstanding, duplicate |

## Evidence authority and consensus

Canonical objective is immutable `MandateMesh V1 coverage policy`, exact three source-text bytes/digests, mandate IDs and shares stored at configuration. The allowed citations are preselected `https://www.participate.nyc.gov/` CEC URLs, but citations are not a payout authorization channel. Proposal text is bounded untrusted input quoted inside a delimiter and cannot redefine authority/schema/tranche/state/payout.

The active v0.4 contract corpus is bound by aggregate configuration digest `09c4c9ad79f9f9432b36d0a4b21eb7138ee745abb46543badac92cce1e470633`. Its three exact mandate records are exposed through `get_mandate_config`: `M1` Job Training for Young Adults and Adults in Trade Work (`ec25f3ee...33f2e`), `M2` Healthy Meals Partnership (`ac4a9549...f42da9`), and `M3` Bridging the Skills Gaps: Job Training for High Schoolers (`bb80dbf2...15ff73`). The same records and the complete definitions of `SUBSTANTIVE`, `PARTIAL`, and `NONE` are serialized once into the review prompt; the validator independently replays the same bound prompt.

| Consequential fact | Artifact/controller | Authority | Deterministic verification/binding | Semantic role | Failure / block | Negative test |
| --- | --- | --- | --- | --- | --- | --- |
| mandate corpus | immutable config, deployer only | contract state, not external-fact claim | exact digest, three IDs/shares, round config digest | coverage context | mismatch rejects / allocation blocked | changed byte/digest, ID/share |
| proposal context | stored bounded plan, proposer | proposer is not payout authority | address-round-proposal binding, one record | review input | malformed/injection rejects/retryable | injection/wrong actor/round |
| coverage matrix | nondet leader/validators | validator consensus | exact round/config/attempt, every active proposal × M1..M3 once, enum only | allocation input | invalid/unavailable → RETRYABLE, no liability mutation | omit/duplicate/bad enum/wrong digest/replay |

Leader returns only `{round_id, config_digest, attempt_id, cells:[{proposal_id, mandate_id, coverage}]}` with three enums. Validators use D3 `gl.eq_principle.*` / `gl.vm.run_nondet` to independently rerun the same exact mandate corpus and explicit criteria, then compare the normalized matrix meaning rather than prose. Deterministic code validates the stored corpus digests and aggregate digest before review, plus result cardinality, IDs, enum, config digest, attempt, and locked shares before settlement. Missing/changed mandate state or a missing/changed result digest becomes `RETRYABLE` with no transfer or credit and unchanged liability. Each `SUBSTANTIVE` cell earns a fixed one-third-GEN mandate tranche split equally among substantive plans; deterministic residual goes to sponsor recovery, never orphaned.

## Accounting, interface, threats, and proof map

Invariant: `remaining_liability = sponsor_refundable_credit + Σ(unwithdrawn proposer credits) + keyed undistributed remainder`. Source is exactly 2 GEN on create. Valid final matrix creates credits; withdrawal debits credit/liability then transfers GEN once. Unallocated/remainder is sponsor refundable only after allocation closes; unresolved expiry returns the purse via `recover_expired`. V1 has no callback/consumer.

Views: `get_round`, `get_proposal`, `get_credit`, `get_liability`, `get_public_matrix`; writes are the safety-card methods. Tests cover happy path, authorization/isolation, wrong GEN, all `-1/equality/+1` stale-phase boundaries, duplicate actions, malformed/contradictory/replayed matrix, injection, semantic mismatch, each verdict, rejected accounting, recovery/withdraw and receipt parser shapes. AST/metadata checks supplement direct mode; Studio Dev smoke/browser CORS remain mandatory for public claims.

| Claim | Method/state | View | Direct test | Network evidence |
| --- | --- | --- | --- | --- |
| no private allocation | validated matrix → ALLOCATED | matrix/credit | malformed/favorite-output reject | active deployment; direct proof |
| exactly 2 GEN enters | `create_round` | liability | wrong/2 GEN | live smoke `smoke-13798f8` reads 2 GEN liability |
| one timely plan | `submit_plan` / OPEN | proposal | role/duplicate/boundaries | direct proof |
| only final credit withdraws | `withdraw_credit` / ALLOCATED | credit/liability | early/caller/duplicate | direct proof |
| safe unresolved recovery | `recover_expired` | round/liability | caller/state/time/accounting | direct proof |

Differentiation: unlike TenderSeal (tender/bids), SkillSlot (credentials/access), Disclosure Dividend (disclosure rewards), or ScopeSeal (scope gating), MandateMesh allocates planning credits only from complete proposal × fixed-mandate coverage.

## Deployment, completion, limits, kill criteria

Studio Dev only. Deployment binds source commit, runner/API family, address, receipt, canonical views and balance evidence; scripts must be resumable. Browser proof must show wallet choice, official chain setup, submitted/accepted/finalized/failure/retry and canonical CORS-safe reload. Scripts are not browser proof.

Projects completion is recorded as **NO BLOCKER**: the contract is linted and directly tested, the active Studio Dev deployment is accepted, a real 2 GEN `create_round` smoke is finalized with a canonical `OPEN`/2 GEN reload, the browser route and RPC error path were checked in Chrome without `Failed to fetch`, the wallet-selection modal detected OKX Wallet, GitHub is public, and Vercel production is live at `https://mandatemesh.vercel.app`. Portal submission is intentionally not claimed; final submission remains a human action.
