// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "./PhaseManager.sol";
import "./AllowlistManager.sol";

/**
 * @title NFTLaunchpad
 * @notice Production-grade NFT Launchpad with modular architecture
 * @dev Core ERC721A contract - uses external PhaseManager and AllowlistManager
 */
contract NFTLaunchpad is Initializable, ERC721AUpgradeable {

    // ============================================
    // STRUCTS
    // ============================================

    /**
     * @dev Payout wallet configuration for revenue splitting
     */
    struct PayoutWallet {
        address wallet;
        uint256 sharePercentage;
    }

    // ============================================
    // CONSTANTS
    // ============================================

    uint256 public constant MAX_AIRDROP_BATCH_SIZE = 200;

    // ============================================
    // STATE VARIABLES
    // ============================================

    // Supply Management
    uint256 public maxSupply;

    // Metadata
    string private baseTokenURI;
    string private placeholderURI;
    bool public revealed;
    bool public metadataLocked;

    // External Managers
    PhaseManager public phaseManager;
    AllowlistManager public allowlistManager;

    // Revenue Management
    PayoutWallet[] public payoutWallets;
    uint256 public totalRevenue;
    uint256 public withdrawnRevenue;

    // Control Flags
    address private _owner;
    bool public paused;
    bool public transfersEnabled;
    bool public burnEnabled;

    // Royalties (ERC2981)
    address public royaltyReceiver;
    uint96 public royaltyBps;

    // Reentrancy Guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    // ============================================
    // EVENTS
    // ============================================

    event Minted(address indexed minter, uint256 quantity, uint256 phaseId, uint256 totalPaid);
    event AdminMinted(address indexed to, uint256 quantity);
    event AirdropExecuted(uint256 totalWallets, uint256 totalMinted);
    event MaxSupplyUpdated(uint256 newMaxSupply);
    event BaseURIUpdated(string newBaseURI);
    event PlaceholderURIUpdated(string newPlaceholderURI);
    event Revealed();
    event MetadataLocked();
    event PayoutWalletAdded(address wallet, uint256 sharePercentage);
    event PayoutWalletUpdated(uint256 index, address wallet, uint256 sharePercentage);
    event PayoutWalletRemoved(uint256 index);
    event Withdrawn(uint256 amount);
    event Paused();
    event Unpaused();
    event TransfersToggled(bool enabled);
    event BurnToggled(bool enabled);
    event RoyaltyInfoUpdated(address receiver, uint96 bps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ManagersUpdated(address phaseManager, address allowlistManager);

    // ============================================
    // ERRORS
    // ============================================

    error ContractPaused();
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
    error BatchTooLarge();

    // ============================================
    // MODIFIERS
    // ============================================

    modifier onlyOwner() {
        if (msg.sender != _owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuard();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ============================================
    // INITIALIZER
    // ============================================

    /**
     * @notice Initialize the NFT Launchpad contract
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        address phaseManager_,
        address allowlistManager_
    ) public initializerERC721A initializer {
        __ERC721A_init(name_, symbol_);

        if (maxSupply_ == 0) revert InvalidInput();
        if (royaltyReceiver_ == address(0)) revert InvalidAddress();
        if (royaltyBps_ > 1000) revert InvalidInput();
        if (phaseManager_ == address(0)) revert InvalidAddress();
        if (allowlistManager_ == address(0)) revert InvalidAddress();

        _owner = msg.sender;
        maxSupply = maxSupply_;
        royaltyReceiver = royaltyReceiver_;
        royaltyBps = royaltyBps_;
        transfersEnabled = true;
        burnEnabled = false;
        _status = _NOT_ENTERED;

        phaseManager = PhaseManager(phaseManager_);
        allowlistManager = AllowlistManager(allowlistManager_);

        emit OwnershipTransferred(address(0), msg.sender);
        emit ManagersUpdated(phaseManager_, allowlistManager_);
    }

    // ============================================
    // MINTING FUNCTIONS
    // ============================================

    /**
     * @notice Mint NFTs during an active phase
     * @param quantity Number of NFTs to mint
     * @param phaseId ID of the mint phase
     */
    function mint(uint256 quantity, uint256 phaseId)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        _mintInternal(quantity, phaseId, new bytes32[](0));
    }

    /**
     * @notice Mint NFTs with Merkle proof verification
     * @param quantity Number of NFTs to mint
     * @param phaseId ID of the mint phase
     * @param merkleProof Merkle proof for allowlist verification
     */
    function mintWithProof(
        uint256 quantity,
        uint256 phaseId,
        bytes32[] calldata merkleProof
    )
        external
        payable
        whenNotPaused
        nonReentrant
    {
        _mintInternal(quantity, phaseId, merkleProof);
    }

    /**
     * @dev Internal mint function
     */
    function _mintInternal(
        uint256 quantity,
        uint256 phaseId,
        bytes32[] memory merkleProof
    ) internal {
        // Validate and record mint via PhaseManager
        (uint256 finalQuantity, uint256 totalPrice) = phaseManager.validateAndRecordMint(
            phaseId,
            msg.sender,
            quantity,
            merkleProof
        );

        // Check total supply
        if (_totalMinted() + finalQuantity > maxSupply) revert MaxSupplyReached();

        // Check payment
        if (msg.value < totalPrice) revert InsufficientPayment();

        // Mint tokens
        _mint(msg.sender, finalQuantity);

        unchecked {
            totalRevenue += totalPrice;
        }

        // Refund excess payment
        if (msg.value > totalPrice) {
            (bool success, ) = msg.sender.call{value: msg.value - totalPrice}("");
            if (!success) revert TransferFailed();
        }

        emit Minted(msg.sender, finalQuantity, phaseId, totalPrice);
    }

    /**
     * @notice Admin mint for team, reserves, giveaways
     */
    function adminMint(address to, uint256 quantity)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert InvalidAddress();
        if (quantity == 0) revert InvalidInput();
        if (_totalMinted() + quantity > maxSupply) revert MaxSupplyReached();

        _mint(to, quantity);
        emit AdminMinted(to, quantity);
    }

    /**
     * @notice Airdrop NFTs to multiple wallets
     */
    function airdrop(address[] calldata recipients, uint256[] calldata quantities)
        external
        onlyOwner
        nonReentrant
    {
        if (recipients.length != quantities.length) revert InvalidInput();
        if (recipients.length == 0) revert InvalidInput();
        if (recipients.length > MAX_AIRDROP_BATCH_SIZE) revert BatchTooLarge();

        uint256 totalQuantity = 0;
        for (uint256 i = 0; i < quantities.length;) {
            if (recipients[i] == address(0)) revert InvalidAddress();
            if (quantities[i] == 0) revert InvalidInput();
            totalQuantity += quantities[i];
            unchecked { ++i; }
        }

        if (_totalMinted() + totalQuantity > maxSupply) revert MaxSupplyReached();

        for (uint256 i = 0; i < recipients.length;) {
            _mint(recipients[i], quantities[i]);
            unchecked { ++i; }
        }

        emit AirdropExecuted(recipients.length, totalQuantity);
    }

    // ============================================
    // SUPPLY MANAGEMENT
    // ============================================

    function increaseMaxSupply(uint256 newMax) external onlyOwner {
        if (newMax <= maxSupply) revert InvalidInput();
        maxSupply = newMax;
        emit MaxSupplyUpdated(newMax);
    }

    function decreaseMaxSupply(uint256 newMax) external onlyOwner {
        if (newMax >= maxSupply) revert InvalidInput();
        if (newMax < _totalMinted()) revert InvalidInput();
        if (newMax == 0) revert InvalidInput();
        maxSupply = newMax;
        emit MaxSupplyUpdated(newMax);
    }

    // ============================================
    // METADATA FUNCTIONS
    // ============================================

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        if (metadataLocked) revert MetadataIsLocked();
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function setPlaceholderURI(string memory uri) external onlyOwner {
        if (metadataLocked) revert MetadataIsLocked();
        placeholderURI = uri;
        emit PlaceholderURIUpdated(uri);
    }

    function reveal() external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        if (bytes(baseTokenURI).length == 0) revert InvalidInput();
        revealed = true;
        emit Revealed();
    }

    function lockMetadata() external onlyOwner {
        if (!revealed) revert NotRevealed();
        if (metadataLocked) revert MetadataIsLocked();
        metadataLocked = true;
        emit MetadataLocked();
    }

    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override
        returns (string memory)
    {
        if (!_exists(tokenId)) revert InvalidInput();
        if (!revealed) return placeholderURI;
        return string(abi.encodePacked(baseTokenURI, StringsUpgradeable.toString(tokenId), ".json"));
    }

    // ============================================
    // REVENUE & PAYOUT FUNCTIONS
    // ============================================

    function addPayoutWallet(address wallet, uint256 sharePercentage) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        if (sharePercentage == 0) revert InvalidInput();
        if (getTotalShares() + sharePercentage > 10000) revert InvalidShares();

        payoutWallets.push(PayoutWallet({
            wallet: wallet,
            sharePercentage: sharePercentage
        }));

        emit PayoutWalletAdded(wallet, sharePercentage);
    }

    function updatePayoutWallet(uint256 index, address wallet, uint256 sharePercentage) external onlyOwner {
        if (index >= payoutWallets.length) revert InvalidInput();
        if (wallet == address(0)) revert InvalidAddress();
        if (sharePercentage == 0) revert InvalidInput();

        uint256 currentTotal = getTotalShares();
        uint256 oldShare = payoutWallets[index].sharePercentage;
        uint256 newTotal = currentTotal - oldShare + sharePercentage;

        if (newTotal > 10000) revert InvalidShares();

        payoutWallets[index].wallet = wallet;
        payoutWallets[index].sharePercentage = sharePercentage;

        emit PayoutWalletUpdated(index, wallet, sharePercentage);
    }

    function removePayoutWallet(uint256 index) external onlyOwner {
        if (index >= payoutWallets.length) revert InvalidInput();

        uint256 lastIndex = payoutWallets.length - 1;
        if (index != lastIndex) {
            payoutWallets[index] = payoutWallets[lastIndex];
        }
        payoutWallets.pop();

        emit PayoutWalletRemoved(index);
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoFunds();
        if (payoutWallets.length == 0) revert InvalidShares();
        if (getTotalShares() != 10000) revert InvalidShares();

        uint256 totalDistributed = 0;

        for (uint256 i = 0; i < payoutWallets.length;) {
            uint256 amount = (balance * payoutWallets[i].sharePercentage) / 10000;
            if (amount > 0) {
                (bool success, ) = payoutWallets[i].wallet.call{value: amount}("");
                if (!success) revert TransferFailed();
                totalDistributed += amount;
            }
            unchecked { ++i; }
        }

        uint256 dust = balance - totalDistributed;
        if (dust > 0) {
            (bool dustSuccess, ) = _owner.call{value: dust}("");
            if (!dustSuccess) revert TransferFailed();
        }

        withdrawnRevenue += balance;
        emit Withdrawn(balance);
    }

    function getTotalShares() public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < payoutWallets.length;) {
            total += payoutWallets[i].sharePercentage;
            unchecked { ++i; }
        }
        return total;
    }

    function getPayoutWalletCount() external view returns (uint256) {
        return payoutWallets.length;
    }

    function getAvailableBalance() public view returns (uint256) {
        return address(this).balance;
    }

    // ============================================
    // CONTROL FUNCTIONS
    // ============================================

    function pause() external onlyOwner {
        if (paused) revert ContractPaused();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        if (!paused) revert InvalidInput();
        paused = false;
        emit Unpaused();
    }

    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        emit TransfersToggled(enabled);
    }

    function setBurnEnabled(bool enabled) external onlyOwner {
        burnEnabled = enabled;
        emit BurnToggled(enabled);
    }

    function burn(uint256 tokenId) external {
        if (!burnEnabled) revert BurningDisabled();
        if (ownerOf(tokenId) != msg.sender) revert Unauthorized();
        _burn(tokenId);
    }

    // ============================================
    // ROYALTY FUNCTIONS (ERC2981)
    // ============================================

    function setRoyaltyInfo(address receiver, uint96 bps) external onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        if (bps > 1000) revert InvalidInput();
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyInfoUpdated(receiver, bps);
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        royaltyAmount = (salePrice * royaltyBps) / 10000;
        receiver = royaltyReceiver;
    }

    // ============================================
    // OWNERSHIP FUNCTIONS
    // ============================================

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previousOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    // ============================================
    // MANAGER FUNCTIONS
    // ============================================

    function setManagers(address phaseManager_, address allowlistManager_) external onlyOwner {
        if (phaseManager_ == address(0)) revert InvalidAddress();
        if (allowlistManager_ == address(0)) revert InvalidAddress();
        phaseManager = PhaseManager(phaseManager_);
        allowlistManager = AllowlistManager(allowlistManager_);
        emit ManagersUpdated(phaseManager_, allowlistManager_);
    }

    // ============================================
    // VIEW FUNCTIONS (Delegated to managers)
    // ============================================

    function totalMinted() public view returns (uint256) {
        return _totalMinted();
    }

    function isPhaseActive(uint256 phaseId) external view returns (bool) {
        return phaseManager.isPhaseActive(phaseId);
    }

    function isEligibleForPhase(address wallet, uint256 phaseId) external view returns (bool) {
        return phaseManager.isEligibleForPhase(wallet, phaseId);
    }

    function isEligibleWithProof(address wallet, uint256 phaseId, bytes32[] calldata merkleProof) external view returns (bool) {
        return phaseManager.isEligibleWithProof(wallet, phaseId, merkleProof);
    }

    function getPriceForWallet(address wallet, uint256 phaseId) external view returns (uint256) {
        return phaseManager.getPriceForWallet(wallet, phaseId);
    }

    function getMaxMintForWallet(address wallet, uint256 phaseId) external view returns (uint256) {
        return phaseManager.getMaxMintForWallet(wallet, phaseId);
    }

    function getRemainingMintsForWallet(address wallet, uint256 phaseId) external view returns (uint256) {
        return phaseManager.getRemainingMintsForWallet(wallet, phaseId);
    }

    function phaseCount() external view returns (uint256) {
        return phaseManager.phaseCount();
    }

    function walletGroupCount() external view returns (uint256) {
        return allowlistManager.walletGroupCount();
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        if (from == address(0)) {
            super._beforeTokenTransfers(from, to, startTokenId, quantity);
            return;
        }

        if (to == address(0)) {
            if (!burnEnabled) revert BurningDisabled();
            super._beforeTokenTransfers(from, to, startTokenId, quantity);
            return;
        }

        if (!transfersEnabled) revert TransfersDisabled();
        super._beforeTokenTransfers(from, to, startTokenId, quantity);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }

    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    // ============================================
    // INTERFACE SUPPORT
    // ============================================

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return
            interfaceId == 0x2a55205a || // ERC2981
            super.supportsInterface(interfaceId);
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
