import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Contract, Wallet, getAddress, isAddress } from 'ethers';
import { decodeEventLog } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';

import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { decryptBody, encryptBody, shortHex } from '../utils/crypto';
import '../styles/DocumentApp.css';
import { Header } from './Header';

type DocumentRecord = {
  id: bigint;
  name: string;
  encryptedBody: string;
  encryptedAccessKey: string;
  owner: string;
  lastEditor: string;
  createdAt: number;
  updatedAt: number;
  canEdit: boolean;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function DocumentApp() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contractAddress, setContractAddress] = useState(CONTRACT_ADDRESS);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [creating, setCreating] = useState(false);
  const [creationMessage, setCreationMessage] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  const [decryptedKeys, setDecryptedKeys] = useState<Record<number, string>>({});
  const [decryptedBodies, setDecryptedBodies] = useState<Record<number, string>>({});
  const [bodyInputs, setBodyInputs] = useState<Record<number, string>>({});
  const [shareTargets, setShareTargets] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [keyLoading, setKeyLoading] = useState<Record<number, boolean>>({});
  const [savingDoc, setSavingDoc] = useState<Record<number, boolean>>({});
  const [sharing, setSharing] = useState<Record<number, boolean>>({});
  const [decodingBody, setDecodingBody] = useState<Record<number, boolean>>({});

  const contractIsValid = useMemo(
    () => Boolean(contractAddress) && isAddress(contractAddress) && contractAddress !== ZERO_ADDRESS,
    [contractAddress],
  );
  const normalizedContract = useMemo(
    () => (contractIsValid ? getAddress(contractAddress) : ''),
    [contractAddress, contractIsValid],
  );

  const setMessage = (docId: bigint, value: string) => {
    setMessages(prev => ({ ...prev, [Number(docId)]: value }));
  };

  const fetchDocuments = useCallback(async () => {
    if (!publicClient || !address || !contractIsValid) {
      setDocuments([]);
      return;
    }

    setLoadingDocs(true);
    try {
      const ownerDocs = await publicClient.readContract({
        address: normalizedContract as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'getDocumentsByOwner',
        args: [address as `0x${string}`],
      });

      const editorDocs = await publicClient.readContract({
        address: normalizedContract as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'getDocumentsForEditor',
        args: [address as `0x${string}`],
      });

      const uniqueIds = Array.from(new Set([...ownerDocs, ...editorDocs].map(id => id.toString()))).map(
        id => BigInt(id),
      );

      const loadedDocs: DocumentRecord[] = await Promise.all(
        uniqueIds.map(async id => {
          const result = await publicClient.readContract({
            address: normalizedContract as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'getDocument',
            args: [id],
          });

          const canEdit = await publicClient.readContract({
            address: normalizedContract as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'isEditor',
            args: [id, address as `0x${string}`],
          });

          return {
            id,
            name: result[0] as string,
            encryptedBody: result[1] as string,
            encryptedAccessKey: result[2] as string,
            owner: result[3] as string,
            lastEditor: result[4] as string,
            createdAt: Number(result[5]),
            updatedAt: Number(result[6]),
            canEdit: Boolean(canEdit),
          };
        }),
      );

      loadedDocs.sort((a, b) => b.updatedAt - a.updatedAt);
      setDocuments(loadedDocs);
    } catch (error) {
      console.error('Failed to load documents', error);
    } finally {
      setLoadingDocs(false);
    }
  }, [address, contractIsValid, normalizedContract, publicClient]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const createDocument = async () => {
    if (!address) {
      setCreationMessage('Connect your wallet to create a document.');
      return;
    }
    if (!contractIsValid || !normalizedContract) {
      setCreationMessage('Add the Sepolia contract address first.');
      return;
    }
    if (!publicClient) {
      setCreationMessage('Public client unavailable. Please refresh and try again.');
      return;
    }
    if (!newDocName.trim()) {
      setCreationMessage('Document name cannot be empty.');
      return;
    }
    if (!instance || zamaLoading) {
      setCreationMessage('Waiting for Zama relayer to finish initializing...');
      return;
    }

    const signer = await signerPromise;
    if (!signer) {
      setCreationMessage('Signer unavailable. Connect a wallet that supports typed data.');
      return;
    }

    setCreating(true);
    setCreationMessage('Encrypting access key...');
    try {
      const freshWallet = Wallet.createRandom();
      setGeneratedKey(freshWallet.address);

      const input = instance.createEncryptedInput(normalizedContract, address);
      input.add256(BigInt(freshWallet.address));
      const encryptedKey = await input.encrypt();

      const registry = new Contract(normalizedContract, CONTRACT_ABI, signer);
      const tx = await registry.createDocument(newDocName.trim(), encryptedKey.handles[0], encryptedKey.inputProof);

      setCreationMessage('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx.hash as `0x${string}` });
      let createdId: bigint | null = null;

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CONTRACT_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'DocumentCreated') {
            createdId = (decoded.args as { documentId: bigint }).documentId;
            break;
          }
        } catch {
          continue;
        }
      }

      if (createdId !== null) {
        setCreationMessage(`Document #${createdId.toString()} created. Save the generated key below.`);
      } else {
        setCreationMessage('Document created. Save the generated key below.');
      }
      setNewDocName('');
      await fetchDocuments();
    } catch (error) {
      console.error('Create document failed', error);
      setCreationMessage('Failed to create document. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const decryptAccessKey = async (doc: DocumentRecord) => {
    if (!instance || !address) {
      setMessage(doc.id, 'Encryption service not ready.');
      return null;
    }
    const signer = await signerPromise;
    if (!signer) {
      setMessage(doc.id, 'Connect a signer to decrypt.');
      return null;
    }

    setKeyLoading(prev => ({ ...prev, [Number(doc.id)]: true }));
    try {
      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        {
          handle: doc.encryptedAccessKey,
          contractAddress: normalizedContract,
        },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const contractAddresses = [normalizedContract];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const decryptedValue = result[doc.encryptedAccessKey as string];
      if (!decryptedValue) {
        throw new Error('No decrypted key returned');
      }

      const keyHex = `0x${BigInt(decryptedValue).toString(16).padStart(40, '0')}`;
      const checksumKey = getAddress(keyHex);
      setDecryptedKeys(prev => ({ ...prev, [Number(doc.id)]: checksumKey }));
      setMessage(doc.id, 'Access key decrypted');
      return checksumKey;
    } catch (error) {
      console.error('Decrypt access key failed', error);
      setMessage(doc.id, 'Failed to decrypt access key.');
      return null;
    } finally {
      setKeyLoading(prev => ({ ...prev, [Number(doc.id)]: false }));
    }
  };

  const ensureKey = async (doc: DocumentRecord) => {
    const cachedKey = decryptedKeys[Number(doc.id)];
    if (cachedKey) return cachedKey;
    return decryptAccessKey(doc);
  };

  const encryptAndSaveBody = async (doc: DocumentRecord) => {
    if (!doc.canEdit) {
      setMessage(doc.id, 'You do not have edit permissions.');
      return;
    }
    if (!contractIsValid) {
      setMessage(doc.id, 'Add a valid contract address first.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setMessage(doc.id, 'Connect a signer to submit changes.');
      return;
    }

    setSavingDoc(prev => ({ ...prev, [Number(doc.id)]: true }));
    try {
      const key = await ensureKey(doc);
      if (!key) {
        return;
      }
      const plainText = bodyInputs[Number(doc.id)] ?? '';
      const encrypted = await encryptBody(plainText, key);

      const registry = new Contract(normalizedContract, CONTRACT_ABI, signer) as any;
      const tx = await registry.connect(signer).updateDocument(doc.id, encrypted);
      setMessage(doc.id, 'Waiting for confirmation...');
      await tx.wait();
      setMessage(doc.id, 'Document updated on-chain.');
      setDecryptedBodies(prev => ({ ...prev, [Number(doc.id)]: plainText }));
      await fetchDocuments();
    } catch (error) {
      console.error('Update document failed', error);
      setMessage(doc.id, 'Failed to update document.');
    } finally {
      setSavingDoc(prev => ({ ...prev, [Number(doc.id)]: false }));
    }
  };

  const decryptExistingBody = async (doc: DocumentRecord) => {
    const key = await ensureKey(doc);
    if (!key) return;
    if (!doc.encryptedBody) {
      setDecryptedBodies(prev => ({ ...prev, [Number(doc.id)]: '' }));
      setMessage(doc.id, 'No body stored yet.');
      return;
    }

    setDecodingBody(prev => ({ ...prev, [Number(doc.id)]: true }));
    try {
      const plain = await decryptBody(doc.encryptedBody, key);
      setDecryptedBodies(prev => ({ ...prev, [Number(doc.id)]: plain }));
      setBodyInputs(prev => ({ ...prev, [Number(doc.id)]: plain }));
      setMessage(doc.id, 'Body decrypted with your key.');
    } catch (error) {
      console.error('Decrypt body failed', error);
      setMessage(doc.id, 'Failed to decrypt the current body.');
    } finally {
      setDecodingBody(prev => ({ ...prev, [Number(doc.id)]: false }));
    }
  };

  const shareDocument = async (doc: DocumentRecord) => {
    if (!contractIsValid) {
      setMessage(doc.id, 'Add a contract address first.');
      return;
    }
    if (getAddress(doc.owner) !== getAddress(address || ZERO_ADDRESS)) {
      setMessage(doc.id, 'Only the document owner can share.');
      return;
    }
    const target = shareTargets[Number(doc.id)];
    if (!target || !isAddress(target) || target === ZERO_ADDRESS) {
      setMessage(doc.id, 'Enter a valid collaborator address.');
      return;
    }

    const signer = await signerPromise;
    if (!signer) {
      setMessage(doc.id, 'Connect a signer to grant access.');
      return;
    }

    setSharing(prev => ({ ...prev, [Number(doc.id)]: true }));
    try {
      const registry = new Contract(normalizedContract, CONTRACT_ABI, signer) as any;
      const tx = await registry.connect(signer).allowEditor(doc.id, getAddress(target));
      setMessage(doc.id, 'Granting edit permission...');
      await tx.wait();
      setMessage(doc.id, `Editor ${shortHex(getAddress(target))} added.`);
      setShareTargets(prev => ({ ...prev, [Number(doc.id)]: '' }));
      await fetchDocuments();
    } catch (error) {
      console.error('Share document failed', error);
      setMessage(doc.id, 'Failed to share access.');
    } finally {
      setSharing(prev => ({ ...prev, [Number(doc.id)]: false }));
    }
  };

  return (
    <div className="page">
      <Header />
      <main className="workspace">
        <div className="hero">
          <div>
            <p className="eyebrow">Encrypted document relayer</p>
            <h1>GhostDB</h1>
            <p className="lede">
              Generate a fresh on-chain access key, encrypt documents client-side with Zama, and collaborate without ever
              exposing plaintext.
            </p>
            <div className="hero-grid">
              <div className="pill">Chain: Sepolia</div>
              <div className="pill">Writes: ethers · Reads: viem</div>
              <div className="pill">Encrypted access control</div>
            </div>
          </div>
          <div className="connect-tile">
            <p className="tile-title">Wallet</p>
            <ConnectButton />
            {zamaLoading ? <p className="muted">Initializing Zama relayer...</p> : null}
            {zamaError ? <p className="error">{zamaError}</p> : null}
          </div>
        </div>

        <div className="contract-bar">
          <div className="field">
            <label>Contract address (Sepolia)</label>
            <input
              value={contractAddress}
              placeholder="0x..."
              onChange={(e) => setContractAddress(e.target.value.trim())}
            />
          </div>
          <button className="ghost-button" onClick={() => fetchDocuments()} disabled={!contractIsValid || !address}>
            Sync documents
          </button>
          {!contractIsValid ? <span className="error">Add a valid deployed address to start.</span> : null}
        </div>

        <div className="grid">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Step 1</p>
                <h2>Create a document</h2>
              </div>
              <span className="pill subtle">{address ? shortHex(address) : 'Not connected'}</span>
            </div>
            <div className="field">
              <label>Document name</label>
              <input
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
                placeholder="research-notes.txt"
              />
            </div>
            <button className="primary" onClick={createDocument} disabled={creating || !address || !contractIsValid}>
              {creating ? 'Submitting...' : 'Generate key & submit'}
            </button>
            {creationMessage ? <p className="muted">{creationMessage}</p> : null}
            {generatedKey ? (
              <div className="key-box">
                <p className="key-label">Latest generated key (A)</p>
                <p className="key-value">{generatedKey}</p>
                <p className="muted">
                  The key is encrypted with Zama and stored on-chain. Use it to encrypt the body or share access.
                </p>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2>Documents you can edit</h2>
              </div>
              <button className="ghost-button" onClick={() => fetchDocuments()} disabled={loadingDocs || !contractIsValid}>
                {loadingDocs ? 'Refreshing...' : 'Refresh list'}
              </button>
            </div>
            {documents.length === 0 ? (
              <p className="muted">No documents found yet. Create one or ask an owner to share access.</p>
            ) : (
              <div className="doc-list">
                {documents.map(doc => {
                  const idKey = Number(doc.id);
                  const key = decryptedKeys[idKey];
                  const decrypted = decryptedBodies[idKey];
                  const ownerBadge =
                    address && getAddress(doc.owner) === getAddress(address) ? 'Owner' : doc.canEdit ? 'Editor' : 'Viewer';

                  return (
                    <div className="doc-card" key={doc.id.toString()}>
                      <div className="doc-header">
                        <div>
                          <p className="pill subtle">{ownerBadge}</p>
                          <h3>{doc.name}</h3>
                        </div>
                        <div className="doc-meta">
                          <span>#{doc.id.toString()}</span>
                          <span>
                            Updated {doc.updatedAt ? new Date(doc.updatedAt * 1000).toLocaleString() : '—'}
                          </span>
                        </div>
                      </div>

                      <div className="doc-meta-row">
                        <span>Owner {shortHex(doc.owner)}</span>
                        <span>Last editor {shortHex(doc.lastEditor)}</span>
                        <span>
                          Body {doc.encryptedBody ? `${doc.encryptedBody.length} chars encrypted` : 'empty'}
                        </span>
                      </div>

                      <div className="actions-row">
                        <button
                          className="ghost-button"
                          onClick={() => decryptAccessKey(doc)}
                          disabled={keyLoading[idKey] || !contractIsValid}
                        >
                          {keyLoading[idKey] ? 'Decrypting...' : key ? 'Key decrypted' : 'Decrypt access key'}
                        </button>
                        {key ? <span className="pill">Key: {shortHex(key)}</span> : null}
                      </div>

                      <div className="editor">
                        <label>Document body (plaintext)</label>
                        <textarea
                          rows={4}
                          value={bodyInputs[idKey] ?? ''}
                          onChange={(e) =>
                            setBodyInputs(prev => ({
                              ...prev,
                              [idKey]: e.target.value,
                            }))
                          }
                          placeholder="Write the content you want to encrypt with key A..."
                        />
                        <div className="actions-row">
                          <button
                            className="ghost-button"
                            onClick={() => decryptExistingBody(doc)}
                            disabled={decodingBody[idKey]}
                          >
                            {decodingBody[idKey] ? 'Decrypting body...' : 'Decrypt current body'}
                          </button>
                          <button
                            className="primary"
                            onClick={() => encryptAndSaveBody(doc)}
                            disabled={savingDoc[idKey] || !doc.canEdit}
                          >
                            {savingDoc[idKey] ? 'Saving...' : 'Encrypt & save'}
                          </button>
                        </div>
                        {decrypted ? <p className="muted">Decrypted body: {decrypted || 'empty'}</p> : null}
                      </div>

                      {getAddress(doc.owner) === getAddress(address || ZERO_ADDRESS) ? (
                        <div className="share">
                          <label>Share with collaborator</label>
                          <div className="share-row">
                            <input
                              value={shareTargets[idKey] ?? ''}
                              onChange={(e) =>
                                setShareTargets(prev => ({
                                  ...prev,
                                  [idKey]: e.target.value.trim(),
                                }))
                              }
                              placeholder="0x collaborator address"
                            />
                            <button
                              className="ghost-button"
                              onClick={() => shareDocument(doc)}
                              disabled={sharing[idKey]}
                            >
                              {sharing[idKey] ? 'Sharing...' : 'Allow edit'}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {messages[idKey] ? <p className="muted">{messages[idKey]}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
