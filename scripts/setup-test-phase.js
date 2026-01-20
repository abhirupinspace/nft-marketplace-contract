/**
 * NFT Launchpad - Setup Test Phase Script
 *
 * Creates a test mint phase for development and testing.
 * Run this after deployment to quickly set up a mintable phase.
 *
 * Usage:
 *   npx hardhat run scripts/setup-test-phase.js --network <network>
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ============================================
// CONFIGURATION
// ============================================

const PHASE_CONFIG = {
  // Phase name
  name: "Public Mint",

  // Phase duration (in hours from now)
  durationHours: 168, // 7 days

  // Price in ETH (0 for free mint)
  priceEth: "0.001",

  // Max supply for this phase
  maxSupply: 1000,

  // Max per wallet
  maxPerWallet: 5,

  // Wallet group ID (0 = public, no allowlist required)
  walletGroupId: 0,

  // Buy X Get Y promotion (set to false for no promotion)
  buyXGetY: false,
  buyAmount: 0,
  getAmount: 0,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function loadDeploymentInfo(networkName) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const latestFile = path.join(deploymentsDir, `${networkName}-latest.json`);

  if (!fs.existsSync(latestFile)) {
    throw new Error(
      `No deployment found for network "${networkName}". ` +
      `Run deployment script first: npx hardhat run scripts/deploy-testnet.js --network ${networkName}`
    );
  }

  return JSON.parse(fs.readFileSync(latestFile, "utf8"));
}

function printHeader(text) {
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  const networkName = network.name;

  printHeader("NFT LAUNCHPAD - SETUP TEST PHASE");
  console.log(`Network: ${networkName}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Load deployment info
  let deploymentInfo;
  try {
    deploymentInfo = loadDeploymentInfo(networkName);
    console.log(`\nLoaded deployment from: ${deploymentInfo.timestamp}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\nUsing account: ${deployer.address}`);

  // Get PhaseManager contract
  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const phaseManager = PhaseManager.attach(deploymentInfo.contracts.phaseManager);

  // Check if there are existing phases
  const existingPhaseCount = await phaseManager.phaseCount();
  console.log(`\nExisting phases: ${existingPhaseCount}`);

  // Calculate phase times
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 60; // Start in 1 minute
  const endTime = now + (PHASE_CONFIG.durationHours * 3600);

  // Convert price to wei
  const priceWei = ethers.parseEther(PHASE_CONFIG.priceEth);

  console.log("\nPhase Configuration:");
  console.log("-".repeat(40));
  console.log(`  Name: ${PHASE_CONFIG.name}`);
  console.log(`  Start: ${new Date(startTime * 1000).toISOString()}`);
  console.log(`  End: ${new Date(endTime * 1000).toISOString()}`);
  console.log(`  Price: ${PHASE_CONFIG.priceEth} ETH`);
  console.log(`  Max Supply: ${PHASE_CONFIG.maxSupply}`);
  console.log(`  Max Per Wallet: ${PHASE_CONFIG.maxPerWallet}`);
  console.log(`  Wallet Group: ${PHASE_CONFIG.walletGroupId === 0 ? "Public" : PHASE_CONFIG.walletGroupId}`);
  console.log(`  Buy X Get Y: ${PHASE_CONFIG.buyXGetY ? `Buy ${PHASE_CONFIG.buyAmount} Get ${PHASE_CONFIG.getAmount}` : "Disabled"}`);
  console.log("-".repeat(40));

  // Create the phase
  console.log("\nCreating mint phase...");

  const tx = await phaseManager.createMintPhase(
    PHASE_CONFIG.name,
    startTime,
    endTime,
    priceWei,
    PHASE_CONFIG.maxSupply,
    PHASE_CONFIG.maxPerWallet,
    PHASE_CONFIG.walletGroupId,
    PHASE_CONFIG.buyXGetY,
    PHASE_CONFIG.buyAmount,
    PHASE_CONFIG.getAmount
  );

  console.log(`  Tx Hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Confirmed in block: ${receipt.blockNumber}`);

  // Get the new phase count
  const newPhaseCount = await phaseManager.phaseCount();
  const newPhaseId = newPhaseCount - 1n;

  console.log(`\nPhase created successfully!`);
  console.log(`  Phase ID: ${newPhaseId}`);

  // Verify the phase
  const phase = await phaseManager.getPhase(newPhaseId);
  console.log("\nPhase Details:");
  console.log("-".repeat(40));
  console.log(`  Name: ${phase.name}`);
  console.log(`  Active: ${phase.active}`);
  console.log(`  Price: ${ethers.formatEther(phase.price)} ETH`);
  console.log(`  Max Supply: ${phase.maxSupply}`);
  console.log(`  Minted: ${phase.minted}`);
  console.log(`  Max Per Wallet: ${phase.maxPerWallet}`);
  console.log("-".repeat(40));

  printHeader("SETUP COMPLETE!");

  console.log("\nYou can now test minting on the frontend.");
  console.log(`\nPhase will be active in ~1 minute.`);
  console.log(`Phase ID to use: ${newPhaseId}`);

  if (deploymentInfo.explorer) {
    console.log(`\nView on explorer:`);
    console.log(`${deploymentInfo.explorer}/address/${deploymentInfo.contracts.nftLaunchpad}`);
  }
}

// ============================================
// EXECUTE
// ============================================

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
