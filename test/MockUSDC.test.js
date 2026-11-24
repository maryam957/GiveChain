const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const USDC = (amount) => ethers.parseUnits(amount, 6);

describe("MockUSDC", function () {
    async function deployFixture() {
        const [alice, bob] = await ethers.getSigners();
        const Token = await ethers.getContractFactory("MockUSDC");
        const token = await Token.deploy();
        await token.waitForDeployment();
        return { token, alice, bob };
    }

    it("has the expected name, symbol and 6 decimals", async function () {
        const { token } = await loadFixture(deployFixture);
        expect(await token.name()).to.equal("Mock USD Coin");
        expect(await token.symbol()).to.equal("mUSDC");
        expect(await token.decimals()).to.equal(6n);
    });

    it("starts with no supply", async function () {
        const { token } = await loadFixture(deployFixture);
        expect(await token.totalSupply()).to.equal(0n);
    });

    describe("Faucet", function () {
        it("mints tokens to the caller", async function () {
            const { token, alice } = await loadFixture(deployFixture);
            await expect(token.connect(alice).faucet(USDC("500")))
                .to.emit(token, "Transfer")
                .withArgs(ethers.ZeroAddress, alice.address, USDC("500"));
            expect(await token.balanceOf(alice.address)).to.equal(USDC("500"));
        });

        it("allows exactly the faucet limit", async function () {
            const { token, alice } = await loadFixture(deployFixture);
            await token.connect(alice).faucet(USDC("10000"));
            expect(await token.balanceOf(alice.address)).to.equal(USDC("10000"));
        });

        it("rejects one unit above the faucet limit", async function () {
            const { token, alice } = await loadFixture(deployFixture);
            const limit = await token.FAUCET_LIMIT();
            await expect(token.connect(alice).faucet(limit + 1n))
                .to.be.revertedWithCustomError(token, "InvalidFaucetAmount")
                .withArgs(limit + 1n, limit);
        });

        it("rejects a zero amount", async function () {
            const { token, alice } = await loadFixture(deployFixture);
            await expect(token.connect(alice).faucet(0))
                .to.be.revertedWithCustomError(token, "InvalidFaucetAmount");
        });

        it("only mints to the caller, never to someone else", async function () {
            const { token, alice, bob } = await loadFixture(deployFixture);
            await token.connect(alice).faucet(USDC("100"));
            expect(await token.balanceOf(bob.address)).to.equal(0n);
        });
    });

    describe("Standard ERC-20 behaviour", function () {
        it("supports approve and transferFrom", async function () {
            const { token, alice, bob } = await loadFixture(deployFixture);
            await token.connect(alice).faucet(USDC("100"));
            await token.connect(alice).approve(bob.address, USDC("40"));
            await token.connect(bob).transferFrom(alice.address, bob.address, USDC("40"));
            expect(await token.balanceOf(bob.address)).to.equal(USDC("40"));
            expect(await token.allowance(alice.address, bob.address)).to.equal(0n);
        });

        it("rejects transferFrom above the allowance", async function () {
            const { token, alice, bob } = await loadFixture(deployFixture);
            await token.connect(alice).faucet(USDC("100"));
            await token.connect(alice).approve(bob.address, USDC("10"));
            await expect(token.connect(bob).transferFrom(alice.address, bob.address, USDC("11")))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
        });
    });
});
