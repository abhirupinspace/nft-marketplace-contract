const { ethers } = require("hardhat");

/**
 * Deploy implementation contracts (one-time deployment)
 * These are shared by all collections deployed via the factory
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying implementations with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");

  // ============================================
  // Deploy Implementation Contracts
  // ============================================

  console.log("Deploying implementation contracts...\n");

  // 1. AllowlistManager Implementation
  console.log("1. Deploying AllowlistManager implementation...");
  const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
  const allowlistManagerImpl = await AllowlistManager.deploy();
  await allowlistManagerImpl.waitForDeployment();
  const allowlistManagerImplAddr = await allowlistManagerImpl.getAddress();
  console.log("   AllowlistManager impl:", allowlistManagerImplAddr);

  // 2. PhaseManager Implementation
  console.log("\n2. Deploying PhaseManager implementation...");
  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const phaseManagerImpl = await PhaseManager.deploy();
  await phaseManagerImpl.waitForDeployment();
  const phaseManagerImplAddr = await phaseManagerImpl.getAddress();
  console.log("   PhaseManager impl:", phaseManagerImplAddr);

  // 3. NFTLaunchpad Implementation
  console.log("\n3. Deploying NFTLaunchpad implementation...");
  const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
  const nftLaunchpadImpl = await NFTLaunchpad.deploy();
  await nftLaunchpadImpl.waitForDeployment();
  const nftLaunchpadImplAddr = await nftLaunchpadImpl.getAddress();
  console.log("   NFTLaunchpad impl:", nftLaunchpadImplAddr);

  // ============================================
  // Summary
  // ============================================

  console.log("\n" + "=".repeat(60));
  console.log("IMPLEMENTATION DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\nImplementation Addresses:");
  console.log("-".repeat(60));
  console.log("AllowlistManager: ", allowlistManagerImplAddr);
  console.log("PhaseManager:     ", phaseManagerImplAddr);
  console.log("NFTLaunchpad:     ", nftLaunchpadImplAddr);
  console.log("-".repeat(60));
  console.log("\n>>> SAVE THESE FOR FACTORY DEPLOYMENT:");
  console.log(`ALLOWLIST_MANAGER_IMPL="${allowlistManagerImplAddr}"`);
  console.log(`PHASE_MANAGER_IMPL="${phaseManagerImplAddr}"`);
  console.log(`NFT_LAUNCHPAD_IMPL="${nftLaunchpadImplAddr}"`);
  console.log("\nNext step: Run deploy-factory.js with these addresses");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
