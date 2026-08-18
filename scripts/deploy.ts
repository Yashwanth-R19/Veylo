import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Fixed arbitration fee for the CentralizedArbitrator, in POL (native token on
// Amoy). Not specified anywhere in the plan; chosen small since this is a
// testnet fee raiseDispute() forwards, not a real-money parameter.
const ARBITRATION_COST = ethers.parseEther("0.0001");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying on network: ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} POL`);

  // Per Session 2.2 Part B: the deployer wallet also serves as the
  // VeyloAgreements `validator` role for this session (no separate
  // VALIDATOR_PRIVATE_KEY was provided), per explicit user confirmation.
  const validatorAddress = process.env.VALIDATOR_PRIVATE_KEY
    ? new ethers.Wallet(process.env.VALIDATOR_PRIVATE_KEY).address
    : deployer.address;
  console.log(`Validator address: ${validatorAddress}`);

  const ArbitratorFactory = await ethers.getContractFactory("CentralizedArbitrator");
  const arbitrator = await ArbitratorFactory.deploy(ARBITRATION_COST);
  await arbitrator.waitForDeployment();
  const arbitratorAddress = await arbitrator.getAddress();
  const arbitratorDeployTx = arbitrator.deploymentTransaction();
  const arbitratorReceipt = await arbitratorDeployTx!.wait();
  console.log(`CentralizedArbitrator deployed at: ${arbitratorAddress}`);
  console.log(`  tx: ${arbitratorDeployTx!.hash}, block: ${arbitratorReceipt!.blockNumber}`);

  const AgreementsFactory = await ethers.getContractFactory("VeyloAgreements");
  const agreements = await AgreementsFactory.deploy(validatorAddress, arbitratorAddress);
  await agreements.waitForDeployment();
  const agreementsAddress = await agreements.getAddress();
  const agreementsDeployTx = agreements.deploymentTransaction();
  const agreementsReceipt = await agreementsDeployTx!.wait();
  console.log(`VeyloAgreements deployed at: ${agreementsAddress}`);
  console.log(`  tx: ${agreementsDeployTx!.hash}, block: ${agreementsReceipt!.blockNumber}`);

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance after deployment: ${ethers.formatEther(finalBalance)} POL`);
  console.log(`Total spent: ${ethers.formatEther(balance - finalBalance)} POL`);

  const chainConfig = {
    chainId: network.config.chainId,
    network: network.name,
    deployer: deployer.address,
    validator: validatorAddress,
    arbitrationCost: ARBITRATION_COST.toString(),
    contracts: {
      CentralizedArbitrator: {
        address: arbitratorAddress,
        deployTxHash: arbitratorDeployTx!.hash,
        deployBlock: arbitratorReceipt!.blockNumber,
      },
      VeyloAgreements: {
        address: agreementsAddress,
        deployTxHash: agreementsDeployTx!.hash,
        deployBlock: agreementsReceipt!.blockNumber,
      },
    },
    deployedAt: new Date().toISOString(),
  };

  const configDir = path.join(__dirname, "..", "config");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "chain.json");
  fs.writeFileSync(configPath, JSON.stringify(chainConfig, null, 2) + "\n");
  console.log(`Wrote ${configPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
