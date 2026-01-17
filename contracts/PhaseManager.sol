// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./AllowlistManager.sol";

/**
 * @title PhaseManager
 * @notice Manages mint phases, pricing, and phase validation
 * @dev Upgradeable contract for managing NFT launchpad mint phases
 * @custom:security-contact security@example.com
 */
contract PhaseManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============================================
    // STRUCTS
    // ============================================

    /**
     * @dev Mint phase configuration
     */
    struct MintPhase {
        string name;
        uint256 startTime;
        uint256 endTime;
        uint256 price;
        uint256 maxSupply;
        uint256 minted;
        uint256 maxPerWallet;
        uint256 walletGroupId;
        bool active;
        bool buyXGetY;
        uint256 buyAmount;
        uint256 getAmount;
    }

    // ============================================
    // CONSTANTS
    // ============================================

    /// @notice Maximum bonus tokens per mint (safety limit)
    uint256 public constant MAX_BONUS_PER_MINT = 100;

    // ============================================
    // STATE VARIABLES
    // ============================================

    /// @notice Mint phases storage
    mapping(uint256 => MintPhase) public mintPhases;

    /// @notice Total number of phases
    uint256 public phaseCount;

    /// @notice Mints per wallet per phase: phaseId => wallet => count
    mapping(uint256 => mapping(address => uint256)) public phaseMints;

    /// @notice Reference to AllowlistManager contract
    AllowlistManager public allowlistManager;

    /// @notice Authorized launchpad contract address
    address public launchpadContract;

    // ============================================
    // EVENTS
    // ============================================

    event PhaseCreated(uint256 indexed phaseId, string name);
    event PhaseUpdated(uint256 indexed phaseId);
    event PhaseToggled(uint256 indexed phaseId, bool active);
    event PhaseMintRecorded(uint256 indexed phaseId, address indexed wallet, uint256 quantity, uint256 finalQuantity);
    event LaunchpadContractUpdated(address indexed previousLaunchpad, address indexed newLaunchpad);
    event AllowlistManagerUpdated(address indexed previousManager, address indexed newManager);

    // ============================================
    // ERRORS
    // ============================================

    error Unauthorized();
    error InvalidInput();
    error InvalidPhase();
    error PhaseNotActive();
    error NotEligible();
    error ExceedsWalletLimit();
    error ExceedsPhaseSupply();
    error BonusTooLarge();
    error InvalidAddress();

    // ============================================
    // MODIFIERS
    // ============================================

    /**
     * @dev Restricts access to launchpad contract only
     */
    modifier onlyLaunchpad() {
        if (msg.sender != launchpadContract) revert Unauthorized();
        _;
    }

    /**
     * @dev Validates phase ID exists
     */
    modifier validPhase(uint256 phaseId) {
        if (phaseId >= phaseCount) revert InvalidPhase();
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
     * @notice Initialize the PhaseManager contract
     * @param _owner Initial owner address
     * @param _allowlistManager Address of the AllowlistManager contract
     */
    function initialize(
        address _owner,
        address _allowlistManager
    ) public initializer {
        if (_owner == address(0)) revert InvalidAddress();
        if (_allowlistManager == address(0)) revert InvalidAddress();

        __Ownable_init();
        __ReentrancyGuard_init();

        _transferOwnership(_owner);
        allowlistManager = AllowlistManager(_allowlistManager);
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
     * @notice Update the AllowlistManager contract address
     * @param _allowlistManager New AllowlistManager address
     */
    function setAllowlistManager(address _allowlistManager) external onlyOwner {
        if (_allowlistManager == address(0)) revert InvalidAddress();
        address previous = address(allowlistManager);
        allowlistManager = AllowlistManager(_allowlistManager);
        emit AllowlistManagerUpdated(previous, _allowlistManager);
    }

    // ============================================
    // PHASE MANAGEMENT FUNCTIONS
    // ============================================

    /**
     * @notice Create a new mint phase
     * @param name Phase name
     * @param startTime Phase start timestamp
     * @param endTime Phase end timestamp
     * @param price Price per NFT in wei
     * @param phaseMaxSupply Maximum NFTs for this phase
     * @param maxPerWallet Maximum NFTs per wallet
     * @param walletGroupId Wallet group ID (0 = public)
     * @param buyXGetY Enable Buy X Get Y promotion
     * @param buyAmount Buy X amount
     * @param getAmount Get Y amount free
     * @return phaseId The ID of the newly created phase
     */
    function createMintPhase(
        string calldata name,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 phaseMaxSupply,
        uint256 maxPerWallet,
        uint256 walletGroupId,
        bool buyXGetY,
        uint256 buyAmount,
        uint256 getAmount
    ) external onlyOwner returns (uint256 phaseId) {
        if (startTime >= endTime) revert InvalidInput();
        if (endTime <= block.timestamp) revert InvalidInput();
        if (phaseMaxSupply == 0) revert InvalidInput();
        if (maxPerWallet == 0) revert InvalidInput();

        if (buyXGetY) {
            if (buyAmount == 0 || getAmount == 0) revert InvalidInput();
        }

        // Validate wallet group exists if not public
        if (walletGroupId > 0 && walletGroupId > allowlistManager.walletGroupCount()) {
            revert InvalidInput();
        }

        phaseId = phaseCount++;

        mintPhases[phaseId] = MintPhase({
            name: name,
            startTime: startTime,
            endTime: endTime,
            price: price,
            maxSupply: phaseMaxSupply,
            minted: 0,
            maxPerWallet: maxPerWallet,
            walletGroupId: walletGroupId,
            active: true,
            buyXGetY: buyXGetY,
            buyAmount: buyAmount,
            getAmount: getAmount
        });

        emit PhaseCreated(phaseId, name);
    }

    /**
     * @notice Update an existing mint phase
     * @param phaseId Phase ID to update
     * @param name New phase name
     * @param startTime New start time
     * @param endTime New end time
     * @param price New price
     * @param phaseMaxSupply New max supply
     * @param maxPerWallet New max per wallet
     */
    function updateMintPhase(
        uint256 phaseId,
        string calldata name,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 phaseMaxSupply,
        uint256 maxPerWallet
    ) external onlyOwner validPhase(phaseId) {
        MintPhase storage phase = mintPhases[phaseId];

        if (startTime >= endTime) revert InvalidInput();
        if (phaseMaxSupply == 0) revert InvalidInput();
        if (phaseMaxSupply < phase.minted) revert InvalidInput();
        if (maxPerWallet == 0) revert InvalidInput();

        phase.name = name;
        phase.startTime = startTime;
        phase.endTime = endTime;
        phase.price = price;
        phase.maxSupply = phaseMaxSupply;
        phase.maxPerWallet = maxPerWallet;

        emit PhaseUpdated(phaseId);
    }

    /**
     * @notice Toggle phase active status
     * @param phaseId Phase ID to toggle
     */
    function togglePhase(uint256 phaseId) external onlyOwner validPhase(phaseId) {
        MintPhase storage phase = mintPhases[phaseId];
        phase.active = !phase.active;
        emit PhaseToggled(phaseId, phase.active);
    }

    // ============================================
    // MINT VALIDATION (Called by Launchpad)
    // ============================================

    /**
     * @notice Validate and record a mint operation
     * @dev Only callable by the launchpad contract
     * @param phaseId Phase ID to mint from
     * @param wallet Wallet address minting
     * @param quantity Quantity to mint
     * @param merkleProof Merkle proof for allowlist verification
     * @return finalQuantity Total quantity including bonuses
     * @return totalPrice Total price to charge
     */
    function validateAndRecordMint(
        uint256 phaseId,
        address wallet,
        uint256 quantity,
        bytes32[] calldata merkleProof
    )
        external
        onlyLaunchpad
        validPhase(phaseId)
        nonReentrant
        returns (uint256 finalQuantity, uint256 totalPrice)
    {
        if (quantity == 0) revert InvalidInput();

        MintPhase storage phase = mintPhases[phaseId];
        if (!_isPhaseActive(phaseId)) revert PhaseNotActive();

        // Check eligibility
        if (!_isEligible(wallet, phaseId, merkleProof)) revert NotEligible();

        // Get price and max mint for wallet
        uint256 price = _getPriceForWallet(wallet, phaseId);
        uint256 maxMint = _getMaxMintForWallet(wallet, phaseId);
        uint256 alreadyMinted = phaseMints[phaseId][wallet];

        if (alreadyMinted + quantity > maxMint) revert ExceedsWalletLimit();

        // Calculate final quantity with Buy X Get Y bonus
        finalQuantity = quantity;
        if (phase.buyXGetY && quantity >= phase.buyAmount) {
            uint256 bonus;
            unchecked {
                bonus = (quantity / phase.buyAmount) * phase.getAmount;
            }
            if (bonus > MAX_BONUS_PER_MINT) revert BonusTooLarge();
            unchecked {
                finalQuantity = quantity + bonus;
            }
        }

        if (phase.minted + finalQuantity > phase.maxSupply) revert ExceedsPhaseSupply();

        // Calculate total price
        totalPrice = price * quantity;

        // Record the mint
        unchecked {
            phase.minted += finalQuantity;
            phaseMints[phaseId][wallet] += quantity;
        }

        emit PhaseMintRecorded(phaseId, wallet, quantity, finalQuantity);

        return (finalQuantity, totalPrice);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Check if phase is currently active
     * @param phaseId Phase ID to check
     * @return bool True if phase is active
     */
    function isPhaseActive(uint256 phaseId) external view validPhase(phaseId) returns (bool) {
        return _isPhaseActive(phaseId);
    }

    /**
     * @notice Check if wallet is eligible for phase (without proof)
     * @param wallet Wallet address
     * @param phaseId Phase ID
     * @return bool True if eligible
     */
    function isEligibleForPhase(
        address wallet,
        uint256 phaseId
    ) external view validPhase(phaseId) returns (bool) {
        return _isEligible(wallet, phaseId, new bytes32[](0));
    }

    /**
     * @notice Check eligibility with Merkle proof
     * @param wallet Wallet address
     * @param phaseId Phase ID
     * @param merkleProof Merkle proof
     * @return bool True if eligible
     */
    function isEligibleWithProof(
        address wallet,
        uint256 phaseId,
        bytes32[] calldata merkleProof
    ) external view validPhase(phaseId) returns (bool) {
        return _isEligible(wallet, phaseId, merkleProof);
    }

    /**
     * @notice Get effective price for wallet in phase
     * @param wallet Wallet address
     * @param phaseId Phase ID
     * @return uint256 Price in wei
     */
    function getPriceForWallet(
        address wallet,
        uint256 phaseId
    ) external view validPhase(phaseId) returns (uint256) {
        return _getPriceForWallet(wallet, phaseId);
    }

    /**
     * @notice Get effective max mint for wallet in phase
     * @param wallet Wallet address
     * @param phaseId Phase ID
     * @return uint256 Max mint amount
     */
    function getMaxMintForWallet(
        address wallet,
        uint256 phaseId
    ) external view validPhase(phaseId) returns (uint256) {
        return _getMaxMintForWallet(wallet, phaseId);
    }

    /**
     * @notice Get remaining mints for wallet in phase
     * @param wallet Wallet address
     * @param phaseId Phase ID
     * @return uint256 Remaining mints
     */
    function getRemainingMintsForWallet(
        address wallet,
        uint256 phaseId
    ) external view validPhase(phaseId) returns (uint256) {
        uint256 maxMint = _getMaxMintForWallet(wallet, phaseId);
        uint256 minted = phaseMints[phaseId][wallet];

        if (minted >= maxMint) return 0;
        return maxMint - minted;
    }

    /**
     * @notice Get full phase details
     * @param phaseId Phase ID
     * @return MintPhase Phase struct
     */
    function getPhase(uint256 phaseId) external view validPhase(phaseId) returns (MintPhase memory) {
        return mintPhases[phaseId];
    }

    /**
     * @notice Get phase minted count
     * @param phaseId Phase ID
     * @return uint256 Number minted
     */
    function getPhaseMintedCount(uint256 phaseId) external view validPhase(phaseId) returns (uint256) {
        return mintPhases[phaseId].minted;
    }

    /**
     * @notice Get remaining supply for phase
     * @param phaseId Phase ID
     * @return uint256 Remaining supply
     */
    function getPhaseRemainingSupply(uint256 phaseId) external view validPhase(phaseId) returns (uint256) {
        MintPhase storage phase = mintPhases[phaseId];
        if (phase.minted >= phase.maxSupply) return 0;
        return phase.maxSupply - phase.minted;
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _isPhaseActive(uint256 phaseId) internal view returns (bool) {
        MintPhase storage phase = mintPhases[phaseId];

        if (!phase.active) return false;
        if (block.timestamp < phase.startTime || block.timestamp > phase.endTime) return false;
        if (phase.minted >= phase.maxSupply) return false;

        return true;
    }

    function _isEligible(
        address wallet,
        uint256 phaseId,
        bytes32[] memory merkleProof
    ) internal view returns (bool) {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase is open to everyone
        if (phase.walletGroupId == 0) return true;

        // Check with allowlist manager (1-based indexing for phases)
        uint256 groupId = phase.walletGroupId - 1;

        if (allowlistManager.isGroupMerkleBased(groupId)) {
            return allowlistManager.isEligibleWithProof(groupId, wallet, merkleProof);
        }

        return allowlistManager.isWalletInGroup(groupId, wallet);
    }

    function _getPriceForWallet(address wallet, uint256 phaseId) internal view returns (uint256) {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase uses phase price
        if (phase.walletGroupId == 0) return phase.price;

        uint256 groupId = phase.walletGroupId - 1;
        return allowlistManager.getPriceForWallet(groupId, wallet);
    }

    function _getMaxMintForWallet(address wallet, uint256 phaseId) internal view returns (uint256) {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase uses phase max per wallet
        if (phase.walletGroupId == 0) return phase.maxPerWallet;

        uint256 groupId = phase.walletGroupId - 1;
        return allowlistManager.getMaxMintForWallet(groupId, wallet);
    }

    // ============================================
    // STORAGE GAP
    // ============================================

    /**
     * @dev Reserved storage space for future upgrades
     */
    uint256[50] private __gap;
}
