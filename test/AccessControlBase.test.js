const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// AccessControlBase is abstract, so these tests use AccessControlBaseHarness,
// a test-only contract that applies each modifier to a simple counter.
describe("AccessControlBase", function () {
    async function deployFixture() {
        const [admin, ngo, auditor, stranger] = await ethers.getSigners();

        const Access = await ethers.getContractFactory("GiveChainAccess");
        const access = await Access.deploy(admin.address);
        await access.waitForDeployment();

        const Harness = await ethers.getContractFactory("AccessControlBaseHarness");
        const harness = await Harness.deploy(await access.getAddress());
        await harness.waitForDeployment();

        await access.grantRole(await access.NGO_ROLE(), ngo.address);
        await access.grantRole(await access.AUDITOR_ROLE(), auditor.address);

        return { access, harness, admin, ngo, auditor, stranger };
    }

    it("stores the access contract address", async function () {
        const { access, harness } = await loadFixture(deployFixture);
        expect(await harness.access()).to.equal(await access.getAddress());
    });

    it("rejects the zero address as access contract", async function () {
        const Harness = await ethers.getContractFactory("AccessControlBaseHarness");
        await expect(Harness.deploy(ethers.ZeroAddress))
            .to.be.revertedWithCustomError(Harness, "ZeroAddress");
    });

    describe("onlyRole", function () {
        it("allows an account that holds the role", async function () {
            const { harness, ngo } = await loadFixture(deployFixture);
            await harness.connect(ngo).ngoOnly();
            expect(await harness.counter()).to.equal(1n);
        });

        it("rejects an account without the role", async function () {
            const { access, harness, stranger } = await loadFixture(deployFixture);
            await expect(harness.connect(stranger).ngoOnly())
                .to.be.revertedWithCustomError(harness, "MissingRole")
                .withArgs(stranger.address, await access.NGO_ROLE());
        });

        it("rejects an account that holds a different role", async function () {
            const { harness, ngo } = await loadFixture(deployFixture);
            await expect(harness.connect(ngo).auditorOnly())
                .to.be.revertedWithCustomError(harness, "MissingRole");
        });

        it("does not treat the admin as having every role", async function () {
            const { harness, admin } = await loadFixture(deployFixture);
            await expect(harness.connect(admin).ngoOnly())
                .to.be.revertedWithCustomError(harness, "MissingRole");
        });

        it("follows role changes made in GiveChainAccess immediately", async function () {
            const { access, harness, ngo } = await loadFixture(deployFixture);
            await access.revokeRole(await access.NGO_ROLE(), ngo.address);
            await expect(harness.connect(ngo).ngoOnly())
                .to.be.revertedWithCustomError(harness, "MissingRole");
        });
    });

    describe("whenNotPaused", function () {
        it("allows the call while the system is running", async function () {
            const { harness, stranger } = await loadFixture(deployFixture);
            await harness.connect(stranger).pausable();
            expect(await harness.counter()).to.equal(1n);
        });

        it("blocks the call while the system is paused", async function () {
            const { access, harness, stranger } = await loadFixture(deployFixture);
            await access.pause();
            await expect(harness.connect(stranger).pausable())
                .to.be.revertedWithCustomError(harness, "SystemPaused");
        });

        it("allows the call again after unpausing", async function () {
            const { access, harness, stranger } = await loadFixture(deployFixture);
            await access.pause();
            await access.unpause();
            await harness.connect(stranger).pausable();
            expect(await harness.counter()).to.equal(1n);
        });
    });

    describe("nonReentrant", function () {
        it("blocks a guarded function from re-entering a guarded function", async function () {
            const { harness, stranger } = await loadFixture(deployFixture);
            await expect(harness.connect(stranger).guarded())
                .to.be.revertedWithCustomError(harness, "ReentrancyGuardReentrantCall");
            expect(await harness.counter()).to.equal(0n);
        });

        it("still allows a single guarded call", async function () {
            const { harness, stranger } = await loadFixture(deployFixture);
            await harness.connect(stranger).guardedInner();
            expect(await harness.counter()).to.equal(1n);
        });
    });
});
