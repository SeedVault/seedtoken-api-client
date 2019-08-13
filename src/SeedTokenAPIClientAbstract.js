
class SeedTokenClientAPIAbstract {
  
  constructor (rpcUrl) {     
  }
  /**
   * Creates an Ethereum account
   * 
   * @param {string} passphraseOrEntropy: Can be a passphrase to access the account or added entropy to generate the keys. Check implementation class.
   * @return {Promise<string>} The created address.
   */
  createAccount(credentialOrEntropy) {
    throw new Error('You must implement this method');
  }

  /**
   * Returns balance of a specified address
   * 
   * @param {string} address: Address to get balance from.
   * @return {Promise<string>}: Amount of tokens in the address.
   */
  getBalance(address) {
    throw new Error('You must implement this method');
  }

  /**
   * Transfers tokens from one account to another
   * 
   * @param {string} fromAddress: Source address.
   * @param {string} toAddress: Destination address.
   * @param {string} amount: Amount of tokens to be transfered. (NOTE this must be a string)
   * @param {string} credential: Credential to access the source account (passphrase or private key)
   * @return {Promise<string>}: Transaction hash.
   */
  transfer(fromAddress, toAddress, amount, credential) {
    throw new Error('You must implement this method');
  }

  /**
   * Transaction object returned by getLastNTransactions() function
   * 
   * @typedef {Object} Transaction
   * @property {string} from: Source address
   * @property {string} to: destionation address
   * @property {string} amount: Amount of token transfered
   * @property {string} timestamp: Timestamp of the block including the transaction
   */

  /**
   * Returns last n transactions of a specified address.
   * 
   * @param {string} address: Addres to filter 
   * @param {string} nTransactions: Quantity of transactions to return
   * @return {Promise<Transaction>} Array of Transaction object
   */
  
  getLastNTransactions(address, nTransactions) {
    throw new Error('You must implement this method');
  }
}

module.exports = SeedTokenClientAPIAbstract