/**
 * NFT Launchpad - Testnet Deployment Script
 *
 * Deploys the complete NFT Launchpad system:
 * - AllowlistManager (Proxy)
 * - PhaseManager (Proxy)
 * - NFTLaunchpad (Proxy)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-testnet.js --network <network>
 *
 * Supported networks:
 *   - sepolia (Ethereum Sepolia)
 *   - baseSepolia (Base Sepolia)
 *   - polygonAmoy (Polygon Amoy)
 *   - arbitrumSepolia (Arbitrum Sepolia)
 *   - optimismSepolia (Optimism Sepolia)
 *   - localhost (Local Hardhat node)
 */

const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ============================================
// DEPLOYMENT CONFIGURATION
// ============================================

const DEPLOYMENT_CONFIG = {
  // Collection Details (customize these)
  collection: {
    name: process.env.COLLECTION_NAME || "NFT Collection",
    symbol: process.env.COLLECTION_SYMBOL || "NFT",
    maxSupply: parseInt(process.env.MAX_SUPPLY || "10000"),
  },

  // Royalty Settings
  royalty: {
    bps: parseInt(process.env.ROYALTY_BPS || "500"), // 5% = 500 bps
  },

  // Gas settings per network
  gasSettings: {
    sepolia: { gasLimit: 5000000, gasPrice: null },
    baseSepolia: { gasLimit: 5000000, gasPrice: 1000000000 },
    polygonAmoy: { gasLimit: 5000000, gasPrice: 30000000000 },
    arbitrumSepolia: { gasLimit: 5000000, gasPrice: null },
    optimismSepolia: { gasLimit: 5000000, gasPrice: null },
    localhost: { gasLimit: 5000000, gasPrice: null },
    hardhat: { gasLimit: 5000000, gasPrice: null },
  },

  // Block explorer URLs
  explorers: {
    sepolia: "https://sepolia.etherscan.io",
    baseSepolia: "https://sepolia.basescan.org",
    polygonAmoy: "https://amoy.polygonscan.com",
    arbitrumSepolia: "https://sepolia.arbiscan.io",
    optimismSepolia: "https://sepolia-optimism.etherscan.io",
    localhost: "http://localhost:8545",
    hardhat: "http://localhost:8545",
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getNetworkConfig() {
  const networkName = network.name;
  const gasSettings = DEPLOYMENT_CONFIG.gasSettings[networkName] || {};
  const explorer = DEPLOYMENT_CONFIG.explorers[networkName] || "";

  return {
    name: networkName,
    chainId: network.config.chainId,
    gasSettings,
    explorer,
  };
}

function formatAddress(address) {
  return address.toLowerCase();
}

async function saveDeploymentInfo(deploymentInfo) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `${deploymentInfo.network}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${filepath}`);

  // Also save as latest deployment for this network
  const latestFilepath = path.join(deploymentsDir, `${deploymentInfo.network}-latest.json`);
  fs.writeFileSync(latestFilepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Latest deployment saved to: ${latestFilepath}`);
}

function printHeader(text) {
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));
}

function printSection(number, text) {
  console.log(`\n${number}. ${text}`);
}

// ============================================
// MAIN DEPLOYMENT FUNCTION
// ============================================

async function main() {
  const startTime = Date.now();
  const networkConfig = getNetworkConfig();

  printHeader("NFT LAUNCHPAD - TESTNET DEPLOYMENT");
  console.log(`Network: ${networkConfig.name} (Chain ID: ${networkConfig.chainId})`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Balance: ${balanceEth} ETH`);

  if (parseFloat(balanceEth) < 0.01) {
    console.error("\nERROR: Insufficient balance for deployment. Need at least 0.01 ETH.");
    console.log("Get testnet ETH from:");
    console.log("  - Sepolia: https://sepoliafaucet.com");
    console.log("  - Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet");
    console.log("  - Polygon Amoy: https://faucet.polygon.technology");
    process.exit(1);
  }

  // Deployment options
  const deployOpts = {
    initializer: "initialize",
    txOverrides: networkConfig.gasSettings.gasLimit
      ? { gasLimit: networkConfig.gasSettings.gasLimit }
      : {},
  };

  if (networkConfig.gasSettings.gasPrice) {
    deployOpts.txOverrides.gasPrice = networkConfig.gasSettings.gasPrice;
  }

  console.log("\nCollection Config:");
  console.log(`  Name: ${DEPLOYMENT_CONFIG.collection.name}`);
  console.log(`  Symbol: ${DEPLOYMENT_CONFIG.collection.symbol}`);
  console.log(`  Max Supply: ${DEPLOYMENT_CONFIG.collection.maxSupply.toLocaleString()}`);
  console.log(`  Royalty: ${DEPLOYMENT_CONFIG.royalty.bps / 100}%`);

  // Track deployed addresses
  const deployedContracts = {};
  const txHashes = {};

  try {
    // ============================================
    // 1. Deploy AllowlistManager (Proxy)
    // ============================================
    printSection(1, "Deploying AllowlistManager...");

    const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
    const allowlistManager = await upgrades.deployProxy(
      AllowlistManager,
      [deployer.address],
      deployOpts
    );

    const allowlistDeployTx = allowlistManager.deploymentTransaction();
    console.log(`   Tx Hash: ${allowlistDeployTx.hash}`);

    await allowlistManager.waitForDeployment();
    const allowlistManagerAddress = await allowlistManager.getAddress();

    deployedContracts.allowlistManager = allowlistManagerAddress;
    txHashes.allowlistManager = allowlistDeployTx.hash;

    console.log(`   AllowlistManager Proxy: ${allowlistManagerAddress}`);

    // ============================================
    // 2. Deploy PhaseManager (Proxy)
    // ============================================
    printSection(2, "Deploying PhaseManager...");

    const PhaseManager = await ethers.getContractFactory("PhaseManager");
    const phaseManager = await upgrades.deployProxy(
      PhaseManager,
      [deployer.address, allowlistManagerAddress],
      deployOpts
    );

    const phaseDeployTx = phaseManager.deploymentTransaction();
    console.log(`   Tx Hash: ${phaseDeployTx.hash}`);

    await phaseManager.waitForDeployment();
    const phaseManagerAddress = await phaseManager.getAddress();

    deployedContracts.phaseManager = phaseManagerAddress;
    txHashes.phaseManager = phaseDeployTx.hash;

    console.log(`   PhaseManager Proxy: ${phaseManagerAddress}`);

    // ============================================
    // 3. Deploy NFTLaunchpad (Proxy)
    // ============================================
    printSection(3, "Deploying NFTLaunchpad...");

    const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
    const nftLaunchpad = await upgrades.deployProxy(
      NFTLaunchpad,
      [
        DEPLOYMENT_CONFIG.collection.name,
        DEPLOYMENT_CONFIG.collection.symbol,
        DEPLOYMENT_CONFIG.collection.maxSupply,
        deployer.address, // royaltyReceiver
        DEPLOYMENT_CONFIG.royalty.bps,
        phaseManagerAddress,
        allowlistManagerAddress,
      ],
      deployOpts
    );

    const launchpadDeployTx = nftLaunchpad.deploymentTransaction();
    console.log(`   Tx Hash: ${launchpadDeployTx.hash}`);

    await nftLaunchpad.waitForDeployment();
    const nftLaunchpadAddress = await nftLaunchpad.getAddress();

    deployedContracts.nftLaunchpad = nftLaunchpadAddress;
    txHashes.nftLaunchpad = launchpadDeployTx.hash;

    console.log(`   NFTLaunchpad Proxy: ${nftLaunchpadAddress}`);

    // ============================================
    // 4. Link Contracts Together
    // ============================================
    printSection(4, "Linking contracts...");

    // Set launchpad on AllowlistManager
    console.log("   Setting launchpad on AllowlistManager...");
    let tx = await allowlistManager.setLaunchpadContract(nftLaunchpadAddress);
    await tx.wait();
    console.log(`   Tx Hash: ${tx.hash}`);

    // Set PhaseManager on AllowlistManager
    console.log("   Setting PhaseManager on AllowlistManager...");
    tx = await allowlistManager.setPhaseManagerContract(phaseManagerAddress);
    await tx.wait();
    console.log(`   Tx Hash: ${tx.hash}`);

    // Set launchpad on PhaseManager
    console.log("   Setting launchpad on PhaseManager...");
    tx = await phaseManager.setLaunchpadContract(nftLaunchpadAddress);
    await tx.wait();
    console.log(`   Tx Hash: ${tx.hash}`);

    // ============================================
    // 5. Verify Deployment
    // ============================================
    printSection(5, "Verifying deployment...");

    // Verify AllowlistManager
    const allowlistOwner = await allowlistManager.owner();
    console.log(`   AllowlistManager owner: ${allowlistOwner}`);

    // Verify PhaseManager
    const phaseOwner = await phaseManager.owner();
    const phaseAllowlist = await phaseManager.allowlistManager();
    console.log(`   PhaseManager owner: ${phaseOwner}`);
    console.log(`   PhaseManager -> AllowlistManager: ${phaseAllowlist}`);

    // Verify NFTLaunchpad
    const launchpadOwner = await nftLaunchpad.owner();
    const launchpadName = await nftLaunchpad.name();
    const launchpadSymbol = await nftLaunchpad.symbol();
    const launchpadMaxSupply = await nftLaunchpad.maxSupply();
    console.log(`   NFTLaunchpad owner: ${launchpadOwner}`);
    console.log(`   NFTLaunchpad name: ${launchpadName}`);
    console.log(`   NFTLaunchpad symbol: ${launchpadSymbol}`);
    console.log(`   NFTLaunchpad maxSupply: ${launchpadMaxSupply.toString()}`);

    // ============================================
    // DEPLOYMENT SUMMARY
    // ============================================
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    printHeader("DEPLOYMENT COMPLETE!");

    console.log(`\nNetwork: ${networkConfig.name} (Chain ID: ${networkConfig.chainId})`);
    console.log(`Duration: ${duration} seconds`);

    console.log("\n" + "-".repeat(60));
    console.log("CONTRACT ADDRESSES (Proxy):");
    console.log("-".repeat(60));
    console.log(`AllowlistManager: ${deployedContracts.allowlistManager}`);
    console.log(`PhaseManager:     ${deployedContracts.phaseManager}`);
    console.log(`NFTLaunchpad:     ${deployedContracts.nftLaunchpad}`);
    console.log("-".repeat(60));

    console.log("\nFRONTEND INTEGRATION:");
    console.log("-".repeat(60));
    console.log(`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS="${deployedContracts.nftLaunchpad}"`);
    console.log(`NEXT_PUBLIC_CHAIN_ID="${networkConfig.chainId}"`);
    console.log("-".repeat(60));

    if (networkConfig.explorer) {
      console.log("\nBLOCK EXPLORER LINKS:");
      console.log("-".repeat(60));
      console.log(`AllowlistManager: ${networkConfig.explorer}/address/${deployedContracts.allowlistManager}`);
      console.log(`PhaseManager:     ${networkConfig.explorer}/address/${deployedContracts.phaseManager}`);
      console.log(`NFTLaunchpad:     ${networkConfig.explorer}/address/${deployedContracts.nftLaunchpad}`);
      console.log("-".repeat(60));
    }

    console.log("\nNEXT STEPS:");
    console.log("1. Verify contracts on block explorer (run verify script)");
    console.log("2. Update frontend with contract addresses");
    console.log("3. Create initial mint phase");
    console.log("4. Set up payout wallets");
    console.log("5. Configure metadata URIs");

    // Save deployment info
    const deploymentInfo = {
      network: networkConfig.name,
      chainId: networkConfig.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      duration: `${duration}s`,
      contracts: deployedContracts,
      transactionHashes: txHashes,
      config: {
        collection: DEPLOYMENT_CONFIG.collection,
        royalty: DEPLOYMENT_CONFIG.royalty,
      },
      explorer: networkConfig.explorer,
    };

    await saveDeploymentInfo(deploymentInfo);

    return deployedContracts;

  } catch (error) {
    console.error("\nDEPLOYMENT FAILED!");
    console.error(error);
    process.exit(1);
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
