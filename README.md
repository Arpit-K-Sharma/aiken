# Aiken Multi-Sig Wallet

A multi-signature smart contract wallet built on **Cardano** using [Aiken](https://aiken-lang.org) for on-chain logic and [Next.js](https://nextjs.org) + [MeshJS](https://meshjs.dev) for the frontend. Supports two contract variants: a **configurable** multi-sig (owners and threshold stored in datum) and a **fixed** multi-sig (owners and threshold hard-coded at compile time).

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Contract Variants](#contract-variants)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [1. Build the Aiken Contracts](#1-build-the-aiken-contracts)
  - [2. Set Up the Frontend](#2-set-up-the-frontend)
  - [3. Configure Environment](#3-configure-environment)
  - [4. Run the Dev Server](#4-run-the-dev-server)
- [Multi-Sig Flow](#multi-sig-flow)
- [API Routes](#api-routes)
- [Testing](#testing)
- [Tech Stack](#tech-stack)

---

## Overview

This project lets a group of wallet owners collectively control funds locked in a Plutus V3 smart contract. A spending transaction only succeeds when a configurable threshold of owners sign it (e.g. **2-of-3**). The frontend manages the multi-step signing session — one owner initiates, co-signers add their signatures, and any owner submits once the threshold is reached.

---

## How It Works

```
Owner A initiates unlock
  └─ Builds unsigned tx (declares required signers in tx body)
  └─ Signs partially → creates session
        │
        ▼
Owner B co-signs
  └─ Loads session → adds signature → updates session
        │
        ▼
Threshold reached → any owner submits
  └─ Fully-witnessed tx broadcast to the node
  └─ On-chain validator checks: signatures ≥ threshold ✓
```

Key constraint: every key hash declared as a `requiredSignerHash` in the transaction body **must** provide a witness. Only owners who will actually sign should be selected when initiating.

---

## Contract Variants

### `multi_sig_wallet` — Configurable (datum-based)

Owners and threshold are stored **in the datum** when locking funds. This makes the contract reusable for any group.

```aiken
pub type Datum {
    owners: List<VerificationKeyHash>,
    threshold: Int,
}
```

The validator checks that the number of owner signatures in `extra_signatories` meets the threshold:

```aiken
let signatures = list.filter(owners, fn(owner) {
    list.has(self.extra_signatories, owner)
})
list.length(signatures) >= threshold
```

### `multi_sig_fixed` — Fixed (compile-time)

Owners and threshold are **hard-coded as constants** directly in the script. No datum is required at locking time. Useful when the group of signers never changes.

```aiken
const threshold: Int = 2
const owner1: VerificationKeyHash = #"f06e37..."
const owner2: VerificationKeyHash = #"29f661..."
const owner3: VerificationKeyHash = #"3aa33a..."
```

---

## Project Structure

```
├── validators/
│   ├── multi_sig_wallet.ak     # Configurable multi-sig (datum stores owners + threshold)
│   ├── multi_sig_fixed.ak      # Fixed multi-sig (owners hard-coded at compile time)
│   └── hello_world.ak          # Example validator
│
├── lib/                        # Shared Aiken library code
├── build/                      # Compiled contract artifacts (plutus.json)
├── aiken.toml                  # Aiken project config (Plutus V3, stdlib v3)
│
└── src/
    ├── generate-credentials.ts # CLI helper to generate test keys
    ├── script-builder.ts       # Off-chain script address builder
    │
    └── frontend-aiken/         # Next.js 16 frontend
        ├── src/
        │   ├── app/
        │   │   ├── page.tsx                  # Main UI entry point
        │   │   └── api/
        │   │       ├── validators/route.ts   # GET compiled script info
        │   │       ├── utxos/[address]/      # GET UTxOs at a script address
        │   │       └── signatures/route.ts   # POST/GET signature sessions
        │   │
        │   ├── components/
        │   │   ├── wallet-connect.tsx        # Cardano wallet connector
        │   │   ├── validator-selector.tsx    # Choose which contract to use
        │   │   ├── validator-details.tsx     # Display contract info
        │   │   └── validators/
        │   │       ├── multi-sig-wallet/
        │   │       │   ├── LockMultiSig.tsx        # Lock funds UI
        │   │       │   ├── UnlockMultiSig.tsx      # Unlock funds UI (owner selection)
        │   │       │   └── hooks/useMultisig.ts    # Session state management
        │   │       └── multi-sig-fixed/
        │   │           └── LockMultiSigFixed.tsx   # Lock funds (fixed script)
        │   │
        │   └── lib/
        │       ├── config.ts               # Network + Blockfrost config
        │       ├── addressToKeyHash.ts     # Bech32 address → key hash (async CSL)
        │       ├── validators.ts           # Load compiled validators
        │       └── server/
        │           └── validators/
        │               ├── multi_sig_wallet/
        │               │   ├── multi-sig-lock.ts       # Build lock tx
        │               │   ├── multi-sig-unlock.ts     # Build unlock tx + session flow
        │               │   └── multi-sig-session.ts    # In-memory session store
        │               └── multi_sig_fixed/
        │                   └── multi-sig-fixed-lock.ts
        └── plutus.json         # Compiled contract (copied from root build)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| [Aiken](https://aiken-lang.org/installation-instructions) | v1.1.21+ |
| Node.js | v18+ |
| npm | v9+ |
| A Cardano wallet browser extension | Eternl / Lace / Nami |
| [Blockfrost](https://blockfrost.io) API key | preprod / mainnet |

---

## Getting Started

### 1. Build the Aiken Contracts

From the project root:

```sh
aiken build
```

This compiles the validators and outputs `plutus.json`. Copy it to the frontend:

```sh
cp plutus.json src/frontend-aiken/plutus.json
```

To run the on-chain unit tests:

```sh
aiken check
```

### 2. Set Up the Frontend

```sh
cd src/frontend-aiken
npm install
```

### 3. Configure Environment

Create a `.env.local` file inside `src/frontend-aiken/`:

```env
NEXT_PUBLIC_BLOCKFROST_PROJECT_ID=preprodXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_NETWORK=preprod
```

Supported values for `NEXT_PUBLIC_NETWORK`: `preprod`, `preview`, `mainnet`.

### 4. Run the Dev Server

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Multi-Sig Flow

### Locking Funds (`multi_sig_wallet`)

1. Connect your Cardano wallet.
2. Select the **Multi-Sig Wallet** validator.
3. Enter owner addresses and threshold (e.g. 2-of-3).
4. Enter the amount to lock.
5. Sign and submit — funds are locked with the datum containing owners + threshold.

### Unlocking Funds

1. Connect wallet as one of the owners.
2. Select the UTxO to unlock.
3. **Select the signing owners** — only tick the wallets that will actually sign (each selected owner *must* provide a signature or the node rejects the tx).
4. Click **Initiate Unlock & Sign** — builds the tx and signs partially.
5. Share the session or switch wallets.
6. Co-signers click **Co-Sign with Current Wallet**.
7. Once the threshold is reached, any owner clicks **Submit Transaction**.

> **Important:** The number of selected signing owners must equal exactly the participating signers. Declaring a signer who does not sign causes a `missingSignatories` error from the node.

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/validators` | Returns compiled script CBOR and address |
| `GET` | `/api/utxos/[address]` | Fetches UTxOs at the given script address |
| `POST` | `/api/signatures` | Create a new signature collection session |
| `GET` | `/api/signatures?sessionId=...` | Fetch an existing session |
| `PUT` | `/api/signatures` | Add a signature to a session |

---

## Testing

### On-chain (Aiken)

```sh
# Run all tests
aiken check

# Run tests matching a name
aiken check -m multisig_two_of_three
```

The validators include built-in unit tests covering:
- 2-of-3 passing cases
- Under-threshold failing cases
- All-signers passing cases

### Off-chain (Frontend)

Use the dev UI against `preprod` with test ADA from the [Cardano Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | [Aiken](https://aiken-lang.org) — Plutus V3 |
| Cardano stdlib | [aiken-lang/stdlib v3](https://github.com/aiken-lang/stdlib) |
| Frontend framework | [Next.js 16](https://nextjs.org) (App Router) |
| Cardano off-chain | [MeshJS](https://meshjs.dev) v1.9 |
| Cardano serialization | [@emurgo/cardano-serialization-lib-browser](https://github.com/Emurgo/cardano-serialization-lib) |
| Chain indexer | [Blockfrost](https://blockfrost.io) |
| UI components | [Tailwind CSS](https://tailwindcss.com) + [Radix UI](https://radix-ui.com) |
| Address encoding | [bech32](https://github.com/bitcoinjs/bech32) |

---

## Resources

- [Aiken User Manual](https://aiken-lang.org)
- [MeshJS Docs](https://meshjs.dev)
- [Cardano Developer Portal](https://developers.cardano.org)
- [Blockfrost API Docs](https://docs.blockfrost.io)
