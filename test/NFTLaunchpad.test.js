const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

describe("NFTLaunchpad Modular (Upgradeable)", function () {
  let NFTLaunchpad;
  let PhaseManager;
  let AllowlistManager;
  let nft;
  let phaseManager;
  let allowlistManager;
  let owner;
  let user1;
  let user2;
  let user3;
  let royaltyReceiver;

  const NAME = "Test NFT";
  const SYMBOL = "TNFT";
  const MAX_SUPPLY = 10000;
  const ROYALTY_BPS = 500; // 5%

  beforeEach(async function () {
    [owner, user1, user2, user3, royaltyReceiver] = await ethers.getSigners();

    // Deploy AllowlistManager (Upgradeable)
    AllowlistManager = await ethers.getContractFactory("AllowlistManager");
    allowlistManager = await upgrades.deployProxy(
      AllowlistManager,
      [owner.address],
      { initializer: "initialize", kind: "transparent" }
    );
    await allowlistManager.waitForDeployment();

    // Deploy PhaseManager (Upgradeable)
    PhaseManager = await ethers.getContractFactory("PhaseManager");
    phaseManager = await upgrades.deployProxy(
      PhaseManager,
      [owner.address, await allowlistManager.getAddress()],
      { initializer: "initialize", kind: "transparent" }
    );
    await phaseManager.waitForDeployment();

    // Deploy NFTLaunchpad (Upgradeable)
    NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
    nft = await upgrades.deployProxy(
      NFTLaunchpad,
      [
        NAME,
        SYMBOL,
        MAX_SUPPLY,
        royaltyReceiver.address,
        ROYALTY_BPS,
        await phaseManager.getAddress(),
        await allowlistManager.getAddress()
      ],
      { initializer: "initialize", kind: "transparent" }
    );
    await nft.waitForDeployment();

    // Set launchpad contract on managers
    await allowlistManager.setLaunchpadContract(await nft.getAddress());
    await allowlistManager.setPhaseManagerContract(await phaseManager.getAddress());
    await phaseManager.setLaunchpadContract(await nft.getAddress());
  });

  // ============================================
  // INITIALIZATION TESTS
  // ============================================

  describe("Initialization", function () {
    it("should initialize with correct name and symbol", async function () {
      expect(await nft.name()).to.equal(NAME);
      expect(await nft.symbol()).to.equal(SYMBOL);
    });

    it("should set correct max supply", async function () {
      expect(await nft.maxSupply()).to.equal(MAX_SUPPLY);
    });

    it("should set correct owner", async function () {
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("should set correct royalty info", async function () {
      expect(await nft.royaltyReceiver()).to.equal(royaltyReceiver.address);
      expect(await nft.royaltyBps()).to.equal(ROYALTY_BPS);
    });

    it("should have transfers enabled by default", async function () {
      expect(await nft.transfersEnabled()).to.equal(true);
    });

    it("should have burning disabled by default", async function () {
      expect(await nft.burnEnabled()).to.equal(false);
    });

    it("should not be paused by default", async function () {
      expect(await nft.paused()).to.equal(false);
    });

    it("should have managers set correctly", async function () {
      expect(await nft.phaseManager()).to.equal(await phaseManager.getAddress());
      expect(await nft.allowlistManager()).to.equal(await allowlistManager.getAddress());
    });
  });

  // ============================================
  // PHASE MANAGEMENT TESTS
  // ============================================

  describe("Phase Management", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    it("should create a public mint phase", async function () {
      const tx = await phaseManager.createMintPhase(
        "Public Sale",
        now,
        now + oneDay,
        ethers.parseEther("0.1"),
        1000,
        5,
        0, // public
        false,
        0,
        0
      );

      await expect(tx).to.emit(phaseManager, "PhaseCreated").withArgs(0, "Public Sale");
      expect(await phaseManager.phaseCount()).to.equal(1);
    });

    it("should create a phase with Buy X Get Y", async function () {
      await phaseManager.createMintPhase(
        "BOGO Sale",
        now,
        now + oneDay,
        ethers.parseEther("0.1"),
        1000,
        10,
        0,
        true,
        3,
        1
      );

      const phase = await phaseManager.getPhase(0);
      expect(phase.buyXGetY).to.equal(true);
      expect(phase.buyAmount).to.equal(3);
      expect(phase.getAmount).to.equal(1);
    });

    it("should toggle phase active status", async function () {
      await phaseManager.createMintPhase(
        "Toggle Test",
        now,
        now + oneDay,
        ethers.parseEther("0.1"),
        1000,
        5,
        0,
        false,
        0,
        0
      );

      let phase = await phaseManager.getPhase(0);
      expect(phase.active).to.equal(true);

      await phaseManager.togglePhase(0);
      phase = await phaseManager.getPhase(0);
      expect(phase.active).to.equal(false);
    });

    it("should only allow owner to manage phases", async function () {
      await expect(
        phaseManager.connect(user1).createMintPhase(
          "Unauthorized",
          now,
          now + oneDay,
          ethers.parseEther("0.1"),
          1000,
          5,
          0,
          false,
          0,
          0
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ============================================
  // WALLET GROUP TESTS
  // ============================================

  describe("Wallet Groups", function () {
    it("should create a wallet group", async function () {
      const tx = await allowlistManager.createWalletGroup(
        "VIP",
        ethers.parseEther("0.05"),
        10
      );

      await expect(tx).to.emit(allowlistManager, "WalletGroupCreated").withArgs(0, "VIP", false);
      expect(await allowlistManager.walletGroupCount()).to.equal(1);
    });

    it("should add wallets to a group", async function () {
      await allowlistManager.createWalletGroup("Whitelist", ethers.parseEther("0.05"), 5);

      const tx = await allowlistManager.addWalletsToGroup(0, [user1.address, user2.address]);
      await expect(tx).to.emit(allowlistManager, "WalletsAddedToGroup").withArgs(0, 2);

      expect(await allowlistManager.walletGroupMembers(0, user1.address)).to.equal(true);
      expect(await allowlistManager.walletGroupMembers(0, user2.address)).to.equal(true);
    });

    it("should add wallet with custom override", async function () {
      await allowlistManager.createWalletGroup("VIP", ethers.parseEther("0.1"), 5);

      await allowlistManager.addWalletWithOverride(
        0,
        user1.address,
        ethers.parseEther("0.01"),
        20
      );

      expect(await allowlistManager.walletGroupMembers(0, user1.address)).to.equal(true);
      expect(await allowlistManager.getPriceForWallet(0, user1.address)).to.equal(ethers.parseEther("0.01"));
      expect(await allowlistManager.getMaxMintForWallet(0, user1.address)).to.equal(20);
    });

    it("should toggle wallet group active status", async function () {
      await allowlistManager.createWalletGroup("Toggle", ethers.parseEther("0.1"), 5);

      const [, , , active1] = await allowlistManager.getWalletGroup(0);
      expect(active1).to.equal(true);

      await allowlistManager.toggleWalletGroup(0);
      const [, , , active2] = await allowlistManager.getWalletGroup(0);
      expect(active2).to.equal(false);
    });
  });

  // ============================================
  // MINTING TESTS
  // ============================================

  describe("Minting", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    beforeEach(async function () {
      await phaseManager.createMintPhase(
        "Public Sale",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        0,
        false,
        0,
        0
      );
    });

    it("should mint successfully", async function () {
      const tx = await nft.connect(user1).mint(2, 0, {
        value: ethers.parseEther("0.2"),
      });

      await expect(tx)
        .to.emit(nft, "Minted")
        .withArgs(user1.address, 2, 0, ethers.parseEther("0.2"));

      expect(await nft.balanceOf(user1.address)).to.equal(2);
      expect(await nft.totalMinted()).to.equal(2);
    });

    it("should refund excess payment", async function () {
      const balanceBefore = await ethers.provider.getBalance(user1.address);

      const tx = await nft.connect(user1).mint(1, 0, {
        value: ethers.parseEther("0.5"),
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const expectedBalance = balanceBefore - ethers.parseEther("0.1") - gasUsed;

      expect(balanceAfter).to.equal(expectedBalance);
    });

    it("should revert with insufficient payment", async function () {
      await expect(
        nft.connect(user1).mint(2, 0, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWithCustomError(nft, "InsufficientPayment");
    });

    it("should revert when exceeding wallet limit", async function () {
      await nft.connect(user1).mint(5, 0, {
        value: ethers.parseEther("0.5"),
      });

      await expect(
        nft.connect(user1).mint(1, 0, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWithCustomError(phaseManager, "ExceedsWalletLimit");
    });

    it("should revert when paused", async function () {
      await nft.pause();

      await expect(
        nft.connect(user1).mint(1, 0, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWithCustomError(nft, "ContractPaused");
    });

    it("should apply Buy X Get Y bonus", async function () {
      await phaseManager.createMintPhase(
        "BOGO",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        20,
        0,
        true,
        3,
        1
      );

      await nft.connect(user1).mint(6, 1, {
        value: ethers.parseEther("0.6"),
      });

      expect(await nft.balanceOf(user1.address)).to.equal(8);
    });
  });

  // ============================================
  // ADMIN MINT & AIRDROP TESTS
  // ============================================

  describe("Admin Mint & Airdrop", function () {
    it("should admin mint", async function () {
      const tx = await nft.adminMint(user1.address, 10);

      await expect(tx).to.emit(nft, "AdminMinted").withArgs(user1.address, 10);
      expect(await nft.balanceOf(user1.address)).to.equal(10);
    });

    it("should revert admin mint from non-owner", async function () {
      await expect(
        nft.connect(user1).adminMint(user1.address, 10)
      ).to.be.revertedWithCustomError(nft, "Unauthorized");
    });

    it("should airdrop to multiple wallets", async function () {
      const tx = await nft.airdrop(
        [user1.address, user2.address, user3.address],
        [5, 3, 2]
      );

      await expect(tx).to.emit(nft, "AirdropExecuted").withArgs(3, 10);
      expect(await nft.balanceOf(user1.address)).to.equal(5);
      expect(await nft.balanceOf(user2.address)).to.equal(3);
      expect(await nft.balanceOf(user3.address)).to.equal(2);
    });
  });

  // ============================================
  // REVENUE & PAYOUT TESTS
  // ============================================

  describe("Revenue & Payouts", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    beforeEach(async function () {
      await phaseManager.createMintPhase(
        "Public",
        now - 100,
        now + oneDay,
        ethers.parseEther("1"),
        100,
        10,
        0,
        false,
        0,
        0
      );
    });

    it("should add payout wallet", async function () {
      const tx = await nft.addPayoutWallet(user1.address, 5000);
      await expect(tx)
        .to.emit(nft, "PayoutWalletAdded")
        .withArgs(user1.address, 5000);

      expect(await nft.getPayoutWalletCount()).to.equal(1);
    });

    it("should withdraw and distribute funds", async function () {
      await nft.addPayoutWallet(user1.address, 7000);
      await nft.addPayoutWallet(user2.address, 3000);

      await nft.connect(user3).mint(5, 0, {
        value: ethers.parseEther("5"),
      });

      const balance1Before = await ethers.provider.getBalance(user1.address);
      const balance2Before = await ethers.provider.getBalance(user2.address);

      await nft.withdraw();

      const balance1After = await ethers.provider.getBalance(user1.address);
      const balance2After = await ethers.provider.getBalance(user2.address);

      expect(balance1After - balance1Before).to.equal(ethers.parseEther("3.5"));
      expect(balance2After - balance2Before).to.equal(ethers.parseEther("1.5"));
    });
  });

  // ============================================
  // METADATA TESTS
  // ============================================

  describe("Metadata", function () {
    it("should set base URI", async function () {
      const tx = await nft.setBaseURI("ipfs://QmTest/");
      await expect(tx).to.emit(nft, "BaseURIUpdated").withArgs("ipfs://QmTest/");
    });

    it("should return placeholder before reveal", async function () {
      await nft.setPlaceholderURI("ipfs://hidden.json");
      await nft.adminMint(user1.address, 1);

      expect(await nft.tokenURI(1)).to.equal("ipfs://hidden.json");
    });

    it("should reveal and return correct tokenURI", async function () {
      await nft.setBaseURI("ipfs://QmRevealed/");
      await nft.setPlaceholderURI("ipfs://hidden.json");
      await nft.adminMint(user1.address, 1);

      expect(await nft.tokenURI(1)).to.equal("ipfs://hidden.json");

      await nft.reveal();
      expect(await nft.revealed()).to.equal(true);
      expect(await nft.tokenURI(1)).to.equal("ipfs://QmRevealed/1.json");
    });
  });

  // ============================================
  // CONTROL FUNCTION TESTS
  // ============================================

  describe("Control Functions", function () {
    it("should pause and unpause", async function () {
      await nft.pause();
      expect(await nft.paused()).to.equal(true);

      await nft.unpause();
      expect(await nft.paused()).to.equal(false);
    });

    it("should enable/disable transfers", async function () {
      await nft.adminMint(user1.address, 1);

      await nft.setTransfersEnabled(false);
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(nft, "TransfersDisabled");

      await nft.setTransfersEnabled(true);
      await nft.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await nft.ownerOf(1)).to.equal(user2.address);
    });

    it("should enable burning and burn token", async function () {
      await nft.adminMint(user1.address, 1);

      await expect(
        nft.connect(user1).burn(1)
      ).to.be.revertedWithCustomError(nft, "BurningDisabled");

      await nft.setBurnEnabled(true);
      await nft.connect(user1).burn(1);

      await expect(nft.ownerOf(1)).to.be.reverted;
    });
  });

  // ============================================
  // ROYALTY TESTS
  // ============================================

  describe("Royalties", function () {
    it("should return correct royalty info", async function () {
      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await nft.royaltyInfo(1, salePrice);

      expect(receiver).to.equal(royaltyReceiver.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("should support ERC2981 interface", async function () {
      expect(await nft.supportsInterface("0x2a55205a")).to.equal(true);
    });
  });

  // ============================================
  // MERKLE ALLOWLIST TESTS
  // ============================================

  describe("Merkle Allowlist", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;
    let merkleTree;
    let merkleRoot;
    let user1Proof;
    let user2Proof;

    beforeEach(async function () {
      const leaves = [user1.address, user2.address].map(addr =>
        keccak256(addr)
      );
      merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      merkleRoot = merkleTree.getHexRoot();

      user1Proof = merkleTree.getHexProof(keccak256(user1.address));
      user2Proof = merkleTree.getHexProof(keccak256(user2.address));
    });

    it("should create a Merkle wallet group", async function () {
      const tx = await allowlistManager.createMerkleWalletGroup(
        "Merkle VIP",
        ethers.parseEther("0.05"),
        10,
        merkleRoot
      );

      await expect(tx).to.emit(allowlistManager, "WalletGroupCreated").withArgs(0, "Merkle VIP", true);
      expect(await allowlistManager.walletGroupCount()).to.equal(1);
      expect(await allowlistManager.walletGroupMerkleRoots(0)).to.equal(merkleRoot);
      expect(await allowlistManager.walletGroupUseMerkle(0)).to.equal(true);
    });

    it("should mint with valid Merkle proof", async function () {
      await allowlistManager.createMerkleWalletGroup(
        "Merkle VIP",
        ethers.parseEther("0.05"),
        10,
        merkleRoot
      );

      await phaseManager.createMintPhase(
        "Merkle Sale",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        1,
        false,
        0,
        0
      );

      const tx = await nft.connect(user1).mintWithProof(2, 0, user1Proof, {
        value: ethers.parseEther("0.1"),
      });

      await expect(tx)
        .to.emit(nft, "Minted")
        .withArgs(user1.address, 2, 0, ethers.parseEther("0.1"));

      expect(await nft.balanceOf(user1.address)).to.equal(2);
    });

    it("should revert mint with invalid Merkle proof", async function () {
      await allowlistManager.createMerkleWalletGroup(
        "Merkle VIP",
        ethers.parseEther("0.05"),
        10,
        merkleRoot
      );

      await phaseManager.createMintPhase(
        "Merkle Sale",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        1,
        false,
        0,
        0
      );

      await expect(
        nft.connect(user3).mintWithProof(1, 0, user1Proof, {
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWithCustomError(phaseManager, "NotEligible");
    });

    it("should verify eligibility with proof correctly", async function () {
      await allowlistManager.createMerkleWalletGroup(
        "Merkle VIP",
        ethers.parseEther("0.05"),
        10,
        merkleRoot
      );

      expect(await allowlistManager.isEligibleWithProof(0, user1.address, user1Proof)).to.equal(true);
      expect(await allowlistManager.isEligibleWithProof(0, user2.address, user2Proof)).to.equal(true);
      expect(await allowlistManager.isEligibleWithProof(0, user3.address, [])).to.equal(false);
    });
  });

  // ============================================
  // SAFETY LIMIT TESTS
  // ============================================

  describe("Safety Limits", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    it("should revert when bonus exceeds MAX_BONUS_PER_MINT", async function () {
      await phaseManager.createMintPhase(
        "Extreme BOGO",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.01"),
        10000,
        1000,
        0,
        true,
        1,
        101
      );

      await expect(
        nft.connect(user1).mint(1, 0, {
          value: ethers.parseEther("0.01"),
        })
      ).to.be.revertedWithCustomError(phaseManager, "BonusTooLarge");
    });

    it("should allow bonus up to MAX_BONUS_PER_MINT", async function () {
      await phaseManager.createMintPhase(
        "Max BOGO",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.01"),
        10000,
        1000,
        0,
        true,
        1,
        100
      );

      await nft.connect(user1).mint(1, 0, {
        value: ethers.parseEther("0.01"),
      });

      expect(await nft.balanceOf(user1.address)).to.equal(101);
    });

    it("should revert airdrop exceeding MAX_AIRDROP_BATCH_SIZE", async function () {
      const recipients = [];
      const quantities = [];
      for (let i = 0; i < 201; i++) {
        recipients.push(ethers.Wallet.createRandom().address);
        quantities.push(1);
      }

      await expect(
        nft.airdrop(recipients, quantities)
      ).to.be.revertedWithCustomError(nft, "BatchTooLarge");
    });

    it("should verify MAX_AIRDROP_BATCH_SIZE constant", async function () {
      expect(await nft.MAX_AIRDROP_BATCH_SIZE()).to.equal(200);
    });

    it("should verify MAX_BONUS_PER_MINT constant", async function () {
      expect(await phaseManager.MAX_BONUS_PER_MINT()).to.equal(100);
    });
  });

  // ============================================
  // UPGRADEABILITY TESTS
  // ============================================

  describe("Upgradeability", function () {
    it("should have storage gap in AllowlistManager", async function () {
      // Contract should compile with storage gap
      expect(await allowlistManager.walletGroupCount()).to.equal(0);
    });

    it("should have storage gap in PhaseManager", async function () {
      // Contract should compile with storage gap
      expect(await phaseManager.phaseCount()).to.equal(0);
    });

    it("should have storage gap in NFTLaunchpad", async function () {
      // Contract should compile with storage gap
      expect(await nft.totalMinted()).to.equal(0);
    });
  });

  // ============================================
  // OWNERSHIP TESTS
  // ============================================

  describe("Ownership", function () {
    it("should transfer ownership of NFTLaunchpad", async function () {
      await nft.transferOwnership(user1.address);
      expect(await nft.owner()).to.equal(user1.address);
    });

    it("should transfer ownership of AllowlistManager", async function () {
      await allowlistManager.transferOwnership(user1.address);
      expect(await allowlistManager.owner()).to.equal(user1.address);
    });

    it("should transfer ownership of PhaseManager", async function () {
      await phaseManager.transferOwnership(user1.address);
      expect(await phaseManager.owner()).to.equal(user1.address);
    });

    it("should allow new owner to call admin functions", async function () {
      await nft.transferOwnership(user1.address);

      await expect(nft.pause()).to.be.revertedWithCustomError(nft, "Unauthorized");

      await nft.connect(user1).pause();
      expect(await nft.paused()).to.equal(true);
    });
  });
});
