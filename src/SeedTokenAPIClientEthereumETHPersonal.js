const SeedTokenAPIClientAbstract = require('./SeedTokenAPIClientAbstract.js')
const Web3 = require('web3')

/**
 * Handles native Ethereum ETH token using personal accounts with passphrase letting Parity Ethereum node to handle and store private keys
 */
class SeedTokenAPIClientEthereumETHPersonal extends SeedTokenAPIClientAbstract {
  constructor (rpcURL) {  
    super();

    this.rpcURL = rpcURL
    this.web3 = new Web3(new Web3.providers.HttpProvider(this.rpcURL))        

    this.bufferSize = 50 //how many blocks to read on each iteration
  }
  /**
   * Creates personal account in ethereum node
   * 
   * @param {string} passphrase: passphrase used by parity node to lock/unlock accounts
   */
  createAccount(passprase) {
    return new Promise((resolve, reject) => {
      this.web3.eth.personal.newAccount(passprase, (err, address) => {//nothing special to do here, leaving just in case
          if (address) { 
            resolve(address)
          }
          reject(err)  
        })
      });    
  }

  /**
   * Returns a resolved promise with balance of provided address in ETH
   * 
   * @param {string} address: Ethereum address
   */
  getBalance(address) {            
    return new Promise((resolve, reject) => {
      this.web3.eth.getBalance(address, (err, wei) => {           
        if (wei) {
          resolve(this.web3.utils.fromWei(wei, 'ether'))
        }
        reject(err)
      })
    })
  }

  /**
   * Does a transfer using password to unlock account on the ethereum node
   * Returns a promise with transaction hash
   * 
   * @param {string} fromAddress: Ethereum address with tokens to be sent
   * @param {string} toAddress: Ethereum address to receive tokens
   * @param {string} amounthETH: Ethereum token amount to be transfered. Note this should be a string!
   * @param {string} passphrase: Passphrase to unlock the account
   * @param {string} gasPrice: Gas price for the transaction. Default 0 for POA chain
   */
  transfer(fromAddress, toAddress, amountETH, passphrase, gasPrice) {    
    gasPrice = gasPrice || '0' //in POA should be 0
    this.web3.eth.personal.unlockAccount(fromAddress, passphrase)
    return new Promise((resolve, reject) => {
      this.web3.eth.sendTransaction(
        {
          from: fromAddress,
          to: toAddress, 
          value: this.web3.utils.toWei(amountETH, 'ether'),
          gas: 21000,//minimal gas
          gasPrice: gasPrice,          
        },
        (err, hash) => {//nothing special to do here, leaving just in case
          if (hash) { 
            resolve(hash)
          }
          reject(err)  
        })
      })
  }

  /**
   * Returns a promise with last n transactions of a specifiedd address. Ordered from new to old.
   * If any of those last n transactions are old, this will take some time 
   * @TODO try Parity trace module (seems is still slow) or any other kind of off-chain index solution
   * 
   * @param {string} address: Ethereum address to filter 
   * @param {int} nTransaction: Amount of transactions to return
   * @param {int} bufferSize: Amount of block to be fetch on each batch request
   */
  async getLastNTransactions(address, nTransactions, bufferSize) {    
    bufferSize = bufferSize || this.bufferSize
    let endBlockNumber = await this.web3.eth.getBlockNumber()    
    let startBlockNumber = endBlockNumber - bufferSize    
    let max = nTransactions
    let ts = []
    let blocks = []
    
    while (ts.length < nTransactions || startBlockNumber < 1) {//finish at block 1      
      blocks = await this._getBlocks(startBlockNumber, endBlockNumber, true)            
      ts = ts.concat(this._getTransactionsByAddressFromBlocks(blocks, address, max - ts.length))      

      startBlockNumber -= bufferSize + 1 //moves buffer pointer
      endBlockNumber -= bufferSize + 1
    }    

    let transactions = []
    ts.forEach((t) => {
      transactions.push({
        from: t.from,
        to: t.to,
        value: this.web3.utils.fromWei(t.value, 'ether'),
        timestamp: t.block.timestamp
      })
    })
    return transactions
  }


  /**
   * Returns a promise with specified block range. Ordered from new to old.
   * 
   * @param {string} startBlockNumber: Block range start
   * @param {string} endBlockNumber: Block range end
   * @param {bool} returnTransactions: Includes block transactions of True
   */
  _getBlocks(startBlockNumber, endBlockNumber, returnTransactions) {
    returnTransactions = returnTransactions || false
    return new Promise((resolve, reject) => {
      var total = endBlockNumber - startBlockNumber + 1
      let blocks = []
      let count = 0
      const batch = new this.web3.eth.BatchRequest()    
      for (var i = endBlockNumber; i >= startBlockNumber; i--) {      
        batch.add(
          this.web3.eth.getBlock.request(i, returnTransactions, (err, block) => {          
            if (err) {
              reject(err)
            }      
            blocks.push(block)                        
            count++ //using counter we are sure all requests finished in the batch
            if (count == total) {  
              resolve(blocks) //resolve promise when all blocks are fetched
            }
        
          })
        )
      }
      return batch.execute()

    }).then((blocks) => {
      blocks.sort((a, b) => (a.number > b.number) ? -1 : 1) //order is not waranted in multiple async results
      return blocks //proces is done, this will make a chain promise. next then will receive this return
    })
  }

  /**
   * Returns a promise with transactions of specified address of the n last blocks
   */
  async _getTransactionsInLastNBlocks(address, nBlocks) {        
    const endBlockNumber = await this.web3.eth.getBlockNumber()    
    const startBlockNumber = endBlockNumber - nBlocks + 1

    return this._getTransactionsInBlocks(address, startBlockNumber, endBlockNumber) 
  }

  /**
   * Returns a promise with transactions of specified address in the range of specified blocks
   */
  async _getTransactionsInBlocks(address, startBlockNumber, endBlockNumber) {

    const blocks = await this._getBlocks(startBlockNumber, endBlockNumber, true)

    //iterate through transactions
    let transactions = this._getTransactionsByAddressFromBlocks(blocks, address)
    transactions.sort((a, b) => (a.nonce > b.nonce) ? -1 : 1) //order is not waranted
    return transactions

  }

  /**
   * Returns a promise with last n blocks
   */
  async _getLastNBlocks(n, returnTransactions) {
    returnTransactions = returnTransactions || false
    if (n == 1) {//faster for latest block
      return this.web3.eth.getBlock('latest', returnTransactions)
    }
    const endBlockNumber = await this.web3.eth.getBlockNumber()    
    const startBlockNumber = endBlockNumber - n + 1
    return this._getBlocks(startBlockNumber, endBlockNumber, returnTransactions)
  }


  /**
   * Returns an array of transactions filtered by address from an array of blocks
   * Ordered from new to old. It expects blocks to be already ordered.
   * 
   * @param {array} blocks: Array of blocks
   * @param {string} address: Addres to filter
   * @param {int} max: Maximum quantity of transactions to return
   */
  _getTransactionsByAddressFromBlocks(blocks, address, max) {   
    address = address.toLowerCase()                
    let transactions = []
    let block
    let transaction
    let bCount = blocks.length;
    //iterate through blocks
    for(let b = 0; b < bCount; b++) {
      block = blocks[b]
      if (block != null && block.transactions != null) {        
        let tCount = block.transactions.length        
        //iterate through transactions
        block.transactions.sort((a, b) => (a.nonce > b.nonce) ? -1 : 1) //last transaction first. sort by nonce then by address to maintain order consistency
        block.transactions.sort((a, b) => (a.from > b.from) ? -1 : 1) 
        for(let t = 0; t < tCount; t++) {
          transaction = block.transactions[t]          
          if (address == transaction.from.toLowerCase() || address == transaction.to.toLowerCase()) {                                          
            transaction.block = block                        
            transactions.push(transaction)                 
            if (max > 0 && transactions.length == max) {              
              break
            }
          }              
        }        
      }
      if (max > 0 && transactions.length == max) {        
        break
      }
    }
    return transactions
  }

}

module.exports = SeedTokenAPIClientEthereumETHPersonal


