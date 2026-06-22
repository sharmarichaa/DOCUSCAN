# 🔐 DOCUSCAN

## Zero-Knowledge Proof — Document Integrity Verification

**Circom 0.5 · SnarkJS 0.7.6**

## What This Is

DocuScan proves a loan document re-submitted at disbursement is **IDENTICAL** to the one originally submitted using real Zero-Knowledge cryptography.

Document content is **never stored, transmitted, or accessed** at any stage. The proof is mathematically binding.

This is not a simulation. The cryptography is real — actual Groth16 elliptic curve proofs on BN128, compiled Circom circuits, real Powers of Tau trusted setup, and real snarkjs proof generation and verification.

---

## Overview

This demo implements a cryptographic proof system that:

- Registers a proof of document integrity at submission time
- Verifies the same document later without accessing raw content
- Never exposes the actual document data during verification

---

## Project Files

| File | Purpose |
|------|---------|
| scripts/setup.js | One-time setup: installs circom, compiles circuit, generates proving key |
| scripts/check.js | Main file — register, verify, and list documents |
| scripts/zkp_demo.js | Automated demo showing register, verify, forgery, and replay attack scenarios |
| scripts/verify_only.js | Quick verification of the last stored proof |
| scripts/clean.js | Deletes build folder and resets everything |
| circuits/document_hash.circom | ZK circuit |
| frontend/src/zkp_api.js | Backend integration functions |
| frontend/src/server.js | Express REST server |
| package.json | Project dependencies |
| proofs/ | Stores commitments, proofs, verification keys, and audit logs |
| build/ | Generated proving artifacts and trusted setup files |

---

## Folder Structure

```text
docuscan-zkp/
├── scripts/
│   ├── setup.js
│   ├── check.js
│   ├── zkp_demo.js
│   ├── verify_only.js
│   └── clean.js
|   |__ zkp_api.js
|   |__ server.js
├── circuits/
│   └── document_hash.circom
├── proofs/
├── build/
└── package.json
```

---

## Tech Stack

| Component | Technology |
|------------|------------|
| Circuit Compiler | Circom 2.0 |
| Proof Generation | SnarkJS |
| Curve | BN128 |
| Proof Type | zk-SNARK |

---

## Installation

### 1. Install Node.js

```bash
node --version
```

Requires Node.js v18+.

### 2. Install Dependencies

```bash
npm install
```

### 3. Install Circom and SnarkJS

```bash
npm install -g circom snarkjs

circom --version
snarkjs --version
```

### 4. Run Setup

```bash
node scripts/setup.js
```

---

## Run Demo

```bash
node scripts/zkp_demo.js
```

Expected scenarios:

1. Document registration
2. Successful verification
3. Forgery detection
4. Replay attack prevention

---

## Register a Document

```bash
node scripts/check.js register --file ./income_certificate.txt
```

or

```bash
node scripts/check.js register
```

---

## Verify a Document

```bash
node scripts/check.js verify D769C2687F56 --file ./income_certificate.txt
```

For altered files:

```bash
node scripts/check.js verify D769C2687F56 --file ./altered_certificate.txt
```

---

## Other Commands

```bash
node scripts/check.js list
node scripts/check.js test
node scripts/verify_only.js
node scripts/clean.js
```

---

## How the ZKP Works

1. Document uploaded → SHA-256 hash generated
2. Hash split into two BN128 field elements
3. Groth16 proof generated
4. Commitment stored
5. Document re-submitted and re-hashed
6. Pairing verification executed
7. Verdict returned

---

## Privacy Guarantees

- Document content is never stored
- Witness files are deleted after proof generation
- Tamper detection is mathematically guaranteed
- Replay attacks blocked via `doc_version`
- Works completely offline
- Compatible with RBI Data Localisation Guidelines 2024

---

## License

Developed as part of the **SuRaksha Cyber Hackathon**.
