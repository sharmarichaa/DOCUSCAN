# ZKP Verification Demo



###### Zero-Knowledge Proof demonstration for document integrity verification without exposing sensitive content.



## Overview



###### This demo implements a cryptographic proof system that:

###### \- Registers a proof of document integrity at submission time

###### \- Verifies the same document later without accessing raw content

###### \- Never exposes the actual document data during verification



## Tech Stack



|Component|Technology|
|-|-|
|--------------------------------------------------------------------------|--------------------------------------------------------------------------|
|Circuit Compiler|Circom 2.0|
|Proof Generation|SnarkJS|
|Curve|BN128|
|Proof Type|zk-SNARK|





## Proof Flow



|Step|Action| Privacy Guarantee|
|-|-|-|
|------------------------------------------------|------------------------------------------------|------------------------------------------------|
|1|Document hash computed locally|Raw content never leaves client|
|2|ZKP circuit generates proof|Mathematical binding only|
|3|Proof stored on ledger|No document data stored|
|4|Verification query submitted|Only proof is transmitted|
|5|Integrity confirmed/rejected|Original content remains private|





## Circuit Logic



|Input|Description|
|-|-|
|--------------------------------------------------------------------------|--------------------------------------------------------------------------|
|'private doc\_hash'|SHA256 of original document|
|'private submitted\_hash'|Stored reference hash|
|'output valid'|Boolean verification result|





## 

