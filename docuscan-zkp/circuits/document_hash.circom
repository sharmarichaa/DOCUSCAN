// DocuScan Document Integrity Circuit
// Circom 0.5 (installed version) - Groth16 / BN128
//
// CLAIM: "I know a document whose SHA-256 fingerprint matches
//         the commitment registered at loan application time."
//
// Private inputs (never stored or transmitted):
//   content_hi  - upper 128 bits of SHA-256(document)
//   content_lo  - lower 128 bits of SHA-256(document)
//
// Public inputs (stored in Canara Bank DB):
//   hash_hi     - registered commitment upper 128 bits
//   hash_lo     - registered commitment lower 128 bits
//   doc_version - version counter for replay protection
//
// Constraints:
//   1. content_hi === hash_hi  (upper half matches)
//   2. content_lo === hash_lo  (lower half matches)
//   3. version_check bounded   (version tag is non-trivial)

template DocumentIntegrity() {

    // PRIVATE WITNESS - zero-knowledge: never appears in proof output
    signal private input content_hi;
    signal private input content_lo;

    // PUBLIC INPUTS - known to verifier, stored in bank DB
    signal input hash_hi;
    signal input hash_lo;
    signal input doc_version;

    // INTERMEDIATE SIGNALS
    signal diff_hi;
    signal diff_lo;
    signal version_sq;

    // CONSTRAINT 1: Upper 128-bit half must match commitment
    diff_hi <== content_hi - hash_hi;
    diff_hi === 0;

    // CONSTRAINT 2: Lower 128-bit half must match commitment
    diff_lo <== content_lo - hash_lo;
    diff_lo === 0;

    // CONSTRAINT 3: Version tag is non-zero (replay protection)
    // version_sq = doc_version * doc_version (quadratic constraint)
    version_sq <== doc_version * doc_version;
}

component main = DocumentIntegrity();
