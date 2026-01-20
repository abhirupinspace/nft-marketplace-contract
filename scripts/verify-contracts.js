/**
 * NFT Launchpad - Contract Verification Script
 *
 * Verifies deployed contracts on block explorers (Etherscan, Basescan, etc.)
 *
 * Usage:
 *   npx hardhat run scripts/verify-contracts.js --network <network>
 *
 * Prerequisites:
 *   - Contracts must be deployed first
 *   - API keys must be set in .env file
 *   - Deployment file must exist in ./deployments/
 */

const { run, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ============================================
// CONFIGURATION
// ============================================

const VERIFICATION_CONFIG = {
  // Delay between verifications (to avoid rate limiting)
  delayMs: 5000,

  // Number of retries for failed verifications
  maxRetries: 3,
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyContract(address, constructorArguments, contractName, retryCount = 0) {
  console.log(`\nVerifying ${contractName} at ${address}...`);

  try {
    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    console.log(`   ${contractName} verified successfully!`);
    return true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log(`   ${contractName} is already verified.`);
      return true;
    }

    if (retryCount < VERIFICATION_CONFIG.maxRetries) {
      console.log(`   Verification failed, retrying... (${retryCount + 1}/${VERIFICATION_CONFIG.maxRetries})`);
      await sleep(VERIFICATION_CONFIG.delayMs);
      return verifyContract(address, constructorArguments, contractName, retryCount + 1);
    }

    console.error(`   Failed to verify ${contractName}:`, error.message);
    return false;
  }
}

function printHeader(text) {
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));
}

// ============================================
// MAIN VERIFICATION FUNCTION
// ============================================

async function main() {
  const networkName = network.name;

  printHeader("NFT LAUNCHPAD - CONTRACT VERIFICATION");
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

  const contracts = deploymentInfo.contracts;
  const results = {
    success: [],
    failed: [],
    skipped: [],
  };

  console.log("\nContracts to verify:");
  console.log(`  AllowlistManager: ${contracts.allowlistManager}`);
  console.log(`  PhaseManager: ${contracts.phaseManager}`);
  console.log(`  NFTLaunchpad: ${contracts.nftLaunchpad}`);

  // ============================================
  // Note: For proxy contracts deployed with OpenZeppelin upgrades,
  // the implementation contracts are automatically verified.
  // We verify the proxy contracts here.
  // ============================================

  console.log("\n" + "-".repeat(60));
  console.log("VERIFYING CONTRACTS");
  console.log("-".repeat(60));

  // For OpenZeppelin Transparent Proxies, we need to verify the implementation contracts
  // The proxy verification is handled differently

  console.log("\nNote: Proxy contracts use OpenZeppelin Transparent Proxy pattern.");
  console.log("Implementation contracts should be auto-verified during deployment.");
  console.log("\nAttempting to verify proxy contracts...\n");

  // Verify AllowlistManager Proxy
  console.log("1. AllowlistManager Proxy");
  try {
    // For proxy contracts, we try to verify them as proxies
    await run("verify:verify", {
      address: contracts.allowlistManager,
      constructorArguments: [],
    });
    console.log("   Verified!");
    results.success.push("AllowlistManager");
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("   Already verified.");
      results.success.push("AllowlistManager");
    } else if (error.message.includes("does not have bytecode")) {
      console.log("   Proxy contract - implementation should be verified.");
      results.skipped.push("AllowlistManager");
    } else {
      console.log(`   Failed: ${error.message}`);
      results.failed.push("AllowlistManager");
    }
  }

  await sleep(VERIFICATION_CONFIG.delayMs);

  // Verify PhaseManager Proxy
  console.log("\n2. PhaseManager Proxy");
  try {
    await run("verify:verify", {
      address: contracts.phaseManager,
      constructorArguments: [],
    });
    console.log("   Verified!");
    results.success.push("PhaseManager");
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("   Already verified.");
      results.success.push("PhaseManager");
    } else if (error.message.includes("does not have bytecode")) {
      console.log("   Proxy contract - implementation should be verified.");
      results.skipped.push("PhaseManager");
    } else {
      console.log(`   Failed: ${error.message}`);
      results.failed.push("PhaseManager");
    }
  }

  await sleep(VERIFICATION_CONFIG.delayMs);

  // Verify NFTLaunchpad Proxy
  console.log("\n3. NFTLaunchpad Proxy");
  try {
    await run("verify:verify", {
      address: contracts.nftLaunchpad,
      constructorArguments: [],
    });
    console.log("   Verified!");
    results.success.push("NFTLaunchpad");
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("   Already verified.");
      results.success.push("NFTLaunchpad");
    } else if (error.message.includes("does not have bytecode")) {
      console.log("   Proxy contract - implementation should be verified.");
      results.skipped.push("NFTLaunchpad");
    } else {
      console.log(`   Failed: ${error.message}`);
      results.failed.push("NFTLaunchpad");
    }
  }

  // ============================================
  // VERIFICATION SUMMARY
  // ============================================

  printHeader("VERIFICATION SUMMARY");

  console.log(`\nSuccessfully Verified: ${results.success.length}`);
  results.success.forEach((name) => console.log(`  - ${name}`));

  if (results.skipped.length > 0) {
    console.log(`\nSkipped (Proxies): ${results.skipped.length}`);
    results.skipped.forEach((name) => console.log(`  - ${name}`));
  }

  if (results.failed.length > 0) {
    console.log(`\nFailed: ${results.failed.length}`);
    results.failed.forEach((name) => console.log(`  - ${name}`));
  }

  // Print explorer links
  if (deploymentInfo.explorer) {
    console.log("\n" + "-".repeat(60));
    console.log("BLOCK EXPLORER LINKS:");
    console.log("-".repeat(60));
    console.log(`AllowlistManager: ${deploymentInfo.explorer}/address/${contracts.allowlistManager}#code`);
    console.log(`PhaseManager:     ${deploymentInfo.explorer}/address/${contracts.phaseManager}#code`);
    console.log(`NFTLaunchpad:     ${deploymentInfo.explorer}/address/${contracts.nftLaunchpad}#code`);
    console.log("-".repeat(60));
  }

  if (results.failed.length > 0) {
    console.log("\nSome verifications failed. You can try:");
    console.log("1. Wait a few minutes and run this script again");
    console.log("2. Verify manually on the block explorer");
    console.log("3. Check that your API keys are correct in .env");
    process.exit(1);
  }

  console.log("\nVerification complete!");
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
