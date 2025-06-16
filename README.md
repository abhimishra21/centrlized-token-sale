# Centralized Token Sale Platform

A full-stack application for selling native tokens in exchange for USDT.

## Features

- Connect MetaMask wallet
- Buy native tokens using USDT
- Real-time token price display
- Transaction status updates
- Modern UI with Material-UI

## Prerequisites

- Node.js (v14 or higher)
- MetaMask browser extension
- USDT tokens in your wallet
- Access to an Ethereum network (mainnet or testnet)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd centrlise-token-sale
```

2. Install backend dependencies:
```bash
npm install
```

3. Install frontend dependencies:
```bash
cd frontend
npm install
```

4. Create a `.env` file in the root directory with the following variables:
```
PORT=5000
RPC_URL=YOUR_ETHEREUM_NODE_URL
USDT_CONTRACT_ADDRESS=YOUR_USDT_CONTRACT_ADDRESS
NATIVE_TOKEN_CONTRACT_ADDRESS=YOUR_NATIVE_TOKEN_CONTRACT_ADDRESS
ADMIN_PRIVATE_KEY=YOUR_ADMIN_PRIVATE_KEY
ADMIN_ADDRESS=YOUR_ADMIN_WALLET_ADDRESS
```

## Running the Application

1. Start the backend server:
```bash
npm run dev
```

2. In a new terminal, start the frontend:
```bash
cd frontend
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Connect your MetaMask wallet using the "Connect Wallet" button
2. Enter the amount of USDT you want to spend
3. Click "Buy Tokens" to purchase native tokens
4. Confirm the transaction in MetaMask
5. Wait for the transaction to be processed

## Security Considerations

- Never share your private keys
- Always verify contract addresses
- Use a secure RPC URL
- Consider using a testnet for development

## License

MIT 