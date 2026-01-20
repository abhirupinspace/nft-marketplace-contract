// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./NFTLaunchpad.sol";
import "./PhaseManager.sol";
import "./AllowlistManager.sol";

/**
 * @title LaunchpadFactory
 * @notice Factory contract to deploy isolated NFT collection contracts
 * @dev Deploys NFTLaunchpad, PhaseManager, and AllowlistManager per collection
 */
contract LaunchpadFactory is Initializable, OwnableUpgradeable {
    // ============================================
    // STRUCTS
    // ============================================

    /**
     * @dev Collection deployment record
     */
    struct CollectionDeployment {
        address nftContract;
        address phaseManager;
        address allowlistManager;
        address owner;
        uint256 deployedAt;
    }

    /**
     * @dev Parameters for deploying a new collection
     */
    struct DeploymentParams {
        string name;
        string symbol;
        uint256 maxSupply;
        address royaltyReceiver;
        uint96 royaltyBps;
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    /// @notice Implementation contract addresses (shared by all deployments)
    address public nftLaunchpadImpl;
    address public phaseManagerImpl;
    address public allowlistManagerImpl;

    /// @notice Collection deployments by ID
    mapping(uint256 => CollectionDeployment) public collections;

    /// @notice Total number of deployed collections
    uint256 public collectionCount;

    /// @notice Collections deployed by owner
    mapping(address => uint256[]) public ownerCollections;

    /// @notice NFT contract address to collection ID mapping
    mapping(address => uint256) public nftContractToCollectionId;

    // ============================================
    // EVENTS
    // ============================================

    event CollectionDeployed(
        uint256 indexed collectionId,
        address indexed owner,
        address nftContract,
        address phaseManager,
        address allowlistManager,
        string name,
        string symbol
    );

    event ImplementationsUpdated(
        address nftLaunchpadImpl,
        address phaseManagerImpl,
        address allowlistManagerImpl
    );

    // ============================================
    // ERRORS
    // ============================================

    error InvalidAddress();
    error InvalidImplementation();
    error InvalidInput();

    // ============================================
    // INITIALIZER
    // ============================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the factory contract
     * @param _owner Initial owner address
     * @param _nftLaunchpadImpl NFTLaunchpad implementation address
     * @param _phaseManagerImpl PhaseManager implementation address
     * @param _allowlistManagerImpl AllowlistManager implementation address
     */
    function initialize(
        address _owner,
        address _nftLaunchpadImpl,
        address _phaseManagerImpl,
        address _allowlistManagerImpl
    ) public initializer {
        if (_owner == address(0)) revert InvalidAddress();
        if (_nftLaunchpadImpl == address(0)) revert InvalidImplementation();
        if (_phaseManagerImpl == address(0)) revert InvalidImplementation();
        if (_allowlistManagerImpl == address(0)) revert InvalidImplementation();

        __Ownable_init();
        _transferOwnership(_owner);

        nftLaunchpadImpl = _nftLaunchpadImpl;
        phaseManagerImpl = _phaseManagerImpl;
        allowlistManagerImpl = _allowlistManagerImpl;

        emit ImplementationsUpdated(
            _nftLaunchpadImpl,
            _phaseManagerImpl,
            _allowlistManagerImpl
        );
    }

    // ============================================
    // DEPLOYMENT FUNCTIONS
    // ============================================

    /**
     * @notice Deploy a new NFT collection with all supporting contracts
     * @param params Deployment parameters (name, symbol, maxSupply, royalty info)
     * @return collectionId The ID of the deployed collection
     * @return nftContract Address of the deployed NFTLaunchpad proxy
     * @return phaseManager Address of the deployed PhaseManager proxy
     * @return allowlistManager Address of the deployed AllowlistManager proxy
     */
    function deployCollection(
        DeploymentParams calldata params
    ) external returns (
        uint256 collectionId,
        address nftContract,
        address phaseManager,
        address allowlistManager
    ) {
        if (bytes(params.name).length == 0) revert InvalidInput();
        if (bytes(params.symbol).length == 0) revert InvalidInput();
        if (params.maxSupply == 0) revert InvalidInput();
        if (params.royaltyReceiver == address(0)) revert InvalidAddress();
        if (params.royaltyBps > 1000) revert InvalidInput(); // Max 10% royalty

        // Get collection ID
        collectionId = collectionCount++;

        // 1. Deploy AllowlistManager proxy
        allowlistManager = _deployAllowlistManager(msg.sender);

        // 2. Deploy PhaseManager proxy (needs allowlistManager)
        phaseManager = _deployPhaseManager(msg.sender, allowlistManager);

        // 3. Deploy NFTLaunchpad proxy (needs both managers)
        nftContract = _deployNFTLaunchpad(
            params,
            phaseManager,
            allowlistManager
        );

        // 4. Link contracts together and transfer ownership to user
        _linkContracts(nftContract, phaseManager, allowlistManager, msg.sender);

        // 5. Record deployment
        collections[collectionId] = CollectionDeployment({
            nftContract: nftContract,
            phaseManager: phaseManager,
            allowlistManager: allowlistManager,
            owner: msg.sender,
            deployedAt: block.timestamp
        });

        ownerCollections[msg.sender].push(collectionId);
        nftContractToCollectionId[nftContract] = collectionId;

        emit CollectionDeployed(
            collectionId,
            msg.sender,
            nftContract,
            phaseManager,
            allowlistManager,
            params.name,
            params.symbol
        );

        return (collectionId, nftContract, phaseManager, allowlistManager);
    }

    // ============================================
    // INTERNAL DEPLOYMENT HELPERS
    // ============================================

    /**
     * @dev Deploy AllowlistManager proxy and initialize
     * @notice Initializes with factory as owner for linking, then transfers to user
     */
    function _deployAllowlistManager(
        address _owner
    ) internal returns (address) {
        // Initialize with factory as owner (for linking)
        bytes memory initData = abi.encodeWithSelector(
            AllowlistManager.initialize.selector,
            address(this)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(allowlistManagerImpl, initData);
        return address(proxy);
    }

    /**
     * @dev Deploy PhaseManager proxy and initialize
     * @notice Initializes with factory as owner for linking, then transfers to user
     */
    function _deployPhaseManager(
        address _owner,
        address _allowlistManager
    ) internal returns (address) {
        // Initialize with factory as owner (for linking)
        bytes memory initData = abi.encodeWithSelector(
            PhaseManager.initialize.selector,
            address(this),
            _allowlistManager
        );

        ERC1967Proxy proxy = new ERC1967Proxy(phaseManagerImpl, initData);
        return address(proxy);
    }

    /**
     * @dev Deploy NFTLaunchpad proxy and initialize
     */
    function _deployNFTLaunchpad(
        DeploymentParams calldata params,
        address _phaseManager,
        address _allowlistManager
    ) internal returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            NFTLaunchpad.initialize.selector,
            params.name,
            params.symbol,
            params.maxSupply,
            params.royaltyReceiver,
            params.royaltyBps,
            _phaseManager,
            _allowlistManager
        );

        ERC1967Proxy proxy = new ERC1967Proxy(nftLaunchpadImpl, initData);
        return address(proxy);
    }

    /**
     * @dev Link all three contracts together and transfer ownership to user
     */
    function _linkContracts(
        address _nftContract,
        address _phaseManager,
        address _allowlistManager,
        address _owner
    ) internal {
        // PhaseManager needs to know the launchpad
        PhaseManager(_phaseManager).setLaunchpadContract(_nftContract);

        // AllowlistManager needs to know both contracts
        AllowlistManager(_allowlistManager).setLaunchpadContract(_nftContract);
        AllowlistManager(_allowlistManager).setPhaseManagerContract(_phaseManager);

        // Transfer ownership from factory to user for all three contracts
        NFTLaunchpad(_nftContract).transferOwnership(_owner);
        PhaseManager(_phaseManager).transferOwnership(_owner);
        AllowlistManager(_allowlistManager).transferOwnership(_owner);
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Update implementation contract addresses
     * @dev Only callable by owner
     * @param _nftLaunchpadImpl New NFTLaunchpad implementation
     * @param _phaseManagerImpl New PhaseManager implementation
     * @param _allowlistManagerImpl New AllowlistManager implementation
     */
    function updateImplementations(
        address _nftLaunchpadImpl,
        address _phaseManagerImpl,
        address _allowlistManagerImpl
    ) external onlyOwner {
        if (_nftLaunchpadImpl == address(0)) revert InvalidImplementation();
        if (_phaseManagerImpl == address(0)) revert InvalidImplementation();
        if (_allowlistManagerImpl == address(0)) revert InvalidImplementation();

        nftLaunchpadImpl = _nftLaunchpadImpl;
        phaseManagerImpl = _phaseManagerImpl;
        allowlistManagerImpl = _allowlistManagerImpl;

        emit ImplementationsUpdated(
            _nftLaunchpadImpl,
            _phaseManagerImpl,
            _allowlistManagerImpl
        );
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Get collection deployment details
     * @param collectionId Collection ID
     * @return deployment The collection deployment record
     */
    function getCollection(
        uint256 collectionId
    ) external view returns (CollectionDeployment memory) {
        return collections[collectionId];
    }

    /**
     * @notice Get all collection IDs for an owner
     * @param owner Owner address
     * @return collectionIds Array of collection IDs
     */
    function getOwnerCollections(
        address owner
    ) external view returns (uint256[] memory) {
        return ownerCollections[owner];
    }

    /**
     * @notice Get collection ID by NFT contract address
     * @param nftContract NFT contract address
     * @return collectionId The collection ID
     */
    function getCollectionIdByNFT(
        address nftContract
    ) external view returns (uint256) {
        return nftContractToCollectionId[nftContract];
    }

    /**
     * @notice Check if an address is a deployed NFT contract
     * @param nftContract Address to check
     * @return bool True if deployed by this factory
     */
    function isDeployedCollection(
        address nftContract
    ) external view returns (bool) {
        if (collectionCount == 0) return false;
        uint256 collectionId = nftContractToCollectionId[nftContract];
        return collections[collectionId].nftContract == nftContract;
    }

    // ============================================
    // STORAGE GAP
    // ============================================

    /**
     * @dev Reserved storage space for future upgrades
     */
    uint256[50] private __gap;
}
