// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

/**
 * @title NFTLaunchpad
 * @notice Production-grade NFT Launchpad with phase-based minting, allowlists, airdrops, and revenue splitting
 * @dev Implements ERC721A for gas-efficient batch minting
 */
contract NFTLaunchpad is Initializable, ERC721AUpgradeable {

    // ============================================
    // STRUCTS
    // ============================================

    /**
     * @dev Mint phase configuration
     */
    struct MintPhase {
        string name;                       // Phase name (e.g., "VIP Sale", "Whitelist", "Public")
        uint256 startTime;                 // Phase start timestamp
        uint256 endTime;                   // Phase end timestamp
        uint256 price;                     // Price per NFT in wei
        uint256 maxSupply;                 // Maximum supply for this phase
        uint256 minted;                    // Number of NFTs minted in this phase
        uint256 maxPerWallet;              // Maximum mints per wallet
        uint256 walletGroupId;             // Associated wallet group (0 = public)
        bool active;                       // Manual pause/unpause
        bool buyXGetY;                     // Enable "Buy X Get Y" promotion
        uint256 buyAmount;                 // Buy X tokens
        uint256 getAmount;                 // Get Y tokens free
    }

    /**
     * @dev Wallet group (allowlist) configuration
     */
    struct WalletGroup {
        string name;                       // Group name (e.g., "VIP", "Whitelist")
        uint256 defaultPrice;              // Default price for group members
        uint256 defaultMaxMint;            // Default max mint for group members
        bool active;                       // Enable/disable entire group
    }

    /**
     * @dev Per-wallet override for custom pricing/limits
     */
    struct WalletOverride {
        uint256 customPrice;               // Custom price (0 = use default)
        uint256 customMaxMint;             // Custom max mint (0 = use default)
        bool hasOverride;                  // Whether override is active
    }

    /**
     * @dev Payout wallet configuration for revenue splitting
     */
    struct PayoutWallet {
        address wallet;                    // Recipient address
        uint256 sharePercentage;           // Share percentage (out of 10000 = 100%)
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    // Supply Management
    uint256 public maxSupply;              // Maximum total NFT supply

    // Metadata
    string private baseTokenURI;           // Base URI for revealed metadata (IPFS)
    string private placeholderURI;         // Placeholder URI before reveal
    bool public revealed;                  // Whether NFTs are revealed
    bool public metadataLocked;            // Permanent metadata lock

    // Mint Phases
    mapping(uint256 => MintPhase) public mintPhases;
    uint256 public phaseCount;
    mapping(uint256 => mapping(address => uint256)) public phaseMints; // phaseId => wallet => minted count

    // Wallet Groups (Allowlists)
    mapping(uint256 => WalletGroup) public walletGroups;
    mapping(uint256 => mapping(address => bool)) public walletGroupMembers; // groupId => wallet => isMember
    mapping(uint256 => mapping(address => WalletOverride)) public walletOverrides; // groupId => wallet => override
    uint256 public walletGroupCount;

    // Revenue Management
    PayoutWallet[] public payoutWallets;
    uint256 public totalRevenue;           // Total ETH received from mints
    uint256 public withdrawnRevenue;       // Total ETH withdrawn

    // Control Flags
    address private _owner;                // Contract owner
    bool public paused;                    // Emergency pause
    bool public transfersEnabled;          // Enable/disable NFT transfers
    bool public burnEnabled;               // Enable/disable burning

    // Royalties (ERC2981)
    address public royaltyReceiver;        // Royalty recipient
    uint96 public royaltyBps;              // Royalty in basis points (500 = 5%)

    // Reentrancy Guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    // ============================================
    // EVENTS
    // ============================================

    // Minting Events
    event Minted(address indexed minter, uint256 quantity, uint256 phaseId, uint256 totalPaid);
    event AdminMinted(address indexed to, uint256 quantity);
    event AirdropExecuted(uint256 totalWallets, uint256 totalMinted);

    // Phase Events
    event PhaseCreated(uint256 indexed phaseId, string name);
    event PhaseUpdated(uint256 indexed phaseId);
    event PhaseToggled(uint256 indexed phaseId, bool active);

    // Wallet Group Events
    event WalletGroupCreated(uint256 indexed groupId, string name);
    event WalletsAddedToGroup(uint256 indexed groupId, uint256 count);
    event WalletRemovedFromGroup(uint256 indexed groupId, address wallet);
    event WalletOverrideSet(uint256 indexed groupId, address wallet, uint256 price, uint256 maxMint);
    event WalletGroupToggled(uint256 indexed groupId, bool active);

    // Supply Events
    event MaxSupplyUpdated(uint256 newMaxSupply);

    // Metadata Events
    event BaseURIUpdated(string newBaseURI);
    event PlaceholderURIUpdated(string newPlaceholderURI);
    event Revealed();
    event MetadataLocked();

    // Revenue Events
    event PayoutWalletAdded(address wallet, uint256 sharePercentage);
    event PayoutWalletUpdated(uint256 index, address wallet, uint256 sharePercentage);
    event PayoutWalletRemoved(uint256 index);
    event Withdrawn(uint256 amount);

    // Control Events
    event Paused();
    event Unpaused();
    event TransfersToggled(bool enabled);
    event BurnToggled(bool enabled);
    event RoyaltyInfoUpdated(address receiver, uint96 bps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============================================
    // ERRORS
    // ============================================

    error ContractPaused();
    error InvalidPhase();
    error PhaseNotActive();
    error NotEligible();
    error ExceedsWalletLimit();
    error ExceedsPhaseSupply();
    error MaxSupplyReached();
    error InsufficientPayment();
    error InvalidInput();
    error MetadataIsLocked();
    error AlreadyRevealed();
    error NotRevealed();
    error Unauthorized();
    error TransfersDisabled();
    error BurningDisabled();
    error InvalidAddress();
    error InvalidShares();
    error NoFunds();
    error TransferFailed();
    error ReentrancyGuard();

    // ============================================
    // MODIFIERS
    // ============================================

    /**
     * @dev Restricts function access to contract owner only
     */
    modifier onlyOwner() {
        if (msg.sender != _owner) revert Unauthorized();
        _;
    }

    /**
     * @dev Prevents function execution when contract is paused
     */
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    /**
     * @dev Validates phase ID exists
     */
    modifier validPhase(uint256 phaseId) {
        if (phaseId >= phaseCount) revert InvalidPhase();
        _;
    }

    /**
     * @dev Validates wallet group ID exists
     */
    modifier validWalletGroup(uint256 groupId) {
        if (groupId >= walletGroupCount) revert InvalidPhase();
        _;
    }

    /**
     * @dev Prevents reentrancy attacks
     */
    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuard();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ============================================
    // CONSTRUCTOR
    // ============================================

    /**
     * @notice Initialize the NFT Launchpad contract
     * @param name_ Collection name
     * @param symbol_ Collection symbol
     * @param maxSupply_ Maximum total supply
     * @param royaltyReceiver_ Address to receive royalties
     * @param royaltyBps_ Royalty percentage in basis points (500 = 5%)
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) public initializer {
        __ERC721A_init(name_, symbol_);

        if (maxSupply_ == 0) revert InvalidInput();
        if (royaltyReceiver_ == address(0)) revert InvalidAddress();
        if (royaltyBps_ > 1000) revert InvalidInput(); // Max 10%

        _owner = msg.sender;
        maxSupply = maxSupply_;
        royaltyReceiver = royaltyReceiver_;
        royaltyBps = royaltyBps_;
        transfersEnabled = true;
        burnEnabled = false;
        _status = _NOT_ENTERED;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ============================================
    // MINTING FUNCTIONS
    // ============================================

    /**
     * @notice Public mint function during active phases
     * @dev Main minting function with comprehensive validation
     * @param quantity Number of NFTs to mint
     * @param phaseId ID of the mint phase
     */
    function mint(uint256 quantity, uint256 phaseId)
        external
        payable
        whenNotPaused
        validPhase(phaseId)
        nonReentrant
    {
        if (quantity == 0) revert InvalidInput();

        MintPhase storage phase = mintPhases[phaseId];
        if (!isPhaseActive(phaseId)) revert PhaseNotActive();
        if (!isEligibleForPhase(msg.sender, phaseId)) revert NotEligible();

        uint256 price = getPriceForWallet(msg.sender, phaseId);
        uint256 maxMint = getMaxMintForWallet(msg.sender, phaseId);
        uint256 alreadyMinted = phaseMints[phaseId][msg.sender];

        if (alreadyMinted + quantity > maxMint) revert ExceedsWalletLimit();

        // Calculate final quantity with Buy X Get Y bonus
        uint256 finalQuantity = quantity;
        if (phase.buyXGetY && quantity >= phase.buyAmount) {
            uint256 bonusSets = quantity / phase.buyAmount;
            finalQuantity = quantity + (bonusSets * phase.getAmount);
        }

        if (phase.minted + finalQuantity > phase.maxSupply) revert ExceedsPhaseSupply();
        if (_totalMinted() + finalQuantity > maxSupply) revert MaxSupplyReached();

        // Only charge for purchased quantity, bonus is free
        uint256 totalPrice = price * quantity;
        if (msg.value < totalPrice) revert InsufficientPayment();

        _mint(msg.sender, finalQuantity);
        phase.minted += finalQuantity;
        phaseMints[phaseId][msg.sender] += quantity;
        totalRevenue += totalPrice;

        // Refund excess payment
        if (msg.value > totalPrice) {
            (bool success, ) = msg.sender.call{value: msg.value - totalPrice}("");
            if (!success) revert TransferFailed();
        }

        emit Minted(msg.sender, finalQuantity, phaseId, totalPrice);
    }

    /**
     * @notice Admin mint for team, reserves, giveaways
     * @dev Bypasses phase restrictions and payment requirements
     * @param to Recipient address
     * @param quantity Number of NFTs to mint
     */
    function adminMint(address to, uint256 quantity)
        external
        onlyOwner
        nonReentrant
    {
        // Validate inputs
        if (to == address(0)) revert InvalidAddress();
        if (quantity == 0) revert InvalidInput();

        // Check total supply
        if (_totalMinted() + quantity > maxSupply) revert MaxSupplyReached();

        // Mint the NFTs
        _mint(to, quantity);

        // Emit event
        emit AdminMinted(to, quantity);
    }

    /**
     * @notice Airdrop NFTs to multiple wallets
     * @dev Batch minting to multiple addresses with different quantities
     * @param recipients Array of recipient addresses
     * @param quantities Array of quantities per recipient
     */
    function airdrop(address[] calldata recipients, uint256[] calldata quantities)
        external
        onlyOwner
        nonReentrant
    {
        // Validate array lengths match
        if (recipients.length != quantities.length) revert InvalidInput();
        if (recipients.length == 0) revert InvalidInput();

        // Calculate total quantity
        uint256 totalQuantity = 0;
        for (uint256 i = 0; i < quantities.length; i++) {
            if (recipients[i] == address(0)) revert InvalidAddress();
            if (quantities[i] == 0) revert InvalidInput();
            totalQuantity += quantities[i];
        }

        // Check total supply
        if (_totalMinted() + totalQuantity > maxSupply) revert MaxSupplyReached();

        // Mint to each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], quantities[i]);
        }

        // Emit event
        emit AirdropExecuted(recipients.length, totalQuantity);
    }

    /**
     * @notice Airdrop to all members of a wallet group
     * @dev Caller must provide the wallet list (to avoid unbounded iteration on-chain)
     * @param groupId Wallet group ID
     * @param wallets Array of wallet addresses from the group
     * @param quantity Quantity per wallet
     */
    function airdropToGroup(
        uint256 groupId,
        address[] calldata wallets,
        uint256 quantity
    )
        external
        onlyOwner
        validWalletGroup(groupId)
        nonReentrant
    {
        // Validate inputs
        if (wallets.length == 0) revert InvalidInput();
        if (quantity == 0) revert InvalidInput();

        // Calculate total quantity
        uint256 totalQuantity = wallets.length * quantity;

        // Check total supply
        if (_totalMinted() + totalQuantity > maxSupply) revert MaxSupplyReached();

        // Verify all wallets are members of the group and mint
        for (uint256 i = 0; i < wallets.length; i++) {
            if (wallets[i] == address(0)) revert InvalidAddress();
            if (!walletGroupMembers[groupId][wallets[i]]) revert NotEligible();

            _mint(wallets[i], quantity);
        }

        // Emit event
        emit AirdropExecuted(wallets.length, totalQuantity);
    }

    // ============================================
    // PHASE MANAGEMENT FUNCTIONS
    // ============================================

    /**
     * @notice Create a new mint phase
     * @dev Creates a new phase with all configuration parameters
     * @param name Phase name (e.g., "VIP Sale", "Public Sale")
     * @param startTime Unix timestamp when phase starts
     * @param endTime Unix timestamp when phase ends
     * @param price Price per NFT in wei
     * @param phaseMaxSupply Maximum NFTs that can be minted in this phase
     * @param maxPerWallet Maximum NFTs per wallet in this phase
     * @param walletGroupId Wallet group ID (0 = public, >0 = specific group)
     * @param buyXGetY Enable Buy X Get Y promotion
     * @param buyAmount Number of NFTs to buy for bonus
     * @param getAmount Number of bonus NFTs to receive
     * @return uint256 The ID of the newly created phase
     */
    function createMintPhase(
        string memory name,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 phaseMaxSupply,
        uint256 maxPerWallet,
        uint256 walletGroupId,
        bool buyXGetY,
        uint256 buyAmount,
        uint256 getAmount
    ) external onlyOwner returns (uint256) {
        // Validate time window
        if (startTime >= endTime) revert InvalidInput();
        if (endTime <= block.timestamp) revert InvalidInput();

        // Validate supply
        if (phaseMaxSupply == 0) revert InvalidInput();
        if (phaseMaxSupply > maxSupply) revert InvalidInput();

        // Validate wallet limit
        if (maxPerWallet == 0) revert InvalidInput();

        // Validate Buy X Get Y parameters
        if (buyXGetY) {
            if (buyAmount == 0 || getAmount == 0) revert InvalidInput();
        }

        // Validate wallet group exists if not public
        if (walletGroupId > 0 && walletGroupId >= walletGroupCount) {
            revert InvalidInput();
        }

        // Create new phase
        uint256 phaseId = phaseCount++;

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
        return phaseId;
    }

    /**
     * @notice Update an existing mint phase
     * @dev Can update most parameters, but cannot decrease supply below minted amount
     * @param phaseId ID of the phase to update
     * @param name New phase name
     * @param startTime New start time
     * @param endTime New end time
     * @param price New price per NFT
     * @param phaseMaxSupply New phase max supply
     * @param maxPerWallet New max per wallet
     */
    function updateMintPhase(
        uint256 phaseId,
        string memory name,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 phaseMaxSupply,
        uint256 maxPerWallet
    ) external onlyOwner validPhase(phaseId) {
        MintPhase storage phase = mintPhases[phaseId];

        // Validate time window
        if (startTime >= endTime) revert InvalidInput();

        // Validate supply (cannot decrease below already minted)
        if (phaseMaxSupply == 0) revert InvalidInput();
        if (phaseMaxSupply < phase.minted) revert InvalidInput();
        if (phaseMaxSupply > maxSupply) revert InvalidInput();

        // Validate wallet limit
        if (maxPerWallet == 0) revert InvalidInput();

        // Update phase
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
     * @dev Allows admin to manually pause/unpause a phase without changing other settings
     * @param phaseId ID of the phase to toggle
     */
    function togglePhase(uint256 phaseId) external onlyOwner validPhase(phaseId) {
        MintPhase storage phase = mintPhases[phaseId];
        phase.active = !phase.active;
        emit PhaseToggled(phaseId, phase.active);
    }

    // ============================================
    // WALLET GROUP MANAGEMENT FUNCTIONS
    // ============================================

    /**
     * @notice Create a new wallet group
     * @dev Creates an allowlist group with default pricing and limits
     * @param name Group name (e.g., "VIP", "Whitelist", "Team")
     * @param defaultPrice Default price in wei for group members
     * @param defaultMaxMint Default max mint for group members
     * @return uint256 The ID of the newly created group
     */
    function createWalletGroup(
        string memory name,
        uint256 defaultPrice,
        uint256 defaultMaxMint
    ) external onlyOwner returns (uint256) {
        // Validate inputs (price can be 0 for free mints)
        if (defaultMaxMint == 0) revert InvalidInput();

        // Create new group
        uint256 groupId = walletGroupCount++;

        walletGroups[groupId] = WalletGroup({
            name: name,
            defaultPrice: defaultPrice,
            defaultMaxMint: defaultMaxMint,
            active: true
        });

        emit WalletGroupCreated(groupId, name);
        return groupId;
    }

    /**
     * @notice Update wallet group settings
     * @dev Updates default settings for a group (doesn't affect existing overrides)
     * @param groupId Group ID to update
     * @param name New group name
     * @param defaultPrice New default price
     * @param defaultMaxMint New default max mint
     */
    function updateWalletGroup(
        uint256 groupId,
        string memory name,
        uint256 defaultPrice,
        uint256 defaultMaxMint
    ) external onlyOwner validWalletGroup(groupId) {
        // Validate inputs
        if (defaultMaxMint == 0) revert InvalidInput();

        WalletGroup storage group = walletGroups[groupId];
        group.name = name;
        group.defaultPrice = defaultPrice;
        group.defaultMaxMint = defaultMaxMint;
    }

    /**
     * @notice Add wallets to a group
     * @dev Bulk add wallets without custom overrides (uses group defaults)
     * @param groupId Group ID to add wallets to
     * @param wallets Array of wallet addresses to add
     */
    function addWalletsToGroup(uint256 groupId, address[] calldata wallets)
        external
        onlyOwner
        validWalletGroup(groupId)
    {
        // Validate input
        if (wallets.length == 0) revert InvalidInput();

        // Add each wallet to the group
        for (uint256 i = 0; i < wallets.length; i++) {
            if (wallets[i] == address(0)) revert InvalidAddress();
            walletGroupMembers[groupId][wallets[i]] = true;
        }

        emit WalletsAddedToGroup(groupId, wallets.length);
    }

    /**
     * @notice Add wallet with custom price/limit override
     * @dev Adds wallet to group with custom pricing and/or mint limit
     * @param groupId Group ID to add wallet to
     * @param wallet Wallet address to add
     * @param customPrice Custom price for this wallet (0 = use group default)
     * @param customMaxMint Custom max mint for this wallet (0 = use group default)
     */
    function addWalletWithOverride(
        uint256 groupId,
        address wallet,
        uint256 customPrice,
        uint256 customMaxMint
    ) external onlyOwner validWalletGroup(groupId) {
        // Validate input
        if (wallet == address(0)) revert InvalidAddress();

        // Add wallet to group
        walletGroupMembers[groupId][wallet] = true;

        // Set override (hasOverride = true if either custom value is set)
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
     * @dev Removes wallet membership and deletes any custom overrides
     * @param groupId Group ID to remove wallet from
     * @param wallet Wallet address to remove
     */
    function removeWalletFromGroup(uint256 groupId, address wallet)
        external
        onlyOwner
        validWalletGroup(groupId)
    {
        // Validate input
        if (wallet == address(0)) revert InvalidAddress();

        // Remove wallet from group
        walletGroupMembers[groupId][wallet] = false;

        // Delete any existing overrides
        delete walletOverrides[groupId][wallet];

        emit WalletRemovedFromGroup(groupId, wallet);
    }

    /**
     * @notice Bulk update wallet overrides
     * @dev Efficiently update custom settings for multiple wallets
     * @param groupId Group ID to update wallets in
     * @param wallets Array of wallet addresses to update
     * @param prices Array of custom prices (0 = use group default)
     * @param maxMints Array of custom max mints (0 = use group default)
     */
    function bulkUpdateWallets(
        uint256 groupId,
        address[] calldata wallets,
        uint256[] calldata prices,
        uint256[] calldata maxMints
    ) external onlyOwner validWalletGroup(groupId) {
        // Validate arrays have same length
        if (wallets.length != prices.length || wallets.length != maxMints.length) {
            revert InvalidInput();
        }
        if (wallets.length == 0) revert InvalidInput();

        // Update each wallet
        for (uint256 i = 0; i < wallets.length; i++) {
            if (wallets[i] == address(0)) revert InvalidAddress();

            // Ensure wallet is a member
            if (!walletGroupMembers[groupId][wallets[i]]) {
                walletGroupMembers[groupId][wallets[i]] = true;
            }

            // Set override
            bool hasOverride = (prices[i] > 0 || maxMints[i] > 0);
            walletOverrides[groupId][wallets[i]] = WalletOverride({
                customPrice: prices[i],
                customMaxMint: maxMints[i],
                hasOverride: hasOverride
            });

            emit WalletOverrideSet(groupId, wallets[i], prices[i], maxMints[i]);
        }
    }

    /**
     * @notice Toggle wallet group active status
     * @dev Instantly enable or disable a wallet group
     * @param groupId Group ID to toggle
     */
    function toggleWalletGroup(uint256 groupId)
        external
        onlyOwner
        validWalletGroup(groupId)
    {
        WalletGroup storage group = walletGroups[groupId];
        group.active = !group.active;

        emit WalletGroupToggled(groupId, group.active);
    }

    // ============================================
    // SUPPLY MANAGEMENT FUNCTIONS
    // ============================================

    /**
     * @notice Increase maximum supply
     * @dev Allows expanding the collection size. New max must be greater than current max.
     * @param newMax The new maximum supply
     */
    function increaseMaxSupply(uint256 newMax) external onlyOwner {
        // Validate new max is greater than current max
        if (newMax <= maxSupply) revert InvalidInput();

        // Update max supply
        maxSupply = newMax;

        emit MaxSupplyUpdated(newMax);
    }

    /**
     * @notice Decrease maximum supply
     * @dev Allows reducing the collection size. Cannot decrease below already minted amount.
     * @param newMax The new maximum supply
     */
    function decreaseMaxSupply(uint256 newMax) external onlyOwner {
        // Validate new max is less than current max
        if (newMax >= maxSupply) revert InvalidInput();

        // Validate new max is not below already minted
        if (newMax < _totalMinted()) revert InvalidInput();

        // Validate new max is not zero
        if (newMax == 0) revert InvalidInput();

        // Update max supply
        maxSupply = newMax;

        emit MaxSupplyUpdated(newMax);
    }

    // ============================================
    // METADATA FUNCTIONS
    // ============================================

    /**
     * @notice Set base URI for revealed metadata
     * @dev Cannot be changed after metadata is locked
     * @param newBaseURI The new base URI (typically IPFS, e.g., "ipfs://Qm.../")
     */
    function setBaseURI(string memory newBaseURI) external onlyOwner {
        // Check metadata is not locked
        if (metadataLocked) revert MetadataIsLocked();

        // Update base URI
        baseTokenURI = newBaseURI;

        emit BaseURIUpdated(newBaseURI);
    }

    /**
     * @notice Set placeholder URI for unrevealed tokens
     * @dev This URI is shown for all tokens before reveal. Cannot be changed after metadata is locked.
     * @param uri The placeholder URI (typically a single metadata JSON file)
     */
    function setPlaceholderURI(string memory uri) external onlyOwner {
        // Check metadata is not locked
        if (metadataLocked) revert MetadataIsLocked();

        // Update placeholder URI
        placeholderURI = uri;

        emit PlaceholderURIUpdated(uri);
    }

    /**
     * @notice Reveal all NFTs
     * @dev Switches from placeholder URI to base URI. Requires base URI to be set first.
     *      This is a one-time operation and cannot be undone.
     */
    function reveal() external onlyOwner {
        // Check not already revealed
        if (revealed) revert AlreadyRevealed();

        // Check base URI is set
        if (bytes(baseTokenURI).length == 0) revert InvalidInput();

        // Set revealed to true
        revealed = true;

        emit Revealed();
    }

    /**
     * @notice Permanently lock metadata (irreversible)
     * @dev Once locked, base URI and placeholder URI cannot be changed.
     *      Requires NFTs to be revealed first. This action cannot be undone.
     */
    function lockMetadata() external onlyOwner {
        // Check NFTs are revealed first
        if (!revealed) revert NotRevealed();

        // Check not already locked
        if (metadataLocked) revert MetadataIsLocked();

        // Lock metadata permanently
        metadataLocked = true;

        emit MetadataLocked();
    }

    /**
     * @notice Get token URI (overrides ERC721A)
     * @dev Returns placeholder URI before reveal, or base URI + tokenId + ".json" after reveal
     * @param tokenId The token ID to get URI for
     * @return string The token's metadata URI
     */
    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override
        returns (string memory)
    {
        // Check token exists
        if (!_exists(tokenId)) revert InvalidInput();

        // If not revealed, return placeholder URI for all tokens
        if (!revealed) {
            return placeholderURI;
        }

        // Return base URI + tokenId + ".json"
        return string(
            abi.encodePacked(baseTokenURI, StringsUpgradeable.toString(tokenId), ".json")
        );
    }

    // ============================================
    // REVENUE & PAYOUT FUNCTIONS
    // ============================================

    /**
     * @notice Add a payout wallet for revenue splitting
     * @dev Share percentage is out of 10000 (e.g., 5000 = 50%)
     * @param wallet Address to receive revenue
     * @param sharePercentage Percentage share out of 10000
     */
    function addPayoutWallet(address wallet, uint256 sharePercentage)
        external
        onlyOwner
    {
        // Validate wallet address
        if (wallet == address(0)) revert InvalidAddress();

        // Validate share percentage (must be > 0)
        if (sharePercentage == 0) revert InvalidInput();

        // Validate total shares won't exceed 100%
        uint256 currentTotal = getTotalShares();
        if (currentTotal + sharePercentage > 10000) revert InvalidShares();

        // Add payout wallet
        payoutWallets.push(PayoutWallet({
            wallet: wallet,
            sharePercentage: sharePercentage
        }));

        emit PayoutWalletAdded(wallet, sharePercentage);
    }

    /**
     * @notice Update existing payout wallet
     * @dev Can update both wallet address and share percentage
     * @param index Index of the payout wallet to update
     * @param wallet New wallet address
     * @param sharePercentage New share percentage out of 10000
     */
    function updatePayoutWallet(uint256 index, address wallet, uint256 sharePercentage)
        external
        onlyOwner
    {
        // Validate index is within bounds
        if (index >= payoutWallets.length) revert InvalidInput();

        // Validate wallet address
        if (wallet == address(0)) revert InvalidAddress();

        // Validate share percentage (must be > 0)
        if (sharePercentage == 0) revert InvalidInput();

        // Calculate new total (subtract old share, add new share)
        uint256 currentTotal = getTotalShares();
        uint256 oldShare = payoutWallets[index].sharePercentage;
        uint256 newTotal = currentTotal - oldShare + sharePercentage;

        // Validate new total won't exceed 100%
        if (newTotal > 10000) revert InvalidShares();

        // Update payout wallet
        payoutWallets[index].wallet = wallet;
        payoutWallets[index].sharePercentage = sharePercentage;

        emit PayoutWalletUpdated(index, wallet, sharePercentage);
    }

    /**
     * @notice Remove a payout wallet
     * @dev Uses swap-and-pop for gas-efficient removal. Order is not preserved.
     * @param index Index of the payout wallet to remove
     */
    function removePayoutWallet(uint256 index) external onlyOwner {
        // Validate index is within bounds
        if (index >= payoutWallets.length) revert InvalidInput();

        // Get the last index
        uint256 lastIndex = payoutWallets.length - 1;

        // If not removing the last element, swap with the last element
        if (index != lastIndex) {
            payoutWallets[index] = payoutWallets[lastIndex];
        }

        // Remove the last element
        payoutWallets.pop();

        emit PayoutWalletRemoved(index);
    }

    /**
     * @notice Withdraw funds to payout wallets
     * @dev Distributes contract balance to all payout wallets based on share percentages.
     *      Total shares must equal exactly 10000 (100%) before withdrawal.
     *      Any dust from rounding is sent to the contract owner.
     */
    function withdraw() external onlyOwner nonReentrant {
        // Get current balance
        uint256 balance = address(this).balance;

        // Validate there are funds to withdraw
        if (balance == 0) revert NoFunds();

        // Validate payout wallets are configured
        if (payoutWallets.length == 0) revert InvalidShares();

        // Validate total shares equal 100%
        uint256 totalShares = getTotalShares();
        if (totalShares != 10000) revert InvalidShares();

        // Track total distributed for dust calculation
        uint256 totalDistributed = 0;

        // Distribute to each payout wallet
        for (uint256 i = 0; i < payoutWallets.length; i++) {
            // Calculate amount for this wallet
            uint256 amount = (balance * payoutWallets[i].sharePercentage) / 10000;

            if (amount > 0) {
                // Transfer to payout wallet
                (bool success, ) = payoutWallets[i].wallet.call{value: amount}("");
                if (!success) revert TransferFailed();

                totalDistributed += amount;
            }
        }

        // Send any remaining dust to the owner (from rounding)
        uint256 dust = balance - totalDistributed;
        if (dust > 0) {
            (bool dustSuccess, ) = _owner.call{value: dust}("");
            if (!dustSuccess) revert TransferFailed();
        }

        // Update withdrawn revenue tracking
        withdrawnRevenue += balance;

        emit Withdrawn(balance);
    }

    /**
     * @notice Get total shares percentage across all payout wallets
     * @dev Should equal 10000 (100%) for valid configuration
     * @return uint256 Total share percentage (out of 10000)
     */
    function getTotalShares() public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < payoutWallets.length; i++) {
            total += payoutWallets[i].sharePercentage;
        }
        return total;
    }

    /**
     * @notice Get number of payout wallets
     */
    function getPayoutWalletCount() external view returns (uint256) {
        return payoutWallets.length;
    }

    /**
     * @notice Get available balance for withdrawal
     */
    function getAvailableBalance() public view returns (uint256) {
        return address(this).balance;
    }

    // ============================================
    // CONTROL FUNCTIONS
    // ============================================

    /**
     * @notice Pause the contract
     * @dev When paused, minting is disabled. Emergency use only.
     */
    function pause() external onlyOwner {
        if (paused) revert ContractPaused();
        paused = true;
        emit Paused();
    }

    /**
     * @notice Unpause the contract
     * @dev Resumes normal contract operations
     */
    function unpause() external onlyOwner {
        if (!paused) revert InvalidInput();
        paused = false;
        emit Unpaused();
    }

    /**
     * @notice Enable or disable transfers
     * @dev When disabled, NFTs cannot be transferred (soulbound-like behavior)
     *      Minting and burning are still allowed when transfers are disabled.
     * @param enabled True to allow transfers, false to disable
     */
    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        emit TransfersToggled(enabled);
    }

    /**
     * @notice Enable or disable burning
     * @dev When enabled, token holders can burn their own NFTs
     * @param enabled True to allow burning, false to disable
     */
    function setBurnEnabled(bool enabled) external onlyOwner {
        burnEnabled = enabled;
        emit BurnToggled(enabled);
    }

    /**
     * @notice Burn a token
     * @dev Only the token owner can burn their token. Burning must be enabled.
     * @param tokenId The token ID to burn
     */
    function burn(uint256 tokenId) external {
        // Check burning is enabled
        if (!burnEnabled) revert BurningDisabled();

        // Check caller owns the token
        if (ownerOf(tokenId) != msg.sender) revert Unauthorized();

        // Burn the token
        _burn(tokenId);
    }

    // ============================================
    // ROYALTY FUNCTIONS (ERC2981)
    // ============================================

    /**
     * @notice Set royalty information
     * @dev Sets the royalty receiver and percentage for secondary sales.
     *      Implements ERC2981 standard for on-chain royalties.
     * @param receiver Address to receive royalty payments
     * @param bps Royalty percentage in basis points (100 = 1%, max 1000 = 10%)
     */
    function setRoyaltyInfo(address receiver, uint96 bps) external onlyOwner {
        // Validate receiver address
        if (receiver == address(0)) revert InvalidAddress();

        // Validate royalty percentage (max 10%)
        if (bps > 1000) revert InvalidInput();

        // Update royalty info
        royaltyReceiver = receiver;
        royaltyBps = bps;

        emit RoyaltyInfoUpdated(receiver, bps);
    }

    /**
     * @notice Get royalty information for a token sale
     * @dev Implements ERC2981 royaltyInfo function.
     *      Returns the same royalty for all tokens (collection-wide royalty).
     * @param tokenId The token ID (unused - same royalty for all tokens)
     * @param salePrice The sale price of the token
     * @return receiver Address to receive royalty payment
     * @return royaltyAmount The royalty amount to pay
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        // Silence unused variable warning (same royalty for all tokens)
        tokenId;

        // Calculate royalty amount: (salePrice * bps) / 10000
        royaltyAmount = (salePrice * royaltyBps) / 10000;
        receiver = royaltyReceiver;
    }

    // ============================================
    // OWNERSHIP FUNCTIONS
    // ============================================

    /**
     * @notice Transfer ownership to a new address
     * @dev Transfers control of the contract to a new owner.
     *      The new owner will have full admin access.
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        // Validate new owner address
        if (newOwner == address(0)) revert InvalidAddress();

        // Store previous owner for event
        address previousOwner = _owner;

        // Transfer ownership
        _owner = newOwner;

        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /**
     * @notice Get current owner
     */
    function owner() public view returns (address) {
        return _owner;
    }

    // ============================================
    // HELPER/VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Check if wallet is eligible for a phase
     * @param wallet Address to check
     * @param phaseId Phase ID to check
     * @return bool True if wallet is eligible for the phase
     */
    function isEligibleForPhase(address wallet, uint256 phaseId)
        public
        view
        validPhase(phaseId)
        returns (bool)
    {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase (walletGroupId = 0) is open to everyone
        if (phase.walletGroupId == 0) {
            return true;
        }

        // Check if wallet group is active
        if (!walletGroups[phase.walletGroupId].active) {
            return false;
        }

        // Check if wallet is a member of the required group
        return walletGroupMembers[phase.walletGroupId][wallet];
    }

    /**
     * @notice Get effective price for wallet in phase
     * @dev Checks for wallet-specific overrides, then group defaults, then phase price
     * @param wallet Address to check
     * @param phaseId Phase ID to check
     * @return uint256 Price in wei per NFT
     */
    function getPriceForWallet(address wallet, uint256 phaseId)
        public
        view
        validPhase(phaseId)
        returns (uint256)
    {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase uses phase price
        if (phase.walletGroupId == 0) {
            return phase.price;
        }

        // Check for wallet-specific override (includes free mints where customPrice = 0)
        WalletOverride storage walletOverride = walletOverrides[phase.walletGroupId][wallet];
        if (walletOverride.hasOverride) {
            return walletOverride.customPrice;
        }

        // Use wallet group default price
        WalletGroup storage group = walletGroups[phase.walletGroupId];
        return group.defaultPrice;
    }

    /**
     * @notice Get effective max mint for wallet in phase
     * @dev Checks for wallet-specific overrides, then group defaults, then phase limit
     * @param wallet Address to check
     * @param phaseId Phase ID to check
     * @return uint256 Maximum number of NFTs wallet can mint in this phase
     */
    function getMaxMintForWallet(address wallet, uint256 phaseId)
        public
        view
        validPhase(phaseId)
        returns (uint256)
    {
        MintPhase storage phase = mintPhases[phaseId];

        // Public phase uses phase max per wallet
        if (phase.walletGroupId == 0) {
            return phase.maxPerWallet;
        }

        // Check for wallet-specific override
        WalletOverride storage walletOverride = walletOverrides[phase.walletGroupId][wallet];
        if (walletOverride.hasOverride && walletOverride.customMaxMint > 0) {
            return walletOverride.customMaxMint;
        }

        // Use wallet group default max mint
        WalletGroup storage group = walletGroups[phase.walletGroupId];
        return group.defaultMaxMint;
    }

    /**
     * @notice Get remaining mints for wallet in phase
     * @dev Calculates how many more NFTs a wallet can mint in a specific phase
     * @param wallet Address to check
     * @param phaseId Phase ID to check
     * @return uint256 Number of NFTs wallet can still mint (0 if limit reached)
     */
    function getRemainingMintsForWallet(address wallet, uint256 phaseId)
        public
        view
        validPhase(phaseId)
        returns (uint256)
    {
        uint256 maxMint = getMaxMintForWallet(wallet, phaseId);
        uint256 minted = phaseMints[phaseId][wallet];

        // If already minted max or more, return 0
        if (minted >= maxMint) {
            return 0;
        }

        // Return remaining mints
        return maxMint - minted;
    }

    /**
     * @notice Check if phase is currently active
     * @dev A phase is active if:
     *      - Manual active flag is true
     *      - Current time is within phase window (startTime <= now <= endTime)
     *      - Phase has not sold out (minted < maxSupply)
     * @param phaseId Phase ID to check
     * @return bool True if phase is currently active and can accept mints
     */
    function isPhaseActive(uint256 phaseId)
        public
        view
        validPhase(phaseId)
        returns (bool)
    {
        MintPhase storage phase = mintPhases[phaseId];

        // Check if phase is manually paused
        if (!phase.active) {
            return false;
        }

        // Check if current time is within phase window
        if (block.timestamp < phase.startTime || block.timestamp > phase.endTime) {
            return false;
        }

        // Check if phase has supply remaining
        if (phase.minted >= phase.maxSupply) {
            return false;
        }

        // All checks passed
        return true;
    }

    /**
     * @notice Get total number of minted NFTs
     */
    function totalMinted() public view returns (uint256) {
        return _totalMinted();
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    /**
     * @dev Hook called before token transfers
     * @notice Enforces transfer restrictions:
     *         - Minting (from = 0) is always allowed
     *         - Burning (to = 0) is allowed if burnEnabled
     *         - Regular transfers require transfersEnabled = true
     */
    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        // Allow minting (from = address(0))
        if (from == address(0)) {
            super._beforeTokenTransfers(from, to, startTokenId, quantity);
            return;
        }

        // Allow burning if enabled (to = address(0))
        if (to == address(0)) {
            if (!burnEnabled) revert BurningDisabled();
            super._beforeTokenTransfers(from, to, startTokenId, quantity);
            return;
        }

        // For regular transfers, check if transfers are enabled
        if (!transfersEnabled) revert TransfersDisabled();

        super._beforeTokenTransfers(from, to, startTokenId, quantity);
    }

    /**
     * @dev Base URI for computing tokenURI
     */
    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }

    /**
     * @dev Start token ID at 1 instead of 0
     */
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    // ============================================
    // INTERFACE SUPPORT
    // ============================================

    /**
     * @notice Check interface support
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return
            interfaceId == 0x2a55205a || // ERC2981 (Royalty)
            super.supportsInterface(interfaceId);
    }
}
