# MandateMesh

MandateMesh is a Projects-track GenLayer dApp for allocating a separate GEN planning purse across competing proposals only when validator consensus finds substantive coverage of locked public community mandates.

> Status: **VERIFIED — NO BLOCKER.** MandateMesh makes no claim of NYC endorsement.

## Live app

https://mandatemesh.vercel.app

## Deployed contract

- Network: Studio Dev / Studio Next, chain 61997
- Contract: [`0x78BdB37D788905801aa1b6e4CC2f4C2B2d19B249`](https://explorer-studio-dev.genlayer.com/address/0x78BdB37D788905801aa1b6e4CC2f4C2B2d19B249)
- Bound mandate configuration digest: `09c4c9ad79f9f9432b36d0a4b21eb7138ee745abb46543badac92cce1e470633`

## Verified lifecycle

Studio Dev round `review-v045-single-20260924` locked 2 GEN, classified the submitted plan as `NONE / SUBSTANTIVE / NONE`, created deterministic credits, completed both withdrawals, and ended with zero remaining liability. See [`docs/evidence/studio-dev/reviewer-remediation-lifecycle.json`](docs/evidence/studio-dev/reviewer-remediation-lifecycle.json).

## Local verification

```bash
npm ci
npm --prefix frontend ci
npm run check
```

`npm run check` runs GenVM lint, direct contract tests, frontend tests, TypeScript, and the production frontend build. The detailed architecture, safety matrices, deployment procedure, and honest limits are in [`docs/README.md`](docs/README.md).
