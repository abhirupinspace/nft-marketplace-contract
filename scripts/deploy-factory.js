const { ethers } = require("hardhat");

/**
 * Deploy LaunchpadFactory contract
 * Uses the implementation addresses from deploy-implementations.js
 *
 * Update the addresses below with your deployed implementation addresses
 */

// ============================================
// CONFIGURATION - Update these addresses!
// ============================================

// Implementation addresses (from deploy-implementations.js output)
const ALLOWLIST_MANAGER_IMPL = process.env.ALLOWLIST_MANAGER_IMPL || "0x0000000000000000000000000000000000000000";
const PHASE_MANAGER_IMPL = process.env.PHASE_MANAGER_IMPL || "0x0000000000000000000000000000000000000000";
const NFT_LAUNCHPAD_IMPL = process.env.NFT_LAUNCHPAD_IMPL || "0x0000000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying factory with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");

  // Validate implementation addresses
  if (ALLOWLIST_MANAGER_IMPL === "0x0000000000000000000000000000000000000000") {
    console.error("ERROR: ALLOWLIST_MANAGER_IMPL not set");
    console.error("Run: npx hardhat run scripts/deploy-implementations.js --network baseSepolia");
    console.error("Then set environment variables or update this script");
    process.exit(1);
  }

  console.log("Using implementation addresses:");
  console.log("  AllowlistManager:", ALLOWLIST_MANAGER_IMPL);
  console.log("  PhaseManager:    ", PHASE_MANAGER_IMPL);
  console.log("  NFTLaunchpad:    ", NFT_LAUNCHPAD_IMPL);

  // ============================================
  // Deploy Factory Implementation
  // ============================================

  console.log("\n1. Deploying LaunchpadFactory implementation...");
  const LaunchpadFactory = await ethers.getContractFactory("LaunchpadFactory");
  const factoryImpl = await LaunchpadFactory.deploy();
  await factoryImpl.waitForDeployment();
  const factoryImplAddr = await factoryImpl.getAddress();
  console.log("   Factory impl:", factoryImplAddr);

  // ============================================
  // Deploy Factory Proxy
  // ============================================

  console.log("\n2. Deploying LaunchpadFactory proxy...");
  const SimpleProxy = await ethers.getContractFactory("SimpleProxy");

  const initData = LaunchpadFactory.interface.encodeFunctionData("initialize", [
    deployer.address,
    NFT_LAUNCHPAD_IMPL,
    PHASE_MANAGER_IMPL,
    ALLOWLIST_MANAGER_IMPL
  ]);

  const factoryProxy = await SimpleProxy.deploy(factoryImplAddr, initData);
  await factoryProxy.waitForDeployment();
  const factoryProxyAddr = await factoryProxy.getAddress();
  console.log("   Factory proxy:", factoryProxyAddr);

  // ============================================
  // Verify Deployment
  // ============================================

  console.log("\n3. Verifying deployment...");
  const factory = LaunchpadFactory.attach(factoryProxyAddr);

  const nftImpl = await factory.nftLaunchpadImpl();
  const phaseImpl = await factory.phaseManagerImpl();
  const allowlistImpl = await factory.allowlistManagerImpl();
  const owner = await factory.owner();

  console.log("   Factory owner:", owner);
  console.log("   NFTLaunchpad impl:", nftImpl);
  console.log("   PhaseManager impl:", phaseImpl);
  console.log("   AllowlistManager impl:", allowlistImpl);

  // ============================================
  // Summary
  // ============================================

  console.log("\n" + "=".repeat(60));
  console.log("FACTORY DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\nFactory Addresses:");
  console.log("-".repeat(60));
  console.log("Factory Implementation:", factoryImplAddr);
  console.log("Factory Proxy:         ", factoryProxyAddr);
  console.log("-".repeat(60));
  console.log("\n>>> SAVE THIS FOR YOUR FRONTEND:");
  console.log(`LAUNCHPAD_FACTORY_ADDRESS="${factoryProxyAddr}"`);
  console.log("\nNetwork: Base Sepolia (Chain ID: 84532)");
  console.log("Block Explorer: https://sepolia.basescan.org");
  console.log("\nVerify on BaseScan:");
  console.log(`https://sepolia.basescan.org/address/${factoryProxyAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
