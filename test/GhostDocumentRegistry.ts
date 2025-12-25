import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { GhostDocumentRegistry, GhostDocumentRegistry__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  owner: HardhatEthersSigner;
  editor: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory(
    "GhostDocumentRegistry",
  )) as GhostDocumentRegistry__factory;
  const registry = (await factory.deploy()) as GhostDocumentRegistry;
  const registryAddress = await registry.getAddress();

  return { registry, registryAddress };
}

describe("GhostDocumentRegistry", function () {
  let registry: GhostDocumentRegistry;
  let registryAddress: string;
  let signers: Signers;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { owner: ethSigners[0], editor: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    ({ registry, registryAddress } = await deployFixture());
  });

  async function encryptKey(value: bigint, forAddress: string) {
    return fhevm.createEncryptedInput(registryAddress, forAddress).add256(value).encrypt();
  }

  it("creates a document with encrypted key and tracks ownership", async function () {
    const clearKey = BigInt("0x1234000000000000000000000000000000000000");
    const encryptedKey = await encryptKey(clearKey, signers.owner.address);

    const documentId = await registry
      .connect(signers.owner)
      .createDocument.staticCall("First Doc", encryptedKey.handles[0], encryptedKey.inputProof);

    const tx = await registry
      .connect(signers.owner)
      .createDocument("First Doc", encryptedKey.handles[0], encryptedKey.inputProof);
    await tx.wait();

    const ownerDocs = await registry.getDocumentsByOwner(signers.owner.address);
    expect(ownerDocs).to.deep.eq([documentId]);
    const editableDocs = await registry.getDocumentsForEditor(signers.owner.address);
    expect(editableDocs).to.deep.eq([documentId]);

    const [name, body, encryptedAccessKey, owner, lastEditor] = await registry.getDocument(documentId);
    expect(name).to.eq("First Doc");
    expect(body).to.eq("");
    expect(owner).to.eq(signers.owner.address);
    expect(lastEditor).to.eq(signers.owner.address);

    const decryptedKey = await fhevm.userDecryptEuint(
      FhevmType.euint256,
      encryptedAccessKey,
      registryAddress,
      signers.owner,
    );
    expect(decryptedKey).to.eq(clearKey);
  });

  it("lets owner update encrypted body", async function () {
    const encryptedKey = await encryptKey(BigInt(1), signers.owner.address);
    const documentId = await registry
      .connect(signers.owner)
      .createDocument.staticCall("Draft", encryptedKey.handles[0], encryptedKey.inputProof);

    await registry
      .connect(signers.owner)
      .createDocument("Draft", encryptedKey.handles[0], encryptedKey.inputProof);

    await expect(registry.connect(signers.owner).updateDocument(documentId, "ciphertext"))
      .to.emit(registry, "DocumentUpdated")
      .withArgs(documentId, signers.owner.address, "ciphertext");

    const [, body] = await registry.getDocument(documentId);
    expect(body).to.eq("ciphertext");
  });

  it("allows owner to share editing rights and editor can update", async function () {
    const encryptedKey = await encryptKey(BigInt(2), signers.owner.address);
    const documentId = await registry
      .connect(signers.owner)
      .createDocument.staticCall("Shared", encryptedKey.handles[0], encryptedKey.inputProof);

    await registry
      .connect(signers.owner)
      .createDocument("Shared", encryptedKey.handles[0], encryptedKey.inputProof);

    await registry.connect(signers.owner).allowEditor(documentId, signers.editor.address);
    const allowed = await registry.isEditor(documentId, signers.editor.address);
    expect(allowed).to.eq(true);
    const editorDocs = await registry.getDocumentsForEditor(signers.editor.address);
    expect(editorDocs).to.deep.eq([documentId]);

    await registry.connect(signers.editor).updateDocument(documentId, "updated-by-editor");
    const [, body, , , lastEditor] = await registry.getDocument(documentId);
    expect(body).to.eq("updated-by-editor");
    expect(lastEditor).to.eq(signers.editor.address);
  });

  it("blocks non-editors from updating documents", async function () {
    const encryptedKey = await encryptKey(BigInt(3), signers.owner.address);
    const documentId = await registry
      .connect(signers.owner)
      .createDocument.staticCall("Locked", encryptedKey.handles[0], encryptedKey.inputProof);

    await registry
      .connect(signers.owner)
      .createDocument("Locked", encryptedKey.handles[0], encryptedKey.inputProof);

    await expect(registry.connect(signers.editor).updateDocument(documentId, "nope")).to.be.revertedWith(
      "Not authorized",
    );
  });
});
