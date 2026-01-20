const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");

  // Deployment options for upgrades
  const deployOpts = {
    initializer: "initialize",
    txOverrides: { gasLimit: 5000000 }
  };

  // ============================================
  // 1. Deploy AllowlistManager (Proxy)
  // ============================================
  console.log("1. Deploying AllowlistManager...");
  const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
  const allowlistManager = await upgrades.deployProxy(
    AllowlistManager,
    [deployer.address], // initialize(address _owner)
    deployOpts
  );
  await allowlistManager.waitForDeployment();
  const allowlistManagerAddress = await allowlistManager.getAddress();
  console.log("   AllowlistManager Proxy:", allowlistManagerAddress);

  // ============================================
  // 2. Deploy PhaseManager (Proxy)
  // ============================================
  console.log("\n2. Deploying PhaseManager...");
  const PhaseManager = await ethers.getContractFactory("PhaseManager");
  const phaseManager = await upgrades.deployProxy(
    PhaseManager,
    [deployer.address, allowlistManagerAddress], // initialize(address _owner, address _allowlistManager)
    deployOpts
  );
  await phaseManager.waitForDeployment();
  const phaseManagerAddress = await phaseManager.getAddress();
  console.log("   PhaseManager Proxy:", phaseManagerAddress);

  // ============================================
  // 3. Deploy NFTLaunchpad (Proxy)
  // ============================================
  console.log("\n3. Deploying NFTLaunchpad...");
  const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
  const nftLaunchpad = await upgrades.deployProxy(
    NFTLaunchpad,
    [
      "NFT Collection",      // name
      "NFT",                 // symbol
      10000,                 // maxSupply
      deployer.address,      // royaltyReceiver
      500,                   // royaltyBps (5%)
      phaseManagerAddress,   // phaseManager
      allowlistManagerAddress // allowlistManager
    ],
    deployOpts
  );
  await nftLaunchpad.waitForDeployment();
  const nftLaunchpadAddress = await nftLaunchpad.getAddress();
  console.log("   NFTLaunchpad Proxy:", nftLaunchpadAddress);

  // ============================================
  // 4. Link contracts together
  // ============================================
  console.log("\n4. Linking contracts...");

  // Set launchpad on AllowlistManager
  console.log("   Setting launchpad on AllowlistManager...");
  let tx = await allowlistManager.setLaunchpadContract(nftLaunchpadAddress);
  await tx.wait();

  // Set PhaseManager on AllowlistManager
  console.log("   Setting PhaseManager on AllowlistManager...");
  tx = await allowlistManager.setPhaseManagerContract(phaseManagerAddress);
  await tx.wait();

  // Set launchpad on PhaseManager
  console.log("   Setting launchpad on PhaseManager...");
  tx = await phaseManager.setLaunchpadContract(nftLaunchpadAddress);
  await tx.wait();

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\nContract Addresses (Base Sepolia):");
  console.log("-".repeat(60));
  console.log("AllowlistManager Proxy: ", allowlistManagerAddress);
  console.log("PhaseManager Proxy:     ", phaseManagerAddress);
  console.log("NFTLaunchpad Proxy:     ", nftLaunchpadAddress);
  console.log("-".repeat(60));
  console.log("\nSave the NFTLaunchpad address for your frontend integration:");
  console.log(`NFT_CONTRACT_ADDRESS="${nftLaunchpadAddress}"`);
  console.log("\nNetwork: Base Sepolia (Chain ID: 84532)");
  console.log("Block Explorer: https://sepolia.basescan.org");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
