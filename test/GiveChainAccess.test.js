const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("GiveChainAccess", function () {
    async function deployFixture() {
        const [admin, ngo, auditor, pauser, stranger] = await ethers.getSigners();
        const Access = await ethers.getContractFactory("GiveChainAccess");
        const access = await Access.deploy(admin.address);
        await access.waitForDeployment();

        const roles = {
            ADMIN: await access.DEFAULT_ADMIN_ROLE(),
            NGO: await access.NGO_ROLE(),
            AUDITOR: await access.AUDITOR_ROLE(),
            PAUSER: await access.PAUSER_ROLE(),
        };
        return { access, roles, admin, ngo, auditor, pauser, stranger };
    }

    describe("Deployment", function () {
        it("gives the deployer-chosen admin the admin and pauser roles", async function () {
            const { access, roles, admin } = await loadFixture(deployFixture);
            expect(await access.hasRole(roles.ADMIN, admin.address)).to.equal(true);
            expect(await access.hasRole(roles.PAUSER, admin.address)).to.equal(true);
        });

        it("does not give the admin the NGO or auditor role", async function () {
            const { access, roles, admin } = await loadFixture(deployFixture);
            expect(await access.hasRole(roles.NGO, admin.address)).to.equal(false);
            expect(await access.hasRole(roles.AUDITOR, admin.address)).to.equal(false);
        });

        it("exposes the expected role ids", async function () {
            const { roles } = await loadFixture(deployFixture);
            expect(roles.NGO).to.equal(ethers.id("NGO_ROLE"));
            expect(roles.AUDITOR).to.equal(ethers.id("AUDITOR_ROLE"));
            expect(roles.PAUSER).to.equal(ethers.id("PAUSER_ROLE"));
        });

        it("rejects the zero address as admin", async function () {
            const Access = await ethers.getContractFactory("GiveChainAccess");
            await expect(Access.deploy(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(Access, "ZeroAddress");
        });

        it("starts unpaused", async function () {
            const { access } = await loadFixture(deployFixture);
            expect(await access.paused()).to.equal(false);
        });
    });

    describe("Role management", function () {
        it("lets the admin grant and revoke roles", async function () {
            const { access, roles, ngo } = await loadFixture(deployFixture);
            await expect(access.grantRole(roles.NGO, ngo.address))
                .to.emit(access, "RoleGranted");
            expect(await access.hasRole(roles.NGO, ngo.address)).to.equal(true);

            await expect(access.revokeRole(roles.NGO, ngo.address))
                .to.emit(access, "RoleRevoked");
            expect(await access.hasRole(roles.NGO, ngo.address)).to.equal(false);
        });

        it("rejects role grants from a non-admin", async function () {
            const { access, roles, stranger } = await loadFixture(deployFixture);
            await expect(access.connect(stranger).grantRole(roles.NGO, stranger.address))
                .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount")
                .withArgs(stranger.address, roles.ADMIN);
        });

        it("does not let an NGO grant roles", async function () {
            const { access, roles, ngo, stranger } = await loadFixture(deployFixture);
            await access.grantRole(roles.NGO, ngo.address);
            await expect(access.connect(ngo).grantRole(roles.AUDITOR, stranger.address))
                .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Separation of duties", function () {
        it("blocks giving an auditor the NGO role", async function () {
            const { access, roles, auditor } = await loadFixture(deployFixture);
            await access.grantRole(roles.AUDITOR, auditor.address);
            await expect(access.grantRole(roles.NGO, auditor.address))
                .to.be.revertedWithCustomError(access, "ConflictingRole")
                .withArgs(auditor.address, roles.NGO);
        });

        it("blocks giving an NGO the auditor role", async function () {
            const { access, roles, ngo } = await loadFixture(deployFixture);
            await access.grantRole(roles.NGO, ngo.address);
            await expect(access.grantRole(roles.AUDITOR, ngo.address))
                .to.be.revertedWithCustomError(access, "ConflictingRole")
                .withArgs(ngo.address, roles.AUDITOR);
        });

        it("allows the switch after the old role is revoked", async function () {
            const { access, roles, ngo } = await loadFixture(deployFixture);
            await access.grantRole(roles.NGO, ngo.address);
            await access.revokeRole(roles.NGO, ngo.address);
            await access.grantRole(roles.AUDITOR, ngo.address);
            expect(await access.hasRole(roles.AUDITOR, ngo.address)).to.equal(true);
        });
    });

    describe("Emergency pause", function () {
        it("lets a pauser pause and unpause", async function () {
            const { access } = await loadFixture(deployFixture);
            await expect(access.pause()).to.emit(access, "Paused");
            expect(await access.paused()).to.equal(true);
            await expect(access.unpause()).to.emit(access, "Unpaused");
            expect(await access.paused()).to.equal(false);
        });

        it("lets a separately granted pauser pause", async function () {
            const { access, roles, pauser } = await loadFixture(deployFixture);
            await access.grantRole(roles.PAUSER, pauser.address);
            await access.connect(pauser).pause();
            expect(await access.paused()).to.equal(true);
        });

        it("rejects pause from an account without the pauser role", async function () {
            const { access, roles, stranger } = await loadFixture(deployFixture);
            await expect(access.connect(stranger).pause())
                .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount")
                .withArgs(stranger.address, roles.PAUSER);
        });

        it("rejects unpause from an account without the pauser role", async function () {
            const { access, stranger } = await loadFixture(deployFixture);
            await access.pause();
            await expect(access.connect(stranger).unpause())
                .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount");
        });

        it("rejects pausing twice and unpausing when not paused", async function () {
            const { access } = await loadFixture(deployFixture);
            await expect(access.unpause())
                .to.be.revertedWithCustomError(access, "ExpectedPause");
            await access.pause();
            await expect(access.pause())
                .to.be.revertedWithCustomError(access, "EnforcedPause");
        });
    });
});
