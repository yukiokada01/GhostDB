import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("doc:address", "Prints the GhostDocumentRegistry address").setAction(async function (_taskArgs: TaskArguments, hre) {
  const { deployments } = hre;
  const registry = await deployments.get("GhostDocumentRegistry");
  console.log(`GhostDocumentRegistry address is ${registry.address}`);
});

task("doc:create", "Create a new encrypted document")
  .addParam("name", "Document name")
  .addParam("accesskey", "Access key value (hex or decimal)")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const registryDeployment = await deployments.get("GhostDocumentRegistry");
    const signer = (await ethers.getSigners())[0];

    const accessKeyValue = BigInt(taskArgs.accesskey);
    const encryptedInput = await fhevm
      .createEncryptedInput(registryDeployment.address, signer.address)
      .add256(accessKeyValue)
      .encrypt();

    const registry = await ethers.getContractAt("GhostDocumentRegistry", registryDeployment.address);
    const documentId = await registry
      .connect(signer)
      .createDocument.staticCall(taskArgs.name, encryptedInput.handles[0], encryptedInput.inputProof);

    const tx = await registry
      .connect(signer)
      .createDocument(taskArgs.name, encryptedInput.handles[0], encryptedInput.inputProof);
    await tx.wait();

    console.log(`Created document ${documentId.toString()} for ${signer.address}`);
  });

task("doc:decrypt-key", "Decrypt the access key for a document")
  .addParam("id", "Document id")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const registryDeployment = await deployments.get("GhostDocumentRegistry");
    const signer = (await ethers.getSigners())[0];
    const registry = await ethers.getContractAt("GhostDocumentRegistry", registryDeployment.address);

    const document = await registry.getDocument(taskArgs.id);
    const encryptedKey = document[2];

    const clearKey = await fhevm.userDecryptEuint(
      FhevmType.euint256,
      encryptedKey,
      registryDeployment.address,
      signer,
    );

    console.log(`Document ${taskArgs.id} access key is ${clearKey.toString()}`);
  });

task("doc:update", "Update the encrypted body of a document")
  .addParam("id", "Document id")
  .addParam("body", "Encrypted document body")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const registryDeployment = await deployments.get("GhostDocumentRegistry");
    const signer = (await ethers.getSigners())[0];
    const registry = await ethers.getContractAt("GhostDocumentRegistry", registryDeployment.address);

    const tx = await registry.connect(signer).updateDocument(taskArgs.id, taskArgs.body);
    await tx.wait();

    console.log(`Updated document ${taskArgs.id}`);
  });

task("doc:allow", "Allow another address to decrypt the document key and edit")
  .addParam("id", "Document id")
  .addParam("editor", "Editor address")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const registryDeployment = await deployments.get("GhostDocumentRegistry");
    const signer = (await ethers.getSigners())[0];
    const registry = await ethers.getContractAt("GhostDocumentRegistry", registryDeployment.address);

    const tx = await registry.connect(signer).allowEditor(taskArgs.id, taskArgs.editor);
    await tx.wait();

    console.log(`Allowed ${taskArgs.editor} on document ${taskArgs.id}`);
  });
