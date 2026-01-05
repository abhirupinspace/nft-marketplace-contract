# NFT Launchpad Smart Contract

Production-grade ERC721A NFT Launchpad contract with comprehensive features for phase-based minting, allowlists, airdrops, revenue splitting, and advanced controls.

## Features

- **ERC721A** - Gas-efficient batch minting (~2000 gas saved per mint)
- **Phase-Based Minting** - Multiple sale phases with time windows, pricing, and supply caps
- **Wallet Groups (Allowlists)** - VIP, Whitelist, Team tiers with custom pricing
- **Per-Wallet Overrides** - Individual pricing and mint limits
- **Buy X Get Y** - Promotional bonus mints (e.g., "Buy 3 Get 1 Free")
- **Airdrops** - Batch mint to multiple wallets
- **Revenue Splitting** - Multiple payout wallets with percentage splits
- **Metadata & Reveal** - Placeholder -> Reveal -> Lock system
- **ERC2981 Royalties** - On-chain royalty standard
- **Access Controls** - Pause, transfer lock, burn controls
- **Upgradeable** - UUPS proxy pattern support

## Tech Stack

- **Solidity** 0.8.23
- **Hardhat** - Development framework
- **ERC721A Upgradeable** - Gas-optimized NFT standard
- **OpenZeppelin Upgradeable** - Security contracts
- **ThirdWeb** - Deployment tools
- **zkSync Era** - L2 support

## Quick Start

```bash
bun install           # Install dependencies
bun run compile       # Compile contracts
bun run test          # Run tests (requires Node.js v22 LTS)
bun run deploy        # Deploy via ThirdWeb
```

## Installation

```bash
# Install dependencies
bun install

# Compile contracts
bun run compile

# Run tests (requires Node.js v22 LTS)
bun run test
```

## Environment Variables

Create a `.env` file in the root directory:

```env
PRIVATE_KEY=your_wallet_private_key
THIRDWEB_SECRET_KEY=your_thirdweb_secret_key
```

## Contract Architecture

```
NFTLaunchpad
├── ERC721AUpgradeable (batch minting)
├── Initializable (upgradeable pattern)
└── Custom Modules:
    ├── Minting (mint, adminMint, airdrop)
    ├── Phase Management (create, update, toggle)
    ├── Wallet Groups (allowlists with overrides)
    ├── Supply Management (increase/decrease)
    ├── Metadata (URI, reveal, lock)
    ├── Revenue (payout wallets, withdraw)
    └── Controls (pause, transfers, burn, royalties)
```

## Core Data Structures

### MintPhase
```solidity
struct MintPhase {
    string name;           // "VIP Sale", "Public"
    uint256 startTime;     // Unix timestamp
    uint256 endTime;       // Unix timestamp
    uint256 price;         // Price in wei
    uint256 maxSupply;     // Phase supply cap
    uint256 minted;        // Already minted
    uint256 maxPerWallet;  // Per-wallet limit
    uint256 walletGroupId; // 0 = public
    bool active;           // Enabled/disabled
    bool buyXGetY;         // Bonus enabled
    uint256 buyAmount;     // Buy X
    uint256 getAmount;     // Get Y free
}
```

### WalletGroup
```solidity
struct WalletGroup {
    string name;            // "VIP", "Whitelist"
    uint256 defaultPrice;   // Group default price
    uint256 defaultMaxMint; // Group default limit
    bool active;            // Enabled/disabled
}
```

### PayoutWallet
```solidity
struct PayoutWallet {
    address wallet;          // Recipient address
    uint256 sharePercentage; // Out of 10000 (100%)
}
```

## API Reference

### Minting Functions

| Function | Description |
|----------|-------------|
| `mint(quantity, phaseId)` | Public mint during active phase |
| `adminMint(to, quantity)` | Owner mint (bypasses phases) |
| `airdrop(recipients[], quantities[])` | Batch airdrop |
| `airdropToGroup(groupId, wallets[], quantity)` | Group airdrop |

### Phase Management

| Function | Description |
|----------|-------------|
| `createMintPhase(...)` | Create new sale phase |
| `updateMintPhase(phaseId, ...)` | Modify existing phase |
| `togglePhase(phaseId)` | Enable/disable phase |

### Wallet Groups

| Function | Description |
|----------|-------------|
| `createWalletGroup(name, price, maxMint)` | Create allowlist group |
| `addWalletsToGroup(groupId, wallets[])` | Bulk add wallets |
| `addWalletWithOverride(groupId, wallet, price, max)` | Add with custom settings |
| `removeWalletFromGroup(groupId, wallet)` | Remove wallet |
| `bulkUpdateWallets(groupId, wallets[], prices[], maxes[])` | Bulk update |

### Revenue Management

| Function | Description |
|----------|-------------|
| `addPayoutWallet(wallet, sharePercentage)` | Add revenue recipient |
| `updatePayoutWallet(index, wallet, share)` | Update recipient |
| `removePayoutWallet(index)` | Remove recipient |
| `withdraw()` | Distribute funds (requires 100% total shares) |

### Metadata

| Function | Description |
|----------|-------------|
| `setBaseURI(uri)` | Set IPFS metadata base |
| `setPlaceholderURI(uri)` | Set pre-reveal placeholder |
| `reveal()` | Switch to revealed metadata |
| `lockMetadata()` | Permanently lock (irreversible) |

### Controls

| Function | Description |
|----------|-------------|
| `pause()` / `unpause()` | Emergency pause |
| `setTransfersEnabled(bool)` | Lock/unlock transfers |
| `setBurnEnabled(bool)` | Enable/disable burning |
| `burn(tokenId)` | Burn owned token |
| `setRoyaltyInfo(receiver, bps)` | Set ERC2981 royalties |

### Supply Management

| Function | Description |
|----------|-------------|
| `increaseMaxSupply(newMax)` | Expand collection |
| `decreaseMaxSupply(newMax)` | Reduce (cannot go below minted) |

### View Functions

| Function | Description |
|----------|-------------|
| `isPhaseActive(phaseId)` | Check if phase is active |
| `isEligibleForPhase(wallet, phaseId)` | Check wallet eligibility |
| `getPriceForWallet(wallet, phaseId)` | Get effective price |
| `getMaxMintForWallet(wallet, phaseId)` | Get wallet limit |
| `getRemainingMintsForWallet(wallet, phaseId)` | Get remaining mints |
| `royaltyInfo(tokenId, salePrice)` | ERC2981 royalty query |

## Usage Examples

### Initialize Contract
```solidity
nft.initialize(
    "My NFT",           // name
    "MNFT",             // symbol
    10000,              // maxSupply
    royaltyReceiver,    // royalty recipient
    500                 // 5% royalty
);
```

### Create Sale Phasegit init
```solidity
nft.createMintPhase(
    "Public Sale",
    block.timestamp,           // start now
    block.timestamp + 7 days,  // end in 7 days
    0.1 ether,                 // price
    5000,                      // phase supply
    5,                         // max per wallet
    0,                         // public (no wallet group)
    false,                     // no Buy X Get Y
    0,
    0
);
```

### Create Allowlist
```solidity
// Create VIP group with discounted price
uint256 groupId = nft.createWalletGroup("VIP", 0.05 ether, 10);

// Add wallets
nft.addWalletsToGroup(groupId, [addr1, addr2, addr3]);

// Add wallet with special override (free mint)
nft.addWalletWithOverride(groupId, specialAddr, 0, 20);

// Create VIP-only phase
nft.createMintPhase("VIP Sale", start, end, 0.05 ether, 1000, 10, groupId + 1, false, 0, 0);
```

### Setup Revenue Split
```solidity
nft.addPayoutWallet(teamWallet, 7000);   // 70%
nft.addPayoutWallet(artistWallet, 2000); // 20%
nft.addPayoutWallet(devWallet, 1000);    // 10%

// After sales
nft.withdraw(); // Distributes to all wallets
```

### Reveal Flow
```solidity
// Before mint
nft.setPlaceholderURI("ipfs://QmPlaceholder/hidden.json");

// After mint, upload metadata
nft.setBaseURI("ipfs://QmRevealed/");
nft.reveal();

// Optionally lock forever
nft.lockMetadata();
```

## Deployment

### Local Development
```bash
bun run compile
bun run test
```

### Deploy via ThirdWeb
```bash
bun run deploy
```

Requires a secret key. Get yours at [thirdweb.com/dashboard/settings/api-keys](https://thirdweb.com/dashboard/settings/api-keys).

```bash
bun run deploy -- -k <your-secret-key>
```

### Networks Configured
- Hardhat (local)
- zkSync Era Sepolia (testnet)
- zkSync Era Mainnet

## Security

### Implemented Protections
- Reentrancy guards on all payable functions
- Access control via `onlyOwner` modifier
- Custom errors for gas efficiency
- Supply cap enforcement
- Input validation
- Emergency pause mechanism

### Known Limitations
- On-chain randomness is weak (consider Chainlink VRF for high-value drops)
- Phase start times are public (use wallet groups for truly private sales)

## Gas Estimates

| Operation | Estimated Gas |
|-----------|---------------|
| Deploy (proxy) | ~3,500,000 |
| Mint 1 NFT | ~80,000 |
| Mint 5 NFTs | ~200,000 |
| Create Phase | ~150,000 |
| Add 10 Wallets | ~200,000 |
| Withdraw | ~100,000 |

## Testing

```bash
# Requires Node.js v22 LTS
nvm use 22
bun run test
```

Test coverage includes:
- Initialization
- Minting (public, admin, airdrop)
- Phase management
- Wallet groups & overrides
- Revenue distribution
- Metadata & reveal
- Access controls

## Project Structure

```
nft-contracts/
├── contracts/
│   └── NFTLaunchpad.sol       # Main contract
├── test/
│   └── NFTLaunchpad.test.js   # Comprehensive tests
├── scripts/
│   └── verify/                # Verification scripts
├── hardhat.config.js          # Hardhat configuration
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run compile` | Compile contracts |
| `bun run test` | Run tests |
| `bun run deploy` | Deploy via ThirdWeb |

## License

MIT
