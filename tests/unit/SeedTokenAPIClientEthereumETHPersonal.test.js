const Web3 = require('web3')
const { SeedTokenAPIClientEthereumETHPersonal } = require('../../index.js')

if (!process.env.PARITY_HTTP_URL && !process.env.PARITY_WS_URL && !process.env.PARITY_IPC_URL) {
    console.log('You need to configure at least one URL in env: PARITY_HTTP_URL, PARITY_WS_URL and PARITY_IPC_URL')    
    process.exit(1)
}

let st, newAddress

let testAddress = process.env.PARITY_TEST_ADDRESS || '0x00a329c0648769A73afAc7F9381E08FB43dBEA72'//parity dev chain address
let testAddressPassphrase = process.env.PARITY_TEST_ADDRESS_PASSPHRASE || ''//parity dev chain address passphrase
let newPassphrase = Math.random().toString(36).substr(2, 8)
let transfer1Amount = '0.000000002'
let transfer2Amount = '0.000000001'

it('returns singleton ok', () => {
    singleton = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_HTTP_URL)
    singleton2 = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_HTTP_URL)
    singleton3 = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_HTTP_URL + '1')
    expect(singleton == singleton2).toBeTruthy()
    expect(singleton == singleton3).toBeFalsy()

})

it('instatiates ok', () => {
    expect(() => {st = new SeedTokenAPIClientEthereumETHPersonal(process.env.PARITY_HTTP_URL)}).toThrow(Error);
    if (process.env.PARITY_HTTP_URL) {
	st = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_HTTP_URL)
	st.lockedTransaction = false
    }
    if (process.env.PARITY_WS_URL) {st = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_WS_URL)}
    if (process.env.PARITY_IPC_URL) {st = SeedTokenAPIClientEthereumETHPersonal.getInstance(process.env.PARITY_IPC_URL)}
})


it('creates new account', async () => {
    newAddress = await st.createAccount(newPassphrase)
    expect(Web3.utils.isAddress(newAddress)).toBeTruthy()
})

it('checks address validity', () => {    
    expect(st.checkAddress(newAddress)).toBeTruthy()
    expect(st.checkAddress('0x9F8AdE9c146c841Ea363AbB07BFf00A1CD5f0593'/* bad checksum valid address */)).toBeFalsy()
    expect(st.checkAddress('notanaddress')).toBeFalsy()
    expect(st.checkAddress('a' + newAddress)).toBeFalsy()
})

it('transfers tokens from test account to newly created account', async () => {
    let hash = await st.transfer(testAddress, newAddress, transfer1Amount, testAddressPassphrase)
    expect(hash).toMatch(/^0x([A-Fa-f0-9]{64})$/);    
})

it('gets balance from new address', async () => {
    let balance = await st.getBalance(newAddress)
    expect(balance).toBe(transfer1Amount);
})

it('gets last N transactions of new address', async () => {
    await st.transfer(newAddress, testAddress, transfer2Amount, newPassphrase)    
    let transactions = await st.getLastNTransactions(newAddress, 2, 10)
    expect(transactions.length).toBe(2)    

    expect(transactions[0].from.toLowerCase()).toBe(newAddress.toLowerCase())
    expect(transactions[0].to.toLowerCase()).toBe(testAddress.toLowerCase())
    expect(transactions[0].timestamp).toBeGreaterThan(1565666122)
    expect(transactions[0].amount).toBe(transfer2Amount)

    expect(transactions[1].from.toLowerCase()).toBe(testAddress.toLowerCase())
    expect(transactions[1].to.toLowerCase()).toBe(newAddress.toLowerCase())
    expect(transactions[1].timestamp).toBeGreaterThan(1565666122)
    expect(transactions[1].amount).toBe(transfer1Amount)
})
