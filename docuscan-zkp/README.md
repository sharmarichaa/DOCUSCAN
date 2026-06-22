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
|__ gitignore
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

## Troubleshooting
| Error | Fix |
| npm error ENOENT package.json | You are in the wrong folder. Run: cd docuscan-zk p|
| circom: not recognized | Run: npm install -g circom |
| snarkjs: not recognized | Run: npm install -g snarkjs |
| Cannot find module 'snarkjs' | Run: npm install |
| Cannot find module setup.js | Files not in scripts/ folder. Move them there. |
| doc_hash_final.zkey not found | Run: node scripts/setup.js |
| document_hash.r1cs not found | Run: circom circuits/document_hash.circom --r1cs --wasm --sym -o build/ |
| Stuck more than 2 minutes | Press Ctrl+C then run node scripts/setup.js again (it resumes) |
| ENOENT on zkey new (Windows) | cd build then run snarkjs commands from inside build/ folder |


## How the ZKP Works

|Stage |	What happens |
| 1. Document uploaded |	SHA-256 hash computed from file bytes — document content discarded after |
| 2. Hash split |	256-bit hash split into two 128-bit BN128 field elements: hash_hi, hash_lo |
| 3. ZK proof generated |	Groth16 fullProve: content_hi/lo as private witness → π_A, π_B, π_C produced |
| 4. Commitment stored |	Only hash_hi, hash_lo, doc_version stored — raw content NEVER stored |
| 5. Re-submission |	Document re-uploaded → re-hashed → compared against stored commitment |
| 6. ZK verification |	groth16.verify: pairing check e(π_A,π_B)·e(−vk_α,vk_β) = 1 on BN128 |
| 7. Verdict |	VERIFIED (Trust 100/100) or FORGERY DETECTED (Trust 8/100) |


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
