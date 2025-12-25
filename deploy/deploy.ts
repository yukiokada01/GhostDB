import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedRegistry = await deploy("GhostDocumentRegistry", {
    from: deployer,
    log: true,
  });

  console.log(`GhostDocumentRegistry contract: `, deployedRegistry.address);
};
export default func;
func.id = "deploy_ghost_document_registry"; // id required to prevent reexecution
func.tags = ["GhostDocumentRegistry"];
