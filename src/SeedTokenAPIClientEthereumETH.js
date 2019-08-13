const SeedTokenAPIClientEthereumETHPersonal = require('./SeedTokenAPIClientEthereumETHPersonal.js')

/**
 * Handles native Ethereum ETH token handling private keys directly
 */
class SeedTokenAPIClientEthereumETH extends SeedTokenAPIClientEthereumETHPersonal {
  constructor (rpcURL) {  
    super();   
  }
  /**
   * Creates account
   */
  createAccount(entropy) {
    throw new Error('You must implement this method')
  }
  
  /**
   * Returns a resolved promise with transaction hash
   */
  transfer(fromAddress, toAddress, amountETH, privateKey) {    
    throw new Error('You must implement this method')
  }

}

module.exports = SeedTokenAPIClientEthereumETH
