# GhostDB

GhostDB is an end-to-end encrypted document registry built on Zama FHEVM. It lets users generate a fresh access key per
file, store the encrypted key on-chain, and collaboratively edit encrypted document bodies without ever publishing
plaintext.

## What this project is
GhostDB combines on-chain access control with client-side encryption. A document is represented by metadata and two
ciphertexts:
- An FHE-encrypted access key (an EVM address generated locally, referred to as key A).
- An AES-GCM encrypted document body (stored as a base64 string).

Only addresses explicitly allowed by the contract can decrypt key A using the Zama relayer. The plaintext body is
encrypted and decrypted locally in the browser using key A, so no plaintext touches the blockchain.

## Problems GhostDB solves
- Centralized document storage exposes sensitive content to operators, breaches, and insider access.
- Traditional access control systems keep keys off-chain, making on-chain audit trails incomplete.
- Collaboration tools often require trust in backend services that can decrypt user data.
- On-chain documents are typically public, making privacy-preserving collaboration difficult.

## Why it is different
- The access key is protected by Zama FHEVM and can be shared using on-chain ACL logic.
- The document body remains opaque on-chain and only exists in plaintext on the client.
- Collaboration is permissioned and audited on-chain, without a centralized server.
- Each document has its own key, so compromise or sharing is scoped to a single file.

## Core workflow (end-to-end)
1. Create document
   - Generate a random EVM address A on the client.
   - Encrypt A with Zama relayer and submit `createDocument(name, encryptedAccessKey, inputProof)`.
   - Store empty encrypted body plus encrypted access key on-chain.
2. Decrypt access key
   - Read `getDocument` from the contract.
   - Use Zama relayer user-decryption to re-encrypt the access key for the user and reveal A locally.
3. Edit document body
   - Encrypt plaintext body with AES-GCM derived from A.
   - Submit `updateDocument(documentId, encryptedBody)`.
4. Share access
   - Owner calls `allowEditor(documentId, editorAddress)`.
   - Contract uses `FHE.allow` so the editor can decrypt the access key and update.

## Advantages
- End-to-end confidentiality: plaintext never leaves the client.
- Fine-grained collaboration: only approved editors can decrypt keys and submit updates.
- On-chain audit trail: every creation, update, and permission grant is emitted as an event.
- No backend required: wallet + relayer is enough to operate the dApp.
- Deterministic access model: permissions are enforced by the contract, not by off-chain logic.

## System architecture
On-chain (Solidity, FHEVM)
- Contract: `GhostDocumentRegistry`
- Stores document metadata, encrypted body, encrypted access key, and editor lists.
- Uses `FHE.fromExternal` and `FHE.allow` for access key storage and ACL control.

Off-chain (Client)
- Generates key A (random EVM address) on document creation.
- Uses Zama Relayer SDK to encrypt/decrypt FHE ciphertexts.
- Uses Web Crypto (AES-GCM + SHA-256) to encrypt/decrypt document bodies.

Network
- Smart contract is deployed on Sepolia.
- Relayer SDK handles interaction with the FHEVM Gateway and KMS.

## Cryptography details
- Access key A: EVM address generated client-side.
- Access key storage: encrypted as `euint256` with Zama FHEVM, stored in contract state.
- Body encryption: AES-GCM with a key derived by hashing A using SHA-256.
- Ciphertext format: base64 string with IV prepended (12 bytes IV + ciphertext).

## Contract interface summary
Events
- `DocumentCreated(documentId, owner, name)`
- `DocumentUpdated(documentId, editor, encryptedBody)`
- `EditorAllowed(documentId, editor)`

Functions
- `createDocument(name, encryptedAccessKey, inputProof)`
- `updateDocument(documentId, encryptedBody)`
- `allowEditor(documentId, editor)`
- `getDocument(documentId)`
- `getDocumentsByOwner(ownerAddress)`
- `getDocumentsForEditor(editor)`
- `isEditor(documentId, account)`

## Tech stack
Smart contracts
- Solidity 0.8.27
- Hardhat + hardhat-deploy
- Zama FHEVM (solidity library + hardhat plugin)
- TypeChain + ethers v6 typings

Frontend
- React + Vite
- RainbowKit + wagmi for wallet UX
- viem for reads, ethers for writes
- Zama Relayer SDK for FHE user decryption
- Custom CSS (no Tailwind)

Crypto and utilities
- Web Crypto API (AES-GCM, SHA-256)
- Base64 encoding utilities

## Project structure
- `contracts/` Solidity contracts
- `deploy/` hardhat-deploy scripts
- `tasks/` hardhat tasks for CLI flows
- `test/` contract tests
- `deployments/` deployment artifacts and ABI
- `app/` React + Vite frontend

## Getting started

### Prerequisites
- Node.js 20+
- npm
- A Sepolia wallet with test ETH

### Install dependencies
```bash
npm install
```

Frontend dependencies
```bash
cd app
npm install
```

### Environment configuration (contracts only)
Create a `.env` file in the project root with the following variables:
```
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
INFURA_API_KEY=YOUR_INFURA_KEY
ETHERSCAN_API_KEY=OPTIONAL
```
Notes:
- Use a private key, not a mnemonic.
- The frontend does not use environment variables.

### Compile and test
```bash
npm run compile
npm run test
```

### Local contract development
```bash
npm run chain
```
Run tasks/tests against the local node as needed. The frontend is designed for Sepolia only and should not be pointed
at localhost networks.

### Deploy
Local
```bash
npm run deploy:localhost
```

Sepolia (after tests pass)
```bash
npm run deploy:sepolia
```

### Update frontend ABI and address
- ABI output is generated in `deployments/sepolia/`.
- Copy the ABI into `app/src/config/contracts.ts` and set `CONTRACT_ADDRESS`.
- The frontend embeds the ABI in TypeScript rather than importing JSON files.

### Run the frontend
```bash
cd app
npm run dev
```

## CLI tasks
- `npx hardhat accounts`
- `npx hardhat doc:address`
- `npx hardhat doc:create --name "My Doc" --accesskey 0x1234...`
- `npx hardhat doc:decrypt-key --id 1`
- `npx hardhat doc:update --id 1 --body "<ciphertext>"`
- `npx hardhat doc:allow --id 1 --editor 0xabc...`

## Usage walkthrough (frontend)
1. Connect a Sepolia wallet.
2. Paste the deployed contract address in the UI.
3. Create a document to generate key A and encrypt it on-chain.
4. Decrypt access key A using the Zama relayer.
5. Encrypt plaintext locally and submit updates.
6. Share with another address by granting editor access.

## Security model and limitations
- If you lose key A, the body cannot be decrypted. Back it up securely.
- The contract currently supports allow-only access; revocation is a future enhancement.
- Document bodies are stored on-chain as ciphertext, so large files are expensive.
- Frontend state is in-memory only (no local storage). Refreshing the page requires re-decryption.

## Future roadmap
- Time-bound or revocable editor permissions
- Key rotation and re-encryption workflows
- Version history with encrypted diffs
- Document metadata indexing for search
- Multi-chain deployments beyond Sepolia
- Attachment support with chunked ciphertext storage
- Optional on-chain public decrypt flows for shared disclosures

## License
BSD-3-Clause-Clear. See `LICENSE`.
