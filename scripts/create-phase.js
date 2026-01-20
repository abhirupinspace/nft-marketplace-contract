const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  const PHASE_MANAGER_ADDRESS = "0xB55E8E93F090e052F7FC2Ebf0Cd822244Efe3734";

  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const pm = PhaseManager.attach(PHASE_MANAGER_ADDRESS);

  // Check current phase count
  const phaseCount = await pm.phaseCount();
  console.log("Current phase count:", phaseCount.toString());

  if (phaseCount > 0n) {
    console.log("\nPhase already exists. Checking details...");
    const phase = await pm.mintPhases(0);
    console.log("Phase 0 Details:");
    console.log("  Name:", phase.name);
    console.log("  Price:", ethers.formatEther(phase.price), "ETH");
    console.log("  Max Supply:", phase.maxSupply.toString());
    console.log("  Max Per Wallet:", phase.maxPerWallet.toString());
    console.log("  Active:", phase.active);
    console.log("  Minted:", phase.minted.toString());
    return;
  }

  console.log("\nCreating new mint phase...");

  const now = Math.floor(Date.now() / 1000);
  const oneMonthLater = now + 30 * 24 * 60 * 60;

  // Create a public mint phase
  const tx = await pm.createMintPhase(
    "Public Mint",              // name
    now,                        // startTime (now)
    oneMonthLater,              // endTime (1 month from now)
    ethers.parseEther("0.001"), // price (0.001 ETH)
    10000,                      // phaseMaxSupply
    10,                         // maxPerWallet
    0,                          // walletGroupId (0 = public)
    false,                      // buyXGetY
    0,                          // buyAmount
    0                           // getAmount
  );

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");
  await tx.wait();

  console.log("\n✅ Phase created successfully!");

  // Verify
  const newPhaseCount = await pm.phaseCount();
  console.log("New phase count:", newPhaseCount.toString());

  const phase = await pm.mintPhases(0);
  console.log("\nPhase 0 Details:");
  console.log("  Name:", phase.name);
  console.log("  Price:", ethers.formatEther(phase.price), "ETH");
  console.log("  Max Supply:", phase.maxSupply.toString());
  console.log("  Max Per Wallet:", phase.maxPerWallet.toString());
  console.log("  Active:", phase.active);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
