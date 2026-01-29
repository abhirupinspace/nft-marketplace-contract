// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title AllowlistManager
 * @notice Manages wallet groups, allowlists, and Merkle-based eligibility verification
 * @dev Upgradeable contract for managing NFT launchpad allowlists
 * @custom:security-contact security@example.com
 */
contract AllowlistManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============================================
    // STRUCTS
    // ============================================

    /**
     * @dev Wallet group (allowlist) configuration
     */
    struct WalletGroup {
        string name;
        uint256 defaultPrice;
        uint256 defaultMaxMint;
        bool active;
    }

    /**
     * @dev Per-wallet override for custom pricing/limits
     */
    struct WalletOverride {
        uint256 customPrice;
        uint256 customMaxMint;
        bool hasOverride;
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    /// @notice Wallet groups storage
    mapping(uint256 => WalletGroup) public walletGroups;

    /// @notice Wallet membership: groupId => wallet => isMember
    mapping(uint256 => mapping(address => bool)) public walletGroupMembers;

    /// @notice Per-wallet overrides: groupId => wallet => override
    mapping(uint256 => mapping(address => WalletOverride)) public walletOverrides;

    /// @notice Total number of wallet groups
    uint256 public walletGroupCount;

    /// @notice Merkle roots for wallet groups
    mapping(uint256 => bytes32) public walletGroupMerkleRoots;

    /// @notice Flag indicating if group uses Merkle verification
    mapping(uint256 => bool) public walletGroupUseMerkle;

    /// @notice Flag indicating if group's Merkle root is locked (immutable)
    mapping(uint256 => bool) public merkleRootLocked;

    /// @notice Authorized launchpad contract address
    address public launchpadContract;

    /// @notice Authorized phase manager contract address
    address public phaseManagerContract;

    // ============================================
    // EVENTS
    // ============================================

    event WalletGroupCreated(uint256 indexed groupId, string name, bool isMerkleBased);
    event WalletGroupUpdated(uint256 indexed groupId, string name, uint256 defaultPrice, uint256 defaultMaxMint);
    event WalletsAddedToGroup(uint256 indexed groupId, uint256 count);
    event WalletRemovedFromGroup(uint256 indexed groupId, address indexed wallet);
    event WalletOverrideSet(uint256 indexed groupId, address indexed wallet, uint256 price, uint256 maxMint);
    event WalletGroupToggled(uint256 indexed groupId, bool active);
    event MerkleRootUpdated(uint256 indexed groupId, bytes32 merkleRoot);
    event MerkleRootLocked(uint256 indexed groupId);
    event LaunchpadContractUpdated(address indexed previousLaunchpad, address indexed newLaunchpad);
    event PhaseManagerContractUpdated(address indexed previousPhaseManager, address indexed newPhaseManager);

    // ============================================
    // ERRORS
    // ============================================

    error Unauthorized();
    error InvalidInput();
    error InvalidAddress();
    error InvalidGroupId();
    error GroupNotActive();
    error MerkleRootIsLocked();

    // ============================================
    // MODIFIERS
    // ============================================

    /**
     * @dev Restricts access to owner or authorized contracts
     */
    modifier onlyAuthorized() {
        if (msg.sender != owner() && msg.sender != launchpadContract && msg.sender != phaseManagerContract) {
            revert Unauthorized();
        }
        _;
    }

    /**
     * @dev Validates wallet group ID exists
     */
    modifier validWalletGroup(uint256 groupId) {
        if (groupId >= walletGroupCount) revert InvalidGroupId();
        _;
    }

    // ============================================
    // INITIALIZER
    // ============================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the AllowlistManager contract
     * @param _owner Initial owner address
     */
    function initialize(address _owner) public initializer {
        if (_owner == address(0)) revert InvalidAddress();

        __Ownable_init();
        __ReentrancyGuard_init();

        _transferOwnership(_owner);
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Set the launchpad contract address
     * @param _launchpad Address of the NFTLaunchpad contract
     */
    function setLaunchpadContract(address _launchpad) external onlyOwner {
        if (_launchpad == address(0)) revert InvalidAddress();
        address previous = launchpadContract;
        launchpadContract = _launchpad;
        emit LaunchpadContractUpdated(previous, _launchpad);
    }

    /**
     * @notice Set the phase manager contract address
     * @param _phaseManager Address of the PhaseManager contract
     */
    function setPhaseManagerContract(address _phaseManager) external onlyOwner {
        if (_phaseManager == address(0)) revert InvalidAddress();
        address previous = phaseManagerContract;
        phaseManagerContract = _phaseManager;
        emit PhaseManagerContractUpdated(previous, _phaseManager);
    }

    // ============================================
    // WALLET GROUP FUNCTIONS
    // ============================================

    /**
     * @notice Create a new wallet group with on-chain membership
     * @param name Group name
     * @param defaultPrice Default price in wei for group members
     * @param defaultMaxMint Default max mint for group members
     * @return groupId The ID of the newly created group
     */
    function createWalletGroup(
        string calldata name,
        uint256 defaultPrice,
        uint256 defaultMaxMint
    ) external onlyOwner returns (uint256 groupId) {
        if (defaultMaxMint == 0) revert InvalidInput();

        groupId = walletGroupCount++;

        walletGroups[groupId] = WalletGroup({
            name: name,
            defaultPrice: defaultPrice,
            defaultMaxMint: defaultMaxMint,
            active: true
        });

        emit WalletGroupCreated(groupId, name, false);
    }

    /**
     * @notice Create a Merkle-based wallet group for large allowlists
     * @param name Group name
     * @param defaultPrice Default price in wei for group members
     * @param defaultMaxMint Default max mint for group members
     * @param merkleRoot Merkle root of the allowlist
     * @return groupId The ID of the newly created group
     */
    function createMerkleWalletGroup(
        string calldata name,
        uint256 defaultPrice,
        uint256 defaultMaxMint,
        bytes32 merkleRoot
    ) external onlyOwner returns (uint256 groupId) {
        if (defaultMaxMint == 0) revert InvalidInput();
        if (merkleRoot == bytes32(0)) revert InvalidInput();

        groupId = walletGroupCount++;

        walletGroups[groupId] = WalletGroup({
            name: name,
            defaultPrice: defaultPrice,
            defaultMaxMint: defaultMaxMint,
            active: true
        });

        walletGroupMerkleRoots[groupId] = merkleRoot;
        walletGroupUseMerkle[groupId] = true;

        emit WalletGroupCreated(groupId, name, true);
    }

    /**
     * @notice Update wallet group settings
     * @param groupId Group ID to update
     * @param name New group name
     * @param defaultPrice New default price
     * @param defaultMaxMint New default max mint
     */
    function updateWalletGroup(
        uint256 groupId,
        string calldata name,
        uint256 defaultPrice,
        uint256 defaultMaxMint
    ) external onlyOwner validWalletGroup(groupId) {
        if (defaultMaxMint == 0) revert InvalidInput();

        WalletGroup storage group = walletGroups[groupId];
        group.name = name;
        group.defaultPrice = defaultPrice;
        group.defaultMaxMint = defaultMaxMint;

        emit WalletGroupUpdated(groupId, name, defaultPrice, defaultMaxMint);
    }

    /**
     * @notice Toggle wallet group active status
     * @param groupId Group ID to toggle
     */
    function toggleWalletGroup(uint256 groupId) external onlyOwner validWalletGroup(groupId) {
        WalletGroup storage group = walletGroups[groupId];
        group.active = !group.active;
        emit WalletGroupToggled(groupId, group.active);
    }

    /**
     * @notice Update Merkle root for a wallet group
     * @dev Cannot update if merkle root is locked
     * @param groupId Group ID to update
     * @param merkleRoot New Merkle root
     */
    function setWalletGroupMerkleRoot(
        uint256 groupId,
        bytes32 merkleRoot
    ) external onlyOwner validWalletGroup(groupId) {
        if (merkleRootLocked[groupId]) revert MerkleRootIsLocked();
        if (merkleRoot == bytes32(0)) revert InvalidInput();
        walletGroupMerkleRoots[groupId] = merkleRoot;
        walletGroupUseMerkle[groupId] = true;
        emit MerkleRootUpdated(groupId, merkleRoot);
    }

    /**
     * @notice Permanently lock a wallet group's Merkle root
     * @dev This is irreversible - prevents rug pulls by ensuring allowlist cannot change mid-sale
     * @param groupId Group ID to lock
     */
    function lockMerkleRoot(uint256 groupId) external onlyOwner validWalletGroup(groupId) {
        if (!walletGroupUseMerkle[groupId]) revert InvalidInput();
        if (merkleRootLocked[groupId]) revert MerkleRootIsLocked();
        merkleRootLocked[groupId] = true;
        emit MerkleRootLocked(groupId);
    }

    /**
     * @notice Check if a wallet group's Merkle root is locked
     * @param groupId Group ID to check
     * @return bool True if locked
     */
    function isMerkleRootLocked(uint256 groupId) external view validWalletGroup(groupId) returns (bool) {
        return merkleRootLocked[groupId];
    }

    // ============================================
    // WALLET MEMBERSHIP FUNCTIONS
    // ============================================

    /**
     * @notice Add wallets to a group (batch operation)
     * @param groupId Group ID to add wallets to
     * @param wallets Array of wallet addresses to add
     */
    function addWalletsToGroup(
        uint256 groupId,
        address[] calldata wallets
    ) external onlyOwner validWalletGroup(groupId) {
        if (wallets.length == 0) revert InvalidInput();

        for (uint256 i = 0; i < wallets.length;) {
            if (wallets[i] == address(0)) revert InvalidAddress();
            walletGroupMembers[groupId][wallets[i]] = true;
            unchecked { ++i; }
        }

        emit WalletsAddedToGroup(groupId, wallets.length);
    }

    /**
     * @notice Add wallet with custom pricing/limit override
     * @param groupId Group ID to add wallet to
     * @param wallet Wallet address to add
     * @param customPrice Custom price (0 = use group default)
     * @param customMaxMint Custom max mint (0 = use group default)
     */
    function addWalletWithOverride(
        uint256 groupId,
        address wallet,
        uint256 customPrice,
        uint256 customMaxMint
    ) external onlyOwner validWalletGroup(groupId) {
        if (wallet == address(0)) revert InvalidAddress();

        walletGroupMembers[groupId][wallet] = true;

        bool hasOverride = (customPrice > 0 || customMaxMint > 0);
        walletOverrides[groupId][wallet] = WalletOverride({
            customPrice: customPrice,
            customMaxMint: customMaxMint,
            hasOverride: hasOverride
        });

        emit WalletOverrideSet(groupId, wallet, customPrice, customMaxMint);
    }

    /**
     * @notice Remove wallet from group
     * @param groupId Group ID to remove wallet from
     * @param wallet Wallet address to remove
     */
    function removeWalletFromGroup(
        uint256 groupId,
        address wallet
    ) external onlyOwner validWalletGroup(groupId) {
        if (wallet == address(0)) revert InvalidAddress();

        walletGroupMembers[groupId][wallet] = false;
        delete walletOverrides[groupId][wallet];

        emit WalletRemovedFromGroup(groupId, wallet);
    }

    /**
     * @notice Bulk update wallet overrides
     * @param groupId Group ID to update wallets in
     * @param wallets Array of wallet addresses
     * @param prices Array of custom prices
     * @param maxMints Array of custom max mints
     */
    function bulkUpdateWallets(
        uint256 groupId,
        address[] calldata wallets,
        uint256[] calldata prices,
        uint256[] calldata maxMints
    ) external onlyOwner validWalletGroup(groupId) {
        if (wallets.length != prices.length || wallets.length != maxMints.length) {
            revert InvalidInput();
        }
        if (wallets.length == 0) revert InvalidInput();

        for (uint256 i = 0; i < wallets.length;) {
            if (wallets[i] == address(0)) revert InvalidAddress();

            if (!walletGroupMembers[groupId][wallets[i]]) {
                walletGroupMembers[groupId][wallets[i]] = true;
            }

            bool hasOverride = (prices[i] > 0 || maxMints[i] > 0);
            walletOverrides[groupId][wallets[i]] = WalletOverride({
                customPrice: prices[i],
                customMaxMint: maxMints[i],
                hasOverride: hasOverride
            });

            emit WalletOverrideSet(groupId, wallets[i], prices[i], maxMints[i]);
            unchecked { ++i; }
        }
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Check if wallet is in group (on-chain membership only)
     * @param groupId Group ID to check
     * @param wallet Wallet address to check
     * @return bool True if wallet is a member
     */
    function isWalletInGroup(
        uint256 groupId,
        address wallet
    ) external view validWalletGroup(groupId) returns (bool) {
        if (!walletGroups[groupId].active) return false;
        if (walletGroupUseMerkle[groupId]) return false;
        return walletGroupMembers[groupId][wallet];
    }

    /**
     * @notice Check eligibility with Merkle proof
     * @param groupId Group ID to check
     * @param wallet Wallet address to check
     * @param merkleProof Merkle proof for verification
     * @return bool True if wallet is eligible
     */
    function isEligibleWithProof(
        uint256 groupId,
        address wallet,
        bytes32[] calldata merkleProof
    ) external view validWalletGroup(groupId) returns (bool) {
        if (!walletGroups[groupId].active) return false;

        if (walletGroupUseMerkle[groupId]) {
            bytes32 leaf = keccak256(abi.encodePacked(wallet));
            return MerkleProof.verify(merkleProof, walletGroupMerkleRoots[groupId], leaf);
        }

        return walletGroupMembers[groupId][wallet];
    }

    /**
     * @notice Get price for a wallet in a group
     * @param groupId Group ID
     * @param wallet Wallet address
     * @return uint256 Price in wei
     */
    function getPriceForWallet(
        uint256 groupId,
        address wallet
    ) external view validWalletGroup(groupId) returns (uint256) {
        WalletOverride storage walletOverride = walletOverrides[groupId][wallet];
        if (walletOverride.hasOverride) {
            return walletOverride.customPrice;
        }
        return walletGroups[groupId].defaultPrice;
    }

    /**
     * @notice Get max mint for a wallet in a group
     * @param groupId Group ID
     * @param wallet Wallet address
     * @return uint256 Max mint amount
     */
    function getMaxMintForWallet(
        uint256 groupId,
        address wallet
    ) external view validWalletGroup(groupId) returns (uint256) {
        WalletOverride storage walletOverride = walletOverrides[groupId][wallet];
        if (walletOverride.hasOverride && walletOverride.customMaxMint > 0) {
            return walletOverride.customMaxMint;
        }
        return walletGroups[groupId].defaultMaxMint;
    }

    /**
     * @notice Check if group uses Merkle verification
     * @param groupId Group ID
     * @return bool True if Merkle-based
     */
    function isGroupMerkleBased(
        uint256 groupId
    ) external view validWalletGroup(groupId) returns (bool) {
        return walletGroupUseMerkle[groupId];
    }

    /**
     * @notice Get wallet group details
     * @param groupId Group ID
     * @return name Group name
     * @return defaultPrice Default price
     * @return defaultMaxMint Default max mint
     * @return active Whether group is active
     */
    function getWalletGroup(
        uint256 groupId
    ) external view validWalletGroup(groupId) returns (
        string memory name,
        uint256 defaultPrice,
        uint256 defaultMaxMint,
        bool active
    ) {
        WalletGroup storage group = walletGroups[groupId];
        return (group.name, group.defaultPrice, group.defaultMaxMint, group.active);
    }

    /**
     * @notice Check if group is active
     * @param groupId Group ID
     * @return bool True if active
     */
    function isGroupActive(
        uint256 groupId
    ) external view validWalletGroup(groupId) returns (bool) {
        return walletGroups[groupId].active;
    }

    // ============================================
    // STORAGE GAP
    // ============================================

    /**
     * @dev Reserved storage space for future upgrades
     * This allows adding new state variables without shifting storage
     */
    uint256[50] private __gap;
}
