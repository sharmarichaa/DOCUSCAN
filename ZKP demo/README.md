🔐
DOCUSCAN
Zero-Knowledge Proof — Document Integrity Verification
Circom 0.5  ·  SnarkJS 0.7.6  ·

What This Is	
DocuScan proves a loan document re-submitted at disbursement is IDENTICAL to the one originally submitted — using real Zero-Knowledge cryptography. Document content is NEVER stored, transmitted, or accessed at any stage. The proof is mathematically binding.

This is not a simulation. The cryptography is real — actual Groth16 elliptic curve proofs on BN128, compiled Circom circuits, real Powers of Tau trusted setup, and real snarkjs proof generation and verification. When you run this code, you get real π_A, π_B, π_C elliptic curve points and a real pairing check: e(π_A,π_B)·e(−vk_α,vk_β) = 1.

Overview

This demo implements a cryptographic proof system that:
- Registers a proof of document integrity at submission time
- Verifies the same document later without accessing raw content
- Never exposes the actual document data during verification


Project Files — What Each One Does
File	What it does
scripts/setup.js	One-time setup: installs circom, compiles circuit, generates proving key. Run this first.
scripts/check.js	THE MAIN FILE — register a document, verify it later, list all registrations
scripts/zkp_demo.js	Automated demo showing all 4 scenarios: register, verify, forgery, replay attack
scripts/verify_only.js	Quick verify of last stored proof — runs in ~300ms
scripts/clean.js	Deletes build/ folder and resets everything
circuits/document_hash.circom	The ZK circuit — 3 R1CS constraints, defines what gets proved
frontend/src/zkp_api.js	Drop into any Node.js backend — registerDocument() and verifyDocument() functions
frontend/src/server.js	Express REST server — attach to any frontend via HTTP
package.json	Project config — lists snarkjs and ffjavascript as dependencies
proofs/	Output folder — stores hash commitments, ZK proofs, audit log. NO document content.
build/	Auto-generated — R1CS, WASM, proving key, trusted setup. Created by setup.js.


Folder Structure
  docuscan-zkp/
  │
  ├── scripts/
  │   ├── setup.js          ← Run this first (one time)
  │   ├── check.js          ← Main file: register + verify documents
  │   ├── zkp_demo.js       ← Full automated demo
  │   ├── verify_only.js    ← Quick proof check
  │   └── clean.js          ← Reset everything
  |   |__ zkp_api.js 
  |   |__ server.js 
  │
  ├── circuits/
  │   └── document_hash.circom  ← ZK circuit (Circom DSL)
  │
  |
  │
  ├── proofs/               ← Created automatically
  │   ├── registrations.json    (hash commitments — NO content)
  │   ├── registration_proof.json
  │   ├── verification_key.json
  │   └── audit_log.json
  │
  ├── build/                ← Created by setup.js
  │   ├── document_hash.r1cs
  │   ├── document_hash.wasm
  │   ├── pot12_final.ptau
  │   └── doc_hash_final.zkey
  │
  └── package.json


Tech Stack

Component	Technology
--------------------------------------------------------------------------	--------------------------------------------------------------------------
Circuit Compiler	Circom 2.0
Proof Generation	SnarkJS
Curve	BN128
Proof Type	zk-SNARK

How to Run — Step by Step
1	Install Node.js (if not already installed)


Go to nodejs.org → Download LTS (green button) → Install it.
Check it worked:
  node --version   # must show v18.x or higher	


2	Put files in the right structure


Your folder must look exactly like the structure above. Create these empty folders if missing:
  mkdir scripts
  mkdir circuits
  mkdir build
  mkdir proofs
  mkdir frontend\src
Then copy each .js file into the correct folder.


3	Install dependencies


  npm install
  
  # You should see: added 35 packages


4	Install circom and snarkjs globally


  npm install -g circom snarkjs
  
  # Check they installed:
  circom --version
  snarkjs --version


5	Run one-time setup


  node scripts/setup.js
  
  # Takes ~60 seconds first time
  # After that it is instant (uses cached files)
  
  # You will see:
  # -- STEP 1: Checking Node.js version -- ✔
  # -- STEP 2: Checking Circom compiler -- ✔
  # -- STEP 3: Checking SnarkJS CLI ------ ✔
  # -- STEP 4: Creating build directories - ✔
  # -- STEP 5: Compiling circuit ---------- ✔
  # -- STEP 6: Powers of Tau ------------- ✔
  # -- STEP 7: Generating proving key ----- ✔
  # -- STEP 8: Exporting vKey ------------ ✔
  # Setup complete!


6	Run the full demo


  node scripts/zkp_demo.js
  
  # Shows 4 phases:
  # Phase 1 — Document registered, ZK proof generated
  # Phase 2A — Original doc: Trust 100/100 VERIFIED ✔
  # Phase 2B — Tampered doc: Trust 8/100 FORGERY DETECTED ✘
  # Phase 3 — Replay attack: BLOCKED ✘
  # Phase 4 — RBI audit log written


How to Check a Real Document
Register a document (at loan application)
  # With a file (PDF, image, text — any format):
  node scripts/check.js register --file ./income_certificate.txt
  
  # Without a file (type details manually):
  node scripts/check.js register
  
  # You get back a Registration ID — SAVE IT:
  # ✔  DOCUMENT REGISTERED SUCCESSFULLY
  # Registration ID    D769C2687F56  <- copy this


Verify the same document later (at disbursement)
  # Same document — should PASS:
  node scripts/check.js verify D769C2687F56 --file ./income_certificate.txt
  
  # Altered document — should FAIL:
  node scripts/check.js verify D769C2687F56 --file ./altered_certificate.txt


Other useful commands
  # See all registered documents:
  node scripts/check.js list
  
  # Quick automated test — no files needed:
  node scripts/check.js test
  
  # Verify last stored proof quickly:
  node scripts/verify_only.js
  
  # Reset everything and start fresh:
  node scripts/clean.js


What You Will See
When document is VERIFIED (original, unaltered):
  Registered hash   35d67590afc6fd15...  (green)
  Re-submitted hash 35d67590afc6fd15...  (green)
  SHA-256 match     IDENTICAL ✔ — every bit matches
  
  Trust  ████████████████████  100/100
  
  ✔  DOCUMENT VERIFIED  · Trust Score 100/100  · SAFE TO DISBURSE
  ✔  Groth16 BN128 pairing check: passed
  ✔  Document content was NOT accessed by verifier at any point


When FORGERY is detected (document altered):
  Registered hash   35d67590afc6fd15...  (green)
  Re-submitted hash 7502ea51502aa33a...  (red)
  SHA-256 match     DIFFERENT ✘ — avalanche effect: hash fully changed
  
  Trust  ░░░░░░░░░░░░░░░░░░░░  8/100  REJECT
  
  ✘  FORGERY DETECTED  · Trust Score 8/100  · HOLD DISBURSEMENT
  → HOLD disbursement immediately
  → File SAR per RBI FIU Circular 2024



🔧  Troubleshooting
Error	Fix
npm error ENOENT package.json	You are in the wrong folder. Run: cd docuscan-zkp
circom: not recognized	Run: npm install -g circom
snarkjs: not recognized	Run: npm install -g snarkjs
Cannot find module 'snarkjs'	Run: npm install
Cannot find module setup.js	Files not in scripts/ folder. Move them there.
doc_hash_final.zkey not found	Run: node scripts/setup.js
document_hash.r1cs not found	Run: circom circuits/document_hash.circom --r1cs --wasm --sym -o build/
Stuck more than 2 minutes	Press Ctrl+C then run node scripts/setup.js again (it resumes)
ENOENT on zkey new (Windows)	cd build then run snarkjs commands from inside build/ folder


How the ZKP Works
Stage	What happens
1. Document uploaded	SHA-256 hash computed from file bytes — document content discarded after
2. Hash split	256-bit hash split into two 128-bit BN128 field elements: hash_hi, hash_lo
3. ZK proof generated	Groth16 fullProve: content_hi/lo as private witness → π_A, π_B, π_C produced
4. Commitment stored	Only hash_hi, hash_lo, doc_version stored — raw content NEVER stored
5. Re-submission	Document re-uploaded → re-hashed → compared against stored commitment
6. ZK verification	groth16.verify: pairing check e(π_A,π_B)·e(−vk_α,vk_β) = 1 on BN128
7. Verdict	VERIFIED (Trust 100/100) or FORGERY DETECTED (Trust 8/100)


Privacy guarantees
✔	Document content is NEVER stored, transmitted, or logged at any stage
✔	Private ZK witness files are deleted from disk immediately after proof generation
✔	Tamper detection is mathematically guaranteed — not heuristic or probabilistic
✔	Replay attacks blocked via doc_version public signal in circuit
✔	Works completely offline — no internet required at any stage
✔	Compliant with RBI Data Localisation Guidelines 2024

License
This project was developed as part of the SuRaksha Cyber Hackathon.




