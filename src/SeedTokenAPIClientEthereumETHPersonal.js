const { SeedTokenAPIClientAbstract, Transaction } = require('./SeedTokenAPIClientAbstract.js')
const Web3 = require('web3')
const {performance} = require('perf_hooks');
const Redis = require('redis')
const Redlock = require('redlock');
const Axios = require('axios');

/**
 * Handles native Ethereum ETH token using personal accounts with passphrase letting Parity Ethereum node to handle and store private keys
 */
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}
class SeedTokenAPIClientEthereumETHPersonal extends SeedTokenAPIClientAbstract {  

  constructor (rpcURL, forceSingleton) {  
    super();

    if (!forceSingleton) {
      throw new Error('You must get instance with SeedTokenAPIClientEthereumETHPersonal.getInstance()')
    }

    this.debug = process.env['SEEDTOKEN_API_CLIENT_DEBUG'] == 'true'|| false
    this.lockedTransaction = process.env['SEEDTOKEN_API_CLIENT_LOCKED_TRANSACTION'] == 'true'
    if (process.env['SEEDTOKEN_API_CLIENT_LOCKED_TRANSACTION'] === undefined) {
      this.lockedTransaction = true
    }    
    this.lockRetryCount = parseInt(process.env['SEEDTOKEN_API_CLIENT_RETRY_COUNT']) || 10
    this.lockRetryDelay = parseInt(process.env['SEEDTOKEN_API_CLIENT_RETRY_DELAY']) || 500
    this.lockTTL = parseInt(process.env['SEEDTOKEN_API_CLIENT_LOCK_TTL']) || 2000

    this.rpcURL = rpcURL
    let provider

    if (rpcURL.startsWith('http')) {
      provider = new Web3.providers.HttpProvider(this.rpcURL)  
    } else if (rpcURL.startsWith('ws://')) {
      provider = new Web3.providers.WebsocketProvider(this.rpcURL)
      provider.on('error', e => console.error('WS Error', e));
      provider.on('end', e => console.error('WS End', e));
    } else if (rpcURL.startsWith('file://')) {
      var net = require('net');
      provider = new Web3.providers.IpcProvider(rpcURL.replace('file://',''), net) 
    } else {
      throw new Error('Invalid rpcURL')
    }

    this.axios = Axios.create({baseURL: process.env['SEEDTOKEN_API_CLIENT_BLOCKSCOUT_URL']});

    this.web3 = new Web3(provider)

    this.bufferSize = 50 //how many blocks to read on each iteration
    this.timeout = 5     //how many seconds to wait for a result (used in getLastNTransactions())

    this.gasMaxLimit = 10000 //max gaslimit allowed
  }

  /**
   * Provides a singleton.
   * 
   */
  static getInstance(rpcURL) {

    if (!SeedTokenAPIClientEthereumETHPersonal.instance) {
      SeedTokenAPIClientEthereumETHPersonal.instance = {}
    }

    if (SeedTokenAPIClientEthereumETHPersonal.instance[rpcURL]) {
      return SeedTokenAPIClientEthereumETHPersonal.instance[rpcURL]
    }
    SeedTokenAPIClientEthereumETHPersonal.instance[rpcURL] = new SeedTokenAPIClientEthereumETHPersonal(rpcURL, true)
    return SeedTokenAPIClientEthereumETHPersonal.instance[rpcURL]
  }

  /**
   * Checks address format and checksum if case checksum is available
   */
  checkAddress(address) {
    return Web3.utils.isAddress(address)
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
          } else {
            reject(err)  
          }
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
      if (!this.checkAddress(address)) {
        reject('Invalid address')
      }
      this.web3.eth.getBalance(address, (err, wei) => {           
        if (wei) {
          resolve(this.web3.utils.fromWei(wei, 'ether'))
        } else {
          reject(err)
        }
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
  async transfer(fromAddress, toAddress, amountETH, passphrase, gasPrice) {    
    gasPrice = gasPrice || '0' //in POA should be 0
    if (!this.checkAddress(fromAddress)) {
      throw new Error('Invalid from address')      
    }
    if (!this.checkAddress(toAddress)) {
      throw new Error('Invalid to address')      
    }
    if (typeof amountETH !== 'string') {
      throw new Error('Invalid amount value type. It should be a string')      
    }
    if (gasPrice > this.gasMaxLimit) {
      throw new Error('gasPrice exceeds maximum gas price')
    }
    //We do mutex here to protect unlockAccount and transfer operations because Parity doesn't allow more than one unlocked account at time
    if (this.lockedTransaction) {
      var redisClient = Redis.createClient({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        db: 1,
      });
      var resource = 'locks:seedtokenapiclient';      
      var redlock = new Redlock([redisClient], {riftFactor: 0.01, retryCount:  this.lockRetryCount, retryDelay:  this.lockRetryDelay, retryJitter:  200});

      return new Promise((resolve, reject) => {
        // the string identifier for the resource you want to lock        
        redlock.lock(resource, this.lockTTL).then(async (lock) => {          
          this.log('We got the lock!');          
          var hash = await this._unlockedUnverifiedTransfer(fromAddress, toAddress, amountETH, passphrase, gasPrice)
          this.log('Unlocking')          
          return lock.unlock()
            .then(() => {
              resolve(hash)
            })
            .catch((err) => {
              // we weren't able to reach redis; your lock will eventually
              // expire, but you probably want to log this error
              console.error(err);
              reject(err)
            });
          
        })
      })
    } else {
      return this._unlockedUnverifiedTransfer(fromAddress, toAddress, amountETH, passphrase, gasPrice)
    }
  }

  async _unlockedUnverifiedTransfer(fromAddress, toAddress, amountETH, passphrase, gasPrice) {          
    this.log('Trying to transfer ' + amountETH + ' tokens from address ' + fromAddress + ' to address ' + toAddress)
    this.log('First try to unlock account ' + fromAddress)
    await this.web3.eth.personal.unlockAccount(fromAddress, passphrase)
    this.log('Account unlocked')    
    return new Promise((resolve, reject) => {              
      this.web3.eth.sendTransaction(
        {
          from: fromAddress,
          to: toAddress, 
          value: this.web3.utils.toWei(amountETH, 'ether'),
          gas: "0x76c0", // 30400
          gasPrice: gasPrice,          
        },
        (err, hash) => {//nothing special to do here, leaving just in case
          if (hash) {             
            this.log('Transaction was sent to the node. Returned hash ' + hash)
            resolve(hash)            
          } else {
            this.log('Transaction error', err)
            reject(err)  
          }
        })
      })
  }

  /**
   * Returns a promise with last n transactions of a specifiedd address. Ordered from new to old.
   * 
   * @param {string} address: Ethereum address to filter 
   * @param {int} nTransaction: Amount of transactions to return
   * @param {int} since: Filter based on date in UNIX Epoch time (note it's quantity of seconds not miliseconds as in Javascript Date.now())
   */
  async getLastNTransactions(address, nTransactions, since) {
    if (!this.checkAddress(address)) {
        throw new Error('Invalid address')      
    }   
    
    if (process.env['SEEDTOKEN_API_CLIENT_GETLASTTRANSACTIONS_BACKEND'] == 'parity') {
      return this._getLastNTransactionsParity(address, nTransactions, since)
    } else if (process.env['SEEDTOKEN_API_CLIENT_GETLASTTRANSACTIONS_BACKEND'] == 'blockscout') {
      return this._getLastNTransactionsBlockscout(address, nTransactions, since)
    } else {      
      throw new Error('Invalid SEEDTOKEN_API_CLIENT_GETLASTTRANSACTIONS_BACKEND value')
    }
  }

  /**
   * Returns a promise with last n transactions of a specifiedd address. Ordered from new to old.
   * This method uses Blockscout blockchain explorer as backend so it will be extremely fast
   * but transactions can be out of sync form Parity for 25s maximum
   * 
   * @param {string} address: Ethereum address to filter 
   * @param {int} nTransaction: Amount of transactions to return
   * @param {int} since: Filter based on date in UNIX Epoch time (note it's quantity of seconds not miliseconds as in Javascript Date.now())
   */
  async _getLastNTransactionsBlockscout(address, nTransactions, since) {
    const ts = await this.axios.get(`/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=${nTransactions}`);   

    let transactions = []
    ts.data.result.forEach((t) => {            
      let tObj = new Transaction(t.hash, t.from, t.to, this.web3.utils.fromWei(t.value, 'ether'), t.timeStamp)
      transactions.push(tObj)
    })
    return transactions
  }

  /**
   * Returns a promise with last n transactions of a specifiedd address. Ordered from new to old.
   * This does a full scan of Parity database so if any of those last n transactions are old, this will take some time 
   * 
   * @param {string} address: Ethereum address to filter 
   * @param {int} nTransaction: Amount of transactions to return
   * @param {int} since: Filter based on date in UNIX Epoch time (note it's quantity of seconds not miliseconds as in Javascript Date.now())
   */
  async _getLastNTransactionsParity(address, nTransactions, since) {
    
    let endBlockNumber = await this.web3.eth.getBlockNumber()    
    let startBlockNumber = endBlockNumber - this.bufferSize    
    let max = nTransactions
    let ts = []
    let blocks = []

    let t0 = performance.now();
    
    while (ts.length < nTransactions 
            && startBlockNumber >= 1  //stop at block 1      
            && (performance.now() - t0) < (this.timeout * 1000)
            && (!since || blocks.length == 0 || (blocks.length && blocks[0].timestamp >= since))) {

      blocks = await this._getBlocks(startBlockNumber, endBlockNumber, true)                  
      ts = ts.concat(this._getTransactionsByAddressFromBlocks(blocks, address, max - ts.length))      

      startBlockNumber -= this.bufferSize + 1 //moves buffer pointer
      endBlockNumber -= this.bufferSize + 1                 
    }    

    let transactions = []
    ts.forEach((t) => {      
      let tObj = new Transaction(t.hash, t.from, t.to, this.web3.utils.fromWei(t.value, 'ether'), t.block.timestamp)
      transactions.push(tObj)
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
              return         
            }      
            blocks.push(block)                        
            count++ //using counter we are sure all requests finished in the batch
            if (count == total) {  
              resolve(blocks) //resolve promise when all blocks are fetched              
              return
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

  log(data) {
    if (this.debug) {
      console.log(data)
    }
  }
  
}

module.exports = SeedTokenAPIClientEthereumETHPersonal


