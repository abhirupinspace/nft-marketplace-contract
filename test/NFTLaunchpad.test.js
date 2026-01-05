const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("NFTLaunchpad", function () {
  let NFTLaunchpad;
  let nft;
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

    NFTLaunchpad = await ethers.getContractFactory("NFTLaunchpad");
    nft = await upgrades.deployProxy(
      NFTLaunchpad,
      [NAME, SYMBOL, MAX_SUPPLY, royaltyReceiver.address, ROYALTY_BPS],
      { initializer: "initialize", kind: "transparent" }
    );
    await nft.waitForDeployment();
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

    it("should revert with zero max supply", async function () {
      const NewNFT = await ethers.getContractFactory("NFTLaunchpad");
      await expect(
        upgrades.deployProxy(
          NewNFT,
          [NAME, SYMBOL, 0, royaltyReceiver.address, ROYALTY_BPS],
          { initializer: "initialize", kind: "transparent" }
        )
      ).to.be.revertedWithCustomError(NewNFT, "InvalidInput");
    });

    it("should revert with zero royalty receiver", async function () {
      const NewNFT = await ethers.getContractFactory("NFTLaunchpad");
      await expect(
        upgrades.deployProxy(
          NewNFT,
          [NAME, SYMBOL, MAX_SUPPLY, ethers.ZeroAddress, ROYALTY_BPS],
          { initializer: "initialize", kind: "transparent" }
        )
      ).to.be.revertedWithCustomError(NewNFT, "InvalidAddress");
    });

    it("should revert with royalty > 10%", async function () {
      const NewNFT = await ethers.getContractFactory("NFTLaunchpad");
      await expect(
        upgrades.deployProxy(
          NewNFT,
          [NAME, SYMBOL, MAX_SUPPLY, royaltyReceiver.address, 1001],
          { initializer: "initialize", kind: "transparent" }
        )
      ).to.be.revertedWithCustomError(NewNFT, "InvalidInput");
    });
  });

  // ============================================
  // PHASE MANAGEMENT TESTS
  // ============================================

  describe("Phase Management", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneHour = 3600;
    const oneDay = 86400;

    it("should create a public mint phase", async function () {
      const tx = await nft.createMintPhase(
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

      await expect(tx).to.emit(nft, "PhaseCreated").withArgs(0, "Public Sale");
      expect(await nft.phaseCount()).to.equal(1);
    });

    it("should create a phase with Buy X Get Y", async function () {
      await nft.createMintPhase(
        "BOGO Sale",
        now,
        now + oneDay,
        ethers.parseEther("0.1"),
        1000,
        10,
        0,
        true, // buyXGetY enabled
        3, // buy 3
        1  // get 1 free
      );

      const phase = await nft.mintPhases(0);
      expect(phase.buyXGetY).to.equal(true);
      expect(phase.buyAmount).to.equal(3);
      expect(phase.getAmount).to.equal(1);
    });

    it("should revert if start time >= end time", async function () {
      await expect(
        nft.createMintPhase(
          "Bad Phase",
          now + oneDay,
          now,
          ethers.parseEther("0.1"),
          1000,
          5,
          0,
          false,
          0,
          0
        )
      ).to.be.revertedWithCustomError(nft, "InvalidInput");
    });

    it("should revert if end time is in the past", async function () {
      await expect(
        nft.createMintPhase(
          "Past Phase",
          now - oneDay * 2,
          now - oneDay,
          ethers.parseEther("0.1"),
          1000,
          5,
          0,
          false,
          0,
          0
        )
      ).to.be.revertedWithCustomError(nft, "InvalidInput");
    });

    it("should revert if phase max supply is zero", async function () {
      await expect(
        nft.createMintPhase(
          "Zero Supply",
          now,
          now + oneDay,
          ethers.parseEther("0.1"),
          0,
          5,
          0,
          false,
          0,
          0
        )
      ).to.be.revertedWithCustomError(nft, "InvalidInput");
    });

    it("should update an existing phase", async function () {
      await nft.createMintPhase(
        "Original",
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

      const tx = await nft.updateMintPhase(
        0,
        "Updated",
        now,
        now + oneDay * 2,
        ethers.parseEther("0.2"),
        2000,
        10
      );

      await expect(tx).to.emit(nft, "PhaseUpdated").withArgs(0);

      const phase = await nft.mintPhases(0);
      expect(phase.name).to.equal("Updated");
      expect(phase.price).to.equal(ethers.parseEther("0.2"));
      expect(phase.maxSupply).to.equal(2000);
    });

    it("should toggle phase active status", async function () {
      await nft.createMintPhase(
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

      let phase = await nft.mintPhases(0);
      expect(phase.active).to.equal(true);

      await nft.togglePhase(0);
      phase = await nft.mintPhases(0);
      expect(phase.active).to.equal(false);

      await nft.togglePhase(0);
      phase = await nft.mintPhases(0);
      expect(phase.active).to.equal(true);
    });

    it("should only allow owner to manage phases", async function () {
      await expect(
        nft.connect(user1).createMintPhase(
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
      ).to.be.revertedWithCustomError(nft, "Unauthorized");
    });
  });

  // ============================================
  // WALLET GROUP TESTS
  // ============================================

  describe("Wallet Groups", function () {
    it("should create a wallet group", async function () {
      const tx = await nft.createWalletGroup(
        "VIP",
        ethers.parseEther("0.05"),
        10
      );

      await expect(tx).to.emit(nft, "WalletGroupCreated").withArgs(0, "VIP");
      expect(await nft.walletGroupCount()).to.equal(1);
    });

    it("should add wallets to a group", async function () {
      await nft.createWalletGroup("Whitelist", ethers.parseEther("0.05"), 5);

      const tx = await nft.addWalletsToGroup(0, [user1.address, user2.address]);
      await expect(tx).to.emit(nft, "WalletsAddedToGroup").withArgs(0, 2);

      expect(await nft.walletGroupMembers(0, user1.address)).to.equal(true);
      expect(await nft.walletGroupMembers(0, user2.address)).to.equal(true);
      expect(await nft.walletGroupMembers(0, user3.address)).to.equal(false);
    });

    it("should add wallet with custom override", async function () {
      await nft.createWalletGroup("VIP", ethers.parseEther("0.1"), 5);

      await nft.addWalletWithOverride(
        0,
        user1.address,
        ethers.parseEther("0.01"), // custom price
        20 // custom max mint
      );

      expect(await nft.walletGroupMembers(0, user1.address)).to.equal(true);
      const override = await nft.walletOverrides(0, user1.address);
      expect(override.customPrice).to.equal(ethers.parseEther("0.01"));
      expect(override.customMaxMint).to.equal(20);
      expect(override.hasOverride).to.equal(true);
    });

    it("should remove wallet from group", async function () {
      await nft.createWalletGroup("Test", ethers.parseEther("0.1"), 5);
      await nft.addWalletsToGroup(0, [user1.address]);

      expect(await nft.walletGroupMembers(0, user1.address)).to.equal(true);

      await nft.removeWalletFromGroup(0, user1.address);
      expect(await nft.walletGroupMembers(0, user1.address)).to.equal(false);
    });

    it("should toggle wallet group active status", async function () {
      await nft.createWalletGroup("Toggle", ethers.parseEther("0.1"), 5);

      let group = await nft.walletGroups(0);
      expect(group.active).to.equal(true);

      await nft.toggleWalletGroup(0);
      group = await nft.walletGroups(0);
      expect(group.active).to.equal(false);
    });

    it("should bulk update wallets", async function () {
      await nft.createWalletGroup("Bulk", ethers.parseEther("0.1"), 5);

      await nft.bulkUpdateWallets(
        0,
        [user1.address, user2.address],
        [ethers.parseEther("0.01"), ethers.parseEther("0.02")],
        [10, 15]
      );

      const override1 = await nft.walletOverrides(0, user1.address);
      expect(override1.customPrice).to.equal(ethers.parseEther("0.01"));
      expect(override1.customMaxMint).to.equal(10);

      const override2 = await nft.walletOverrides(0, user2.address);
      expect(override2.customPrice).to.equal(ethers.parseEther("0.02"));
      expect(override2.customMaxMint).to.equal(15);
    });
  });

  // ============================================
  // MINTING TESTS
  // ============================================

  describe("Minting", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    beforeEach(async function () {
      // Create a public phase
      await nft.createMintPhase(
        "Public Sale",
        now - 100, // started
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        0, // public
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
        value: ethers.parseEther("0.5"), // overpay
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
          value: ethers.parseEther("0.1"), // need 0.2
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
      ).to.be.revertedWithCustomError(nft, "ExceedsWalletLimit");
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
      // Create a BOGO phase: buy 3 get 1
      await nft.createMintPhase(
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

      // Buy 6, should get 2 free (total 8)
      await nft.connect(user1).mint(6, 1, {
        value: ethers.parseEther("0.6"), // only pay for 6
      });

      expect(await nft.balanceOf(user1.address)).to.equal(8);
    });

    it("should track phase mints correctly", async function () {
      await nft.connect(user1).mint(3, 0, {
        value: ethers.parseEther("0.3"),
      });

      const phase = await nft.mintPhases(0);
      expect(phase.minted).to.equal(3);
      expect(await nft.phaseMints(0, user1.address)).to.equal(3);
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

    it("should airdrop to wallet group", async function () {
      await nft.createWalletGroup("Airdrop", 0, 10);
      await nft.addWalletsToGroup(0, [user1.address, user2.address]);

      await nft.airdropToGroup(0, [user1.address, user2.address], 5);

      expect(await nft.balanceOf(user1.address)).to.equal(5);
      expect(await nft.balanceOf(user2.address)).to.equal(5);
    });

    it("should revert airdrop to non-group member", async function () {
      await nft.createWalletGroup("Airdrop", 0, 10);
      await nft.addWalletsToGroup(0, [user1.address]);

      await expect(
        nft.airdropToGroup(0, [user1.address, user2.address], 5)
      ).to.be.revertedWithCustomError(nft, "NotEligible");
    });
  });

  // ============================================
  // REVENUE & PAYOUT TESTS
  // ============================================

  describe("Revenue & Payouts", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    beforeEach(async function () {
      await nft.createMintPhase(
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

    it("should revert if shares exceed 100%", async function () {
      await nft.addPayoutWallet(user1.address, 6000);

      await expect(
        nft.addPayoutWallet(user2.address, 5000)
      ).to.be.revertedWithCustomError(nft, "InvalidShares");
    });

    it("should update payout wallet", async function () {
      await nft.addPayoutWallet(user1.address, 5000);
      await nft.updatePayoutWallet(0, user2.address, 7000);

      const wallet = await nft.payoutWallets(0);
      expect(wallet.wallet).to.equal(user2.address);
      expect(wallet.sharePercentage).to.equal(7000);
    });

    it("should remove payout wallet", async function () {
      await nft.addPayoutWallet(user1.address, 5000);
      await nft.addPayoutWallet(user2.address, 5000);

      await nft.removePayoutWallet(0);
      expect(await nft.getPayoutWalletCount()).to.equal(1);
    });

    it("should withdraw and distribute funds", async function () {
      // Setup payout wallets (100% total)
      await nft.addPayoutWallet(user1.address, 7000); // 70%
      await nft.addPayoutWallet(user2.address, 3000); // 30%

      // Generate revenue
      await nft.connect(user3).mint(5, 0, {
        value: ethers.parseEther("5"),
      });

      const balance1Before = await ethers.provider.getBalance(user1.address);
      const balance2Before = await ethers.provider.getBalance(user2.address);

      await nft.withdraw();

      const balance1After = await ethers.provider.getBalance(user1.address);
      const balance2After = await ethers.provider.getBalance(user2.address);

      expect(balance1After - balance1Before).to.equal(ethers.parseEther("3.5")); // 70%
      expect(balance2After - balance2Before).to.equal(ethers.parseEther("1.5")); // 30%
    });

    it("should revert withdraw if shares != 100%", async function () {
      await nft.addPayoutWallet(user1.address, 5000); // only 50%

      await nft.connect(user3).mint(1, 0, {
        value: ethers.parseEther("1"),
      });

      await expect(nft.withdraw()).to.be.revertedWithCustomError(
        nft,
        "InvalidShares"
      );
    });

    it("should revert withdraw if no funds", async function () {
      await nft.addPayoutWallet(user1.address, 10000);

      await expect(nft.withdraw()).to.be.revertedWithCustomError(
        nft,
        "NoFunds"
      );
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

    it("should set placeholder URI", async function () {
      const tx = await nft.setPlaceholderURI("ipfs://QmPlaceholder");
      await expect(tx)
        .to.emit(nft, "PlaceholderURIUpdated")
        .withArgs("ipfs://QmPlaceholder");
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

    it("should revert reveal without base URI", async function () {
      await expect(nft.reveal()).to.be.revertedWithCustomError(
        nft,
        "InvalidInput"
      );
    });

    it("should revert double reveal", async function () {
      await nft.setBaseURI("ipfs://QmTest/");
      await nft.reveal();

      await expect(nft.reveal()).to.be.revertedWithCustomError(
        nft,
        "AlreadyRevealed"
      );
    });

    it("should lock metadata", async function () {
      await nft.setBaseURI("ipfs://QmTest/");
      await nft.reveal();
      await nft.lockMetadata();

      expect(await nft.metadataLocked()).to.equal(true);
    });

    it("should revert URI changes after lock", async function () {
      await nft.setBaseURI("ipfs://QmTest/");
      await nft.reveal();
      await nft.lockMetadata();

      await expect(
        nft.setBaseURI("ipfs://QmNew/")
      ).to.be.revertedWithCustomError(nft, "MetadataIsLocked");

      await expect(
        nft.setPlaceholderURI("ipfs://new")
      ).to.be.revertedWithCustomError(nft, "MetadataIsLocked");
    });
  });

  // ============================================
  // SUPPLY MANAGEMENT TESTS
  // ============================================

  describe("Supply Management", function () {
    it("should increase max supply", async function () {
      await nft.increaseMaxSupply(15000);
      expect(await nft.maxSupply()).to.equal(15000);
    });

    it("should decrease max supply", async function () {
      await nft.decreaseMaxSupply(5000);
      expect(await nft.maxSupply()).to.equal(5000);
    });

    it("should revert decrease below minted", async function () {
      await nft.adminMint(user1.address, 100);

      await expect(nft.decreaseMaxSupply(50)).to.be.revertedWithCustomError(
        nft,
        "InvalidInput"
      );
    });

    it("should revert increase to same or lower", async function () {
      await expect(nft.increaseMaxSupply(10000)).to.be.revertedWithCustomError(
        nft,
        "InvalidInput"
      );

      await expect(nft.increaseMaxSupply(5000)).to.be.revertedWithCustomError(
        nft,
        "InvalidInput"
      );
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

    it("should only allow token owner to burn", async function () {
      await nft.adminMint(user1.address, 1);
      await nft.setBurnEnabled(true);

      await expect(
        nft.connect(user2).burn(1)
      ).to.be.revertedWithCustomError(nft, "Unauthorized");
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
      expect(amount).to.equal(ethers.parseEther("0.05")); // 5%
    });

    it("should update royalty info", async function () {
      await nft.setRoyaltyInfo(user1.address, 1000); // 10%

      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await nft.royaltyInfo(1, salePrice);

      expect(receiver).to.equal(user1.address);
      expect(amount).to.equal(ethers.parseEther("0.1")); // 10%
    });

    it("should revert royalty > 10%", async function () {
      await expect(
        nft.setRoyaltyInfo(user1.address, 1001)
      ).to.be.revertedWithCustomError(nft, "InvalidInput");
    });

    it("should support ERC2981 interface", async function () {
      expect(await nft.supportsInterface("0x2a55205a")).to.equal(true);
    });
  });

  // ============================================
  // OWNERSHIP TESTS
  // ============================================

  describe("Ownership", function () {
    it("should transfer ownership", async function () {
      await nft.transferOwnership(user1.address);
      expect(await nft.owner()).to.equal(user1.address);
    });

    it("should emit OwnershipTransferred event", async function () {
      await expect(nft.transferOwnership(user1.address))
        .to.emit(nft, "OwnershipTransferred")
        .withArgs(owner.address, user1.address);
    });

    it("should revert transfer to zero address", async function () {
      await expect(
        nft.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(nft, "InvalidAddress");
    });

    it("should allow new owner to call admin functions", async function () {
      await nft.transferOwnership(user1.address);

      await expect(nft.pause()).to.be.revertedWithCustomError(
        nft,
        "Unauthorized"
      );

      await nft.connect(user1).pause();
      expect(await nft.paused()).to.equal(true);
    });
  });

  // ============================================
  // HELPER FUNCTION TESTS
  // ============================================

  describe("Helper Functions", function () {
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 86400;

    beforeEach(async function () {
      // Create wallet group
      await nft.createWalletGroup("VIP", ethers.parseEther("0.05"), 10);
      await nft.addWalletsToGroup(0, [user1.address]);

      // Create phase for wallet group
      await nft.createMintPhase(
        "VIP Sale",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        1, // wallet group 1 (index 0 + 1)
        false,
        0,
        0
      );
    });

    it("should check eligibility correctly", async function () {
      // Need to create group first for this test
      await nft.createWalletGroup("Test", ethers.parseEther("0.05"), 10);
      await nft.addWalletsToGroup(1, [user1.address]);

      await nft.createMintPhase(
        "Group Sale",
        now - 100,
        now + oneDay,
        ethers.parseEther("0.1"),
        100,
        5,
        2, // wallet group 2
        false,
        0,
        0
      );

      expect(await nft.isEligibleForPhase(user1.address, 1)).to.equal(true);
      expect(await nft.isEligibleForPhase(user2.address, 1)).to.equal(false);
    });

    it("should return correct price for wallet", async function () {
      // Add override for user2
      await nft.addWalletWithOverride(
        0,
        user2.address,
        ethers.parseEther("0.01"),
        5
      );

      // user1 gets group default price
      expect(await nft.getPriceForWallet(user1.address, 0)).to.equal(
        ethers.parseEther("0.05")
      );

      // user2 gets override price
      expect(await nft.getPriceForWallet(user2.address, 0)).to.equal(
        ethers.parseEther("0.01")
      );
    });

    it("should check phase active status", async function () {
      expect(await nft.isPhaseActive(0)).to.equal(true);

      await nft.togglePhase(0);
      expect(await nft.isPhaseActive(0)).to.equal(false);
    });

    it("should return remaining mints for wallet", async function () {
      // Create public phase
      await nft.createMintPhase(
        "Public",
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

      expect(await nft.getRemainingMintsForWallet(user1.address, 1)).to.equal(5);

      await nft.connect(user1).mint(3, 1, {
        value: ethers.parseEther("0.3"),
      });

      expect(await nft.getRemainingMintsForWallet(user1.address, 1)).to.equal(2);
    });
  });
});
