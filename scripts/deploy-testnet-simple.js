/**
 * NFT Launchpad - Simple Testnet Deployment Script
 *
 * This script deploys contracts without using OpenZeppelin's upgrades plugin,
 * which requires RPC methods that some public endpoints don't support.
 *
 * It deploys:
 * - Implementation contracts directly
 * - ERC1967 Proxy contracts pointing to implementations
 *
 * Usage:
 *   npx hardhat run scripts/deploy-testnet-simple.js --network <network>
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ============================================
// DEPLOYMENT CONFIGURATION
// ============================================

const DEPLOYMENT_CONFIG = {
  collection: {
    name: process.env.COLLECTION_NAME || "My NFT Collection",
    symbol: process.env.COLLECTION_SYMBOL || "MNFT",
    maxSupply: parseInt(process.env.MAX_SUPPLY || "10000"),
  },
  royalty: {
    bps: parseInt(process.env.ROYALTY_BPS || "500"),
  },
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
// SIMPLE ERC1967 PROXY CONTRACT
// ============================================

const SIMPLE_PROXY_BYTECODE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ERC1967Proxy {
    bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory _data) payable {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, implementation)
        }
        if (_data.length > 0) {
            (bool success, ) = implementation.delegatecall(_data);
            require(success, "Initialization failed");
        }
    }

    fallback() external payable {
        assembly {
            let implementation := sload(_IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
`;

// ============================================
// HELPER FUNCTIONS
// ============================================

function getNetworkConfig() {
  const networkName = network.name;
  const explorer = DEPLOYMENT_CONFIG.explorers[networkName] || "";
  return { name: networkName, chainId: network.config.chainId, explorer };
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

  printHeader("NFT LAUNCHPAD - TESTNET DEPLOYMENT (Simple Mode)");
  console.log(`Network: ${networkConfig.name} (Chain ID: ${networkConfig.chainId})`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Balance: ${balanceEth} ETH`);

  if (parseFloat(balanceEth) < 0.01) {
    console.error("\nERROR: Insufficient balance. Need at least 0.01 ETH.");
    process.exit(1);
  }

  console.log("\nCollection Config:");
  console.log(`  Name: ${DEPLOYMENT_CONFIG.collection.name}`);
  console.log(`  Symbol: ${DEPLOYMENT_CONFIG.collection.symbol}`);
  console.log(`  Max Supply: ${DEPLOYMENT_CONFIG.collection.maxSupply.toLocaleString()}`);
  console.log(`  Royalty: ${DEPLOYMENT_CONFIG.royalty.bps / 100}%`);

  const deployedContracts = {};
  const implementationAddresses = {};
  const txHashes = {};

  try {
    // Get contract factories
    const AllowlistManager = await ethers.getContractFactory("AllowlistManager");
    const PhaseManager = await ethers.getContractFactory("PhaseManager");
    const NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
    const SimpleProxy = await ethers.getContractFactory("SimpleProxy");

    // ============================================
    // 1. Deploy AllowlistManager Implementation
    // ============================================
    printSection(1, "Deploying AllowlistManager...");

    console.log("   Deploying implementation...");
    const allowlistImpl = await AllowlistManager.deploy();
    await allowlistImpl.waitForDeployment();
    const allowlistImplAddress = await allowlistImpl.getAddress();
    implementationAddresses.allowlistManager = allowlistImplAddress;
    console.log(`   Implementation: ${allowlistImplAddress}`);

    // Deploy proxy
    console.log("   Deploying proxy...");
    const allowlistInitData = AllowlistManager.interface.encodeFunctionData("initialize", [deployer.address]);
    const allowlistProxy = await SimpleProxy.deploy(allowlistImplAddress, allowlistInitData);
    await allowlistProxy.waitForDeployment();
    const allowlistProxyAddress = await allowlistProxy.getAddress();
    deployedContracts.allowlistManager = allowlistProxyAddress;
    txHashes.allowlistManager = allowlistProxy.deploymentTransaction().hash;
    console.log(`   Proxy: ${allowlistProxyAddress}`);

    // ============================================
    // 2. Deploy PhaseManager Implementation
    // ============================================
    printSection(2, "Deploying PhaseManager...");

    console.log("   Deploying implementation...");
    const phaseImpl = await PhaseManager.deploy();
    await phaseImpl.waitForDeployment();
    const phaseImplAddress = await phaseImpl.getAddress();
    implementationAddresses.phaseManager = phaseImplAddress;
    console.log(`   Implementation: ${phaseImplAddress}`);

    // Deploy proxy
    console.log("   Deploying proxy...");
    const phaseInitData = PhaseManager.interface.encodeFunctionData("initialize", [
      deployer.address,
      allowlistProxyAddress,
    ]);
    const phaseProxy = await SimpleProxy.deploy(phaseImplAddress, phaseInitData);
    await phaseProxy.waitForDeployment();
    const phaseProxyAddress = await phaseProxy.getAddress();
    deployedContracts.phaseManager = phaseProxyAddress;
    txHashes.phaseManager = phaseProxy.deploymentTransaction().hash;
    console.log(`   Proxy: ${phaseProxyAddress}`);

    // ============================================
    // 3. Deploy NFTLaunchpad Implementation
    // ============================================
    printSection(3, "Deploying NFTLaunchpad...");

    console.log("   Deploying implementation...");
    const launchpadImpl = await NFTLaunchpad.deploy();
    await launchpadImpl.waitForDeployment();
    const launchpadImplAddress = await launchpadImpl.getAddress();
    implementationAddresses.nftLaunchpad = launchpadImplAddress;
    console.log(`   Implementation: ${launchpadImplAddress}`);

    // Deploy proxy
    console.log("   Deploying proxy...");
    const launchpadInitData = NFTLaunchpad.interface.encodeFunctionData("initialize", [
      DEPLOYMENT_CONFIG.collection.name,
      DEPLOYMENT_CONFIG.collection.symbol,
      DEPLOYMENT_CONFIG.collection.maxSupply,
      deployer.address, // royaltyReceiver
      DEPLOYMENT_CONFIG.royalty.bps,
      phaseProxyAddress,
      allowlistProxyAddress,
    ]);
    const launchpadProxy = await SimpleProxy.deploy(launchpadImplAddress, launchpadInitData);
    await launchpadProxy.waitForDeployment();
    const launchpadProxyAddress = await launchpadProxy.getAddress();
    deployedContracts.nftLaunchpad = launchpadProxyAddress;
    txHashes.nftLaunchpad = launchpadProxy.deploymentTransaction().hash;
    console.log(`   Proxy: ${launchpadProxyAddress}`);

    // ============================================
    // 4. Link Contracts Together
    // ============================================
    printSection(4, "Linking contracts...");

    // Get contract instances at proxy addresses
    const allowlistManager = AllowlistManager.attach(allowlistProxyAddress);
    const phaseManager = PhaseManager.attach(phaseProxyAddress);

    // Set launchpad on AllowlistManager
    console.log("   Setting launchpad on AllowlistManager...");
    let tx = await allowlistManager.setLaunchpadContract(launchpadProxyAddress);
    await tx.wait();
    console.log(`   Tx: ${tx.hash}`);

    // Set PhaseManager on AllowlistManager
    console.log("   Setting PhaseManager on AllowlistManager...");
    tx = await allowlistManager.setPhaseManagerContract(phaseProxyAddress);
    await tx.wait();
    console.log(`   Tx: ${tx.hash}`);

    // Set launchpad on PhaseManager
    console.log("   Setting launchpad on PhaseManager...");
    tx = await phaseManager.setLaunchpadContract(launchpadProxyAddress);
    await tx.wait();
    console.log(`   Tx: ${tx.hash}`);

    // ============================================
    // 5. Verify Deployment
    // ============================================
    printSection(5, "Verifying deployment...");

    const nftLaunchpad = NFTLaunchpad.attach(launchpadProxyAddress);
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
    console.log("IMPLEMENTATION ADDRESSES:");
    console.log("-".repeat(60));
    console.log(`AllowlistManager: ${implementationAddresses.allowlistManager}`);
    console.log(`PhaseManager:     ${implementationAddresses.phaseManager}`);
    console.log(`NFTLaunchpad:     ${implementationAddresses.nftLaunchpad}`);

    console.log("\n" + "-".repeat(60));
    console.log("PROXY ADDRESSES (use these):");
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
      console.log("\nBLOCK EXPLORER:");
      console.log("-".repeat(60));
      console.log(`NFTLaunchpad: ${networkConfig.explorer}/address/${deployedContracts.nftLaunchpad}`);
      console.log("-".repeat(60));
    }

    // Save deployment info
    const deploymentInfo = {
      network: networkConfig.name,
      chainId: networkConfig.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      duration: `${duration}s`,
      contracts: deployedContracts,
      implementations: implementationAddresses,
      transactionHashes: txHashes,
      config: {
        collection: DEPLOYMENT_CONFIG.collection,
        royalty: DEPLOYMENT_CONFIG.royalty,
      },
      explorer: networkConfig.explorer,
    };

    await saveDeploymentInfo(deploymentInfo);

    console.log("\nNEXT STEPS:");
    console.log("1. Create a mint phase: npm run setup-phase:base-sepolia");
    console.log("2. Update frontend with contract address");
    console.log("3. Test minting on frontend");

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
