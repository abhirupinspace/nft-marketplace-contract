const { ethers } = require("hardhat");

// Continue deployment from already deployed implementations
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying proxies with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");

  // Already deployed implementation addresses
  const allowlistManagerImplAddr = "0xAD30691399A9d28326d6795D64d6B78FDb08A6b4";
  const phaseManagerImplAddr = "0x183136577520B08ED2A8C8D833B375565C5c5aca";
  const nftLaunchpadImplAddr = "0x4c40a39650c398d80517cD9c9cD9400eD833Da37";

  console.log("Using existing implementations:");
  console.log("  AllowlistManager:", allowlistManagerImplAddr);
  console.log("  PhaseManager:", phaseManagerImplAddr);
  console.log("  NFTLaunchpad:", nftLaunchpadImplAddr);

  // Get contract factories for interface encoding
  const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
  const SimpleProxy = await ethers.getContractFactory("SimpleProxy");

  // ============================================
  // Deploy Proxies
  // ============================================

  // AllowlistManager Proxy
  console.log("\n1. Deploying AllowlistManager Proxy...");
  const allowlistInitData = AllowlistManager.interface.encodeFunctionData("initialize", [deployer.address]);
  const allowlistProxy = await SimpleProxy.deploy(allowlistManagerImplAddr, allowlistInitData);
  await allowlistProxy.waitForDeployment();
  const allowlistProxyAddr = await allowlistProxy.getAddress();
  console.log("   Proxy:", allowlistProxyAddr);

  // PhaseManager Proxy
  console.log("\n2. Deploying PhaseManager Proxy...");
  const phaseInitData = PhaseManager.interface.encodeFunctionData("initialize", [deployer.address, allowlistProxyAddr]);
  const phaseProxy = await SimpleProxy.deploy(phaseManagerImplAddr, phaseInitData);
  await phaseProxy.waitForDeployment();
  const phaseProxyAddr = await phaseProxy.getAddress();
  console.log("   Proxy:", phaseProxyAddr);

  // NFTLaunchpad Proxy
  console.log("\n3. Deploying NFTLaunchpad Proxy...");
  const launchpadInitData = NFTLaunchpad.interface.encodeFunctionData("initialize", [
    "NFT Collection",      // name
    "NFT",                 // symbol
    10000,                 // maxSupply
    deployer.address,      // royaltyReceiver
    500,                   // royaltyBps (5%)
    phaseProxyAddr,        // phaseManager
    allowlistProxyAddr     // allowlistManager
  ]);
  const launchpadProxy = await SimpleProxy.deploy(nftLaunchpadImplAddr, launchpadInitData);
  await launchpadProxy.waitForDeployment();
  const launchpadProxyAddr = await launchpadProxy.getAddress();
  console.log("   Proxy:", launchpadProxyAddr);

  // ============================================
  // Link contracts together
  // ============================================
  console.log("\n4. Linking contracts...");

  // Get contract instances at proxy addresses
  const allowlistManagerContract = AllowlistManager.attach(allowlistProxyAddr);
  const phaseManagerContract = PhaseManager.attach(phaseProxyAddr);

  // Set launchpad on AllowlistManager
  console.log("   Setting launchpad on AllowlistManager...");
  let tx = await allowlistManagerContract.setLaunchpadContract(launchpadProxyAddr);
  await tx.wait();

  // Set PhaseManager on AllowlistManager
  console.log("   Setting PhaseManager on AllowlistManager...");
  tx = await allowlistManagerContract.setPhaseManagerContract(phaseProxyAddr);
  await tx.wait();

  // Set launchpad on PhaseManager
  console.log("   Setting launchpad on PhaseManager...");
  tx = await phaseManagerContract.setLaunchpadContract(launchpadProxyAddr);
  await tx.wait();

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\nProxy Addresses (use these for interaction):");
  console.log("-".repeat(60));
  console.log("AllowlistManager Proxy: ", allowlistProxyAddr);
  console.log("PhaseManager Proxy:     ", phaseProxyAddr);
  console.log("NFTLaunchpad Proxy:     ", launchpadProxyAddr);
  console.log("-".repeat(60));
  console.log("\n>>> SAVE THIS FOR YOUR FRONTEND:");
  console.log(`NFT_CONTRACT_ADDRESS="${launchpadProxyAddr}"`);
  console.log("\nNetwork: Base Sepolia (Chain ID: 84532)");
  console.log("Block Explorer: https://sepolia.basescan.org");
  console.log("\nVerify on BaseScan:");
  console.log(`https://sepolia.basescan.org/address/${launchpadProxyAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
