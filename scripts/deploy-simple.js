const { ethers } = require("hardhat");

// Simple transparent proxy deployment without OpenZeppelin's upgrades plugin checks
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.error("ERROR: Account has no ETH. Please fund the account first.");
    console.log("Faucet: https://www.alchemy.com/faucets/base-sepolia");
    process.exit(1);
  }

  // ============================================
  // Deploy Implementation Contracts
  // ============================================

  console.log("1. Deploying AllowlistManager Implementation...");
  const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
  const allowlistManagerImpl = await AllowlistManager.deploy();
  await allowlistManagerImpl.waitForDeployment();
  const allowlistManagerImplAddr = await allowlistManagerImpl.getAddress();
  console.log("   Implementation:", allowlistManagerImplAddr);

  console.log("\n2. Deploying PhaseManager Implementation...");
  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const phaseManagerImpl = await PhaseManager.deploy();
  await phaseManagerImpl.waitForDeployment();
  const phaseManagerImplAddr = await phaseManagerImpl.getAddress();
  console.log("   Implementation:", phaseManagerImplAddr);

  console.log("\n3. Deploying NFTLaunchpad Implementation...");
  const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
  const nftLaunchpadImpl = await NFTLaunchpad.deploy();
  await nftLaunchpadImpl.waitForDeployment();
  const nftLaunchpadImplAddr = await nftLaunchpadImpl.getAddress();
  console.log("   Implementation:", nftLaunchpadImplAddr);

  // ============================================
  // Deploy ERC1967 Proxies
  // ============================================

  // SimpleProxy - our compiled proxy wrapper
  const SimpleProxy = await ethers.getContractFactory("SimpleProxy");

  // AllowlistManager Proxy
  console.log("\n4. Deploying AllowlistManager Proxy...");
  const allowlistInitData = AllowlistManager.interface.encodeFunctionData("initialize", [deployer.address]);
  const allowlistProxy = await SimpleProxy.deploy(allowlistManagerImplAddr, allowlistInitData);
  await allowlistProxy.waitForDeployment();
  const allowlistProxyAddr = await allowlistProxy.getAddress();
  console.log("   Proxy:", allowlistProxyAddr);

  // PhaseManager Proxy
  console.log("\n5. Deploying PhaseManager Proxy...");
  const phaseInitData = PhaseManager.interface.encodeFunctionData("initialize", [deployer.address, allowlistProxyAddr]);
  const phaseProxy = await SimpleProxy.deploy(phaseManagerImplAddr, phaseInitData);
  await phaseProxy.waitForDeployment();
  const phaseProxyAddr = await phaseProxy.getAddress();
  console.log("   Proxy:", phaseProxyAddr);

  // NFTLaunchpad Proxy
  console.log("\n6. Deploying NFTLaunchpad Proxy...");
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
  console.log("\n7. Linking contracts...");

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
  console.log("\nImplementation Addresses:");
  console.log("-".repeat(60));
  console.log("AllowlistManager Impl:  ", allowlistManagerImplAddr);
  console.log("PhaseManager Impl:      ", phaseManagerImplAddr);
  console.log("NFTLaunchpad Impl:      ", nftLaunchpadImplAddr);
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
