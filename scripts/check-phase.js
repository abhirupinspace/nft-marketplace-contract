const { ethers } = require("hardhat");

async function main() {
  const PHASE_MANAGER_ADDRESS = "0xB55E8E93F090e052F7FC2Ebf0Cd822244Efe3734";
  const NFT_ADDRESS = "0xB63bF44e9B97295542008beAc2EB69CD6Bd5C68C";

  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const pm = PhaseManager.attach(PHASE_MANAGER_ADDRESS);

  const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
  const nft = NFTLaunchpad.attach(NFT_ADDRESS);

  console.log("=== Checking Contract State ===\n");

  // Check phase count from PhaseManager
  const phaseCount = await pm.phaseCount();
  console.log("PhaseManager - Phase count:", phaseCount.toString());

  // Check phase count from NFTLaunchpad (delegated)
  try {
    const nftPhaseCount = await nft.phaseCount();
    console.log("NFTLaunchpad - Phase count:", nftPhaseCount.toString());
  } catch (e) {
    console.log("NFTLaunchpad phaseCount error:", e.message);
  }

  // Try to read phase 0
  if (phaseCount > 0n) {
    console.log("\n=== Phase 0 Details ===");
    const phase = await pm.mintPhases(0);
    console.log("Name:", phase.name);
    console.log("Start Time:", new Date(Number(phase.startTime) * 1000).toISOString());
    console.log("End Time:", new Date(Number(phase.endTime) * 1000).toISOString());
    console.log("Price:", ethers.formatEther(phase.price), "ETH");
    console.log("Max Supply:", phase.maxSupply.toString());
    console.log("Minted:", phase.minted.toString());
    console.log("Max Per Wallet:", phase.maxPerWallet.toString());
    console.log("Wallet Group ID:", phase.walletGroupId.toString());
    console.log("Active:", phase.active);
  } else {
    console.log("\nNo phases exist yet.");
  }

  // Check NFT contract state
  console.log("\n=== NFT Contract State ===");
  const name = await nft.name();
  const symbol = await nft.symbol();
  const totalSupply = await nft.totalSupply();
  const maxSupply = await nft.maxSupply();
  const paused = await nft.paused();
  const owner = await nft.owner();

  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Total Supply:", totalSupply.toString());
  console.log("Max Supply:", maxSupply.toString());
  console.log("Paused:", paused);
  console.log("Owner:", owner);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
