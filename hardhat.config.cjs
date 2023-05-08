require('dotenv').config({ silent: true })
require("@nomiclabs/hardhat-ethers");
const FORKED_BLOCK_NUMBER = 17180261

real_accounts = undefined

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      chainId: 1,
      accounts: real_accounts,
    },
    hardhat: {
      saveDeployments: false,
      forking: {
        url: process.env.MAINNET_RPC_URL,
        blockNumber: FORKED_BLOCK_NUMBER,
      },
      chainId: 31337,
    },
  },
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  }
};
