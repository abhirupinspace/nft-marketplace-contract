# NFT Launchpad - Deployment Guide

This guide covers deploying the NFT Launchpad smart contracts to various testnets.

## Prerequisites

1. **Node.js** (v18 or higher)
2. **npm** or **yarn**
3. **Wallet with testnet ETH** (for gas fees)
4. **Block explorer API keys** (for contract verification)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env with your private key and API keys

# 4. Compile contracts
npm run compile

# 5. Deploy to Base Sepolia (recommended for testing)
npm run deploy:base-sepolia

# 6. Verify contracts
npm run verify:base-sepolia

# 7. Create a test mint phase
npm run setup-phase:base-sepolia
```

## Environment Setup

### 1. Create `.env` file

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

### 2. Required Environment Variables

```env
# Your deployer wallet private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Collection configuration
COLLECTION_NAME="My NFT Collection"
COLLECTION_SYMBOL="MNFT"
MAX_SUPPLY=10000
ROYALTY_BPS=500  # 5% royalty

# Block explorer API keys (for verification)
BASESCAN_API_KEY=your_basescan_api_key
```

### 3. Get Testnet ETH

| Network | Faucet URL |
|---------|------------|
| Sepolia | https://sepoliafaucet.com |
| Base Sepolia | https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet |
| Polygon Amoy | https://faucet.polygon.technology |
| Arbitrum Sepolia | https://www.alchemy.com/faucets/arbitrum-sepolia |
| Optimism Sepolia | https://www.alchemy.com/faucets/optimism-sepolia |

## Deployment Commands

### Testnets

```bash
# Ethereum Sepolia
npm run deploy:sepolia

# Base Sepolia (recommended - low gas fees)
npm run deploy:base-sepolia

# Polygon Amoy
npm run deploy:polygon-amoy

# Arbitrum Sepolia
npm run deploy:arbitrum-sepolia

# Optimism Sepolia
npm run deploy:optimism-sepolia

# Local development
npm run node  # In terminal 1
npm run deploy:local  # In terminal 2
```

### Custom Deployment

You can also run the deployment script directly with custom parameters:

```bash
# Set environment variables for collection config
export COLLECTION_NAME="Cool NFTs"
export COLLECTION_SYMBOL="COOL"
export MAX_SUPPLY=5000
export ROYALTY_BPS=250  # 2.5%

# Deploy
npx hardhat run scripts/deploy-testnet.js --network baseSepolia
```

## Contract Verification

After deployment, verify your contracts on the block explorer:

```bash
# Verify on the same network you deployed to
npm run verify:base-sepolia
npm run verify:sepolia
npm run verify:polygon-amoy
```

**Note:** OpenZeppelin upgradeable proxy contracts may show verification warnings. The implementation contracts are what matter for verification.

## Deployment Output

After successful deployment, you'll see:

```
============================================================
DEPLOYMENT COMPLETE!
============================================================

Network: baseSepolia (Chain ID: 84532)
Duration: 45.23 seconds

------------------------------------------------------------
CONTRACT ADDRESSES (Proxy):
------------------------------------------------------------
AllowlistManager: 0x1234...
PhaseManager:     0x5678...
NFTLaunchpad:     0x9abc...
------------------------------------------------------------

FRONTEND INTEGRATION:
------------------------------------------------------------
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS="0x9abc..."
NEXT_PUBLIC_CHAIN_ID="84532"
------------------------------------------------------------
```

## Deployment Files

Deployments are saved to `./deployments/`:

```
deployments/
├── baseSepolia-latest.json    # Most recent deployment
├── baseSepolia-1234567890.json  # Timestamped backup
├── sepolia-latest.json
└── ...
```

Each file contains:
- Contract addresses
- Transaction hashes
- Deployment configuration
- Timestamp and network info

## Post-Deployment Setup

### 1. Create a Mint Phase

```bash
# Create a public test phase
npm run setup-phase:base-sepolia
```

Or manually:

```javascript
// Using ethers.js
const phaseManager = await ethers.getContractAt("PhaseManager", PHASE_MANAGER_ADDRESS);

await phaseManager.createMintPhase(
  "Public Sale",           // name
  startTimestamp,          // startTime
  endTimestamp,            // endTime
  ethers.parseEther("0.01"), // price
  1000,                    // maxSupply
  5,                       // maxPerWallet
  0,                       // walletGroupId (0 = public)
  false,                   // buyXGetY
  0,                       // buyAmount
  0                        // getAmount
);
```

### 2. Configure Payout Wallets

```javascript
const nftLaunchpad = await ethers.getContractAt("NFTLaunchpad", LAUNCHPAD_ADDRESS);

// Add payout wallets (must total 100% = 10000 bps)
await nftLaunchpad.addPayoutWallet(
  "0xYourWallet...",
  10000  // 100%
);
```

### 3. Set Metadata URIs

```javascript
// Set placeholder URI (shown before reveal)
await nftLaunchpad.setPlaceholderURI("ipfs://placeholder-hash/hidden.json");

// Set base URI (shown after reveal)
await nftLaunchpad.setBaseURI("ipfs://collection-hash/");

// Reveal collection
await nftLaunchpad.reveal();

// Lock metadata permanently (optional)
await nftLaunchpad.lockMetadata();
```

## Frontend Integration

Update your frontend `.env.local`:

```env
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS="0x..."
NEXT_PUBLIC_CHAIN_ID="84532"
```

## Troubleshooting

### "Insufficient balance"
Get testnet ETH from the faucets listed above.

### "Transaction failed"
- Check gas settings in `hardhat.config.js`
- Increase `gasLimit` if needed
- Try again - testnet RPCs can be unreliable

### "Verification failed"
- Wait a few minutes and retry
- Check API key is correct
- Try manual verification on the block explorer

### "Already verified"
This is not an error - the contract is already verified.

## Architecture

The system deploys 3 proxy contracts:

```
┌─────────────────────┐
│   NFTLaunchpad      │  Main ERC721A contract
│   (Proxy)           │  - Minting
└─────────┬───────────┘  - Metadata
          │              - Revenue
          ▼
┌─────────────────────┐
│   PhaseManager      │  Phase configuration
│   (Proxy)           │  - Timing
└─────────┬───────────┘  - Pricing
          │              - Supply limits
          ▼
┌─────────────────────┐
│  AllowlistManager   │  Wallet groups
│   (Proxy)           │  - Allowlists
└─────────────────────┘  - Merkle proofs
                         - Per-wallet overrides
```

## Security Notes

1. **Never commit your `.env` file**
2. **Use a dedicated deployment wallet** - don't use your main wallet
3. **Test thoroughly on testnet** before mainnet
4. **Consider a security audit** before mainnet launch
5. **Verify all contracts** on block explorers

## Support

For issues with deployment:
1. Check this documentation
2. Review the error message carefully
3. Search existing issues
4. Create a new issue with full error details
