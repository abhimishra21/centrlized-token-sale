const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const mongoose = require('mongoose');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
  'USDT_CONTRACT_ADDRESS',
  'NATIVE_TOKEN_CONTRACT_ADDRESS',
  'ADMIN_PRIVATE_KEY',
  'ADMIN_ADDRESS',
  'RPC_URL',
  'MONGODB_URI'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Import Transaction model
const Transaction = require('./models/Transaction');

// Token sale configuration
const TOKEN_PRICE_USDT = 1; // 1 USDT per token
const TOKEN_DECIMALS = 18;
const USDT_DECIMALS = 6;

// USDT contract address (example for Ethereum mainnet)
const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT_ADDRESS;
const NATIVE_TOKEN_CONTRACT_ADDRESS = process.env.NATIVE_TOKEN_CONTRACT_ADDRESS;

// Log contract addresses for debugging
console.log('USDT Contract Address:', USDT_CONTRACT_ADDRESS);
console.log('Native Token Contract Address:', NATIVE_TOKEN_CONTRACT_ADDRESS);

// USDT ABI (minimal for transfer and approval)
const USDT_ABI = [
    "function transfer(address to, uint256 value) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function transferFrom(address from, address to, uint256 value) returns (bool)"
];

// Native Token ABI (minimal for minting)
const NATIVE_TOKEN_ABI = [
    "function mint(address to, uint256 amount) returns (bool)"
];

// Initialize provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Initialize contracts
const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, provider);
const nativeTokenContract = new ethers.Contract(NATIVE_TOKEN_CONTRACT_ADDRESS, NATIVE_TOKEN_ABI, provider);

// Calculate token amount based on USDT input
const calculateTokenAmount = (usdtAmount) => {
    return (usdtAmount * (10 ** TOKEN_DECIMALS)) / TOKEN_PRICE_USDT;
};

// Store transaction history in memory (in production, use a database)
const transactionHistory = new Map();

// Update the buy-tokens endpoint to use MongoDB
app.post('/api/buy-tokens', async (req, res) => {
    try {
        const { usdtAmount, buyerAddress } = req.body;
        
        if (!usdtAmount || !buyerAddress) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Calculate token amount
        const tokenAmount = calculateTokenAmount(usdtAmount);
        
        // Convert amounts to proper decimal places
        const usdtAmountWithDecimals = ethers.parseUnits(usdtAmount.toString(), USDT_DECIMALS);
        const tokenAmountWithDecimals = ethers.parseUnits(tokenAmount.toString(), TOKEN_DECIMALS);

        // Create wallet instance for admin
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

        // Create contract instances with admin wallet
        const usdtContractWithSigner = usdtContract.connect(adminWallet);
        const nativeTokenContractWithSigner = nativeTokenContract.connect(adminWallet);

        // Check buyer's USDT balance
        const buyerBalance = await usdtContract.balanceOf(buyerAddress);
        console.log("Buyer's USDT balance:", ethers.formatUnits(buyerBalance, USDT_DECIMALS));
        console.log("Required USDT amount:", ethers.formatUnits(usdtAmountWithDecimals, USDT_DECIMALS));
        if (buyerBalance < usdtAmountWithDecimals) {
            return res.status(400).json({ 
                error: 'Insufficient USDT balance',
                required: ethers.formatUnits(usdtAmountWithDecimals, USDT_DECIMALS),
                available: ethers.formatUnits(buyerBalance, USDT_DECIMALS)
            });
        }

        // Check allowance
        const allowance = await usdtContract.allowance(buyerAddress, process.env.ADMIN_ADDRESS);
        console.log("Current USDT allowance for admin:", ethers.formatUnits(allowance, USDT_DECIMALS));
        if (allowance < usdtAmountWithDecimals) {
            return res.status(400).json({ 
                error: 'Insufficient USDT allowance. Please approve USDT transfer first.',
                required: ethers.formatUnits(usdtAmountWithDecimals, USDT_DECIMALS),
                approved: ethers.formatUnits(allowance, USDT_DECIMALS)
            });
        }

        // Create pending transaction record
        const pendingTx = new Transaction({
            buyerAddress,
            type: 'BUY',
            amount: tokenAmount.toString(),
            status: 'PENDING',
            txHash: 'pending',
            tokenPrice: TOKEN_PRICE_USDT,
            usdtAmount: usdtAmount.toString()
        });
        await pendingTx.save();

        try {
            // Transfer USDT from buyer to admin
            const usdtTransferTx = await usdtContractWithSigner.transferFrom(
                buyerAddress,
                process.env.ADMIN_ADDRESS,
                usdtAmountWithDecimals
            );
            await usdtTransferTx.wait();

            // Mint native tokens to buyer
            const mintTx = await nativeTokenContractWithSigner.mint(
                buyerAddress,
                tokenAmountWithDecimals
            );
            await mintTx.wait();

            // Update transaction record
            pendingTx.status = 'SUCCESS';
            pendingTx.txHash = mintTx.hash;
            await pendingTx.save();

            res.json({
                success: true,
                message: 'Token purchase successful',
                transactionHash: mintTx.hash,
                tokenAmount: tokenAmount.toString()
            });
        } catch (error) {
            // Update transaction record on failure
            pendingTx.status = 'FAILED';
            await pendingTx.save();
            throw error;
        }
    } catch (error) {
        console.error('Error in buy-tokens:', error);
        
        // Log the full error object for detailed debugging
        console.error('Detailed error object:', JSON.stringify(error, null, 2));
        
        // Handle specific error cases
        if (error.code === 'INSUFFICIENT_FUNDS') {
            return res.status(400).json({ error: 'Insufficient funds for gas (admin wallet)' });
        } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            return res.status(400).json({ error: 'Transaction would fail on chain. Check gas limit, balance, and contract logic.' });
        } else if (error.code === 'CALL_EXCEPTION') {
            return res.status(400).json({ error: `Blockchain call failed: ${error.reason || 'unknown revert'}` });
        }
        
        res.status(500).json({ 
            error: 'Failed to process token purchase',
            details: error.message
        });
    }
});

// Get token price endpoint
app.get('/api/token-price', (req, res) => {
    res.json({
        price: TOKEN_PRICE_USDT,
        decimals: TOKEN_DECIMALS
    });
});

// Get USDT allowance endpoint
app.get('/api/usdt-allowance', async (req, res) => {
    try {
        const { address } = req.query;
        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }

        const allowance = await usdtContract.allowance(address, process.env.ADMIN_ADDRESS);
        res.json({
            allowance: ethers.formatUnits(allowance, USDT_DECIMALS)
        });
    } catch (error) {
        console.error('Error getting USDT allowance:', error);
        res.status(500).json({ error: 'Failed to get USDT allowance' });
    }
});

// Get transaction history with pagination and filtering
app.get('/api/transaction-history', async (req, res) => {
    try {
        const { 
            address,
            page = 1,
            limit = 10,
            type,
            status,
            startDate,
            endDate
        } = req.query;

        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }

        // Build query
        const query = { buyerAddress: address };
        if (type) query.type = type;
        if (status) query.status = status;
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        // Execute query with pagination
        const skip = (page - 1) * limit;
        const [transactions, total] = await Promise.all([
            Transaction.find(query)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Transaction.countDocuments(query)
        ]);

        res.json({
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error getting transaction history:', error);
        res.status(500).json({ error: 'Failed to get transaction history' });
    }
});

// Get detailed sale statistics
app.get('/api/stats', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Build date filter
        const dateFilter = {};
        if (startDate || endDate) {
            dateFilter.timestamp = {};
            if (startDate) dateFilter.timestamp.$gte = new Date(startDate);
            if (endDate) dateFilter.timestamp.$lte = new Date(endDate);
        }

        // Get basic stats
        const [totalStats, dailyStats, topBuyers] = await Promise.all([
            // Total statistics
            Transaction.aggregate([
                { $match: { ...dateFilter, type: 'BUY', status: 'SUCCESS' } },
                {
                    $group: {
                        _id: null,
                        totalTokensSold: { $sum: { $toDouble: '$amount' } },
                        totalUsdtRaised: { $sum: { $toDouble: '$usdtAmount' } },
                        transactionCount: { $sum: 1 },
                        averagePurchaseAmount: { $avg: { $toDouble: '$usdtAmount' } }
                    }
                }
            ]),
            // Daily statistics
            Transaction.aggregate([
                { $match: { ...dateFilter, type: 'BUY', status: 'SUCCESS' } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                        tokensSold: { $sum: { $toDouble: '$amount' } },
                        usdtRaised: { $sum: { $toDouble: '$usdtAmount' } },
                        transactionCount: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            // Top buyers
            Transaction.aggregate([
                { $match: { ...dateFilter, type: 'BUY', status: 'SUCCESS' } },
                {
                    $group: {
                        _id: '$buyerAddress',
                        totalTokens: { $sum: { $toDouble: '$amount' } },
                        totalUsdt: { $sum: { $toDouble: '$usdtAmount' } },
                        transactionCount: { $sum: 1 }
                    }
                },
                { $sort: { totalUsdt: -1 } },
                { $limit: 10 }
            ])
        ]);

        res.json({
            totalStats: totalStats[0] || {
                totalTokensSold: 0,
                totalUsdtRaised: 0,
                transactionCount: 0,
                averagePurchaseAmount: 0
            },
            dailyStats,
            topBuyers
        });
    } catch (error) {
        console.error('Error getting sale statistics:', error);
        res.status(500).json({ error: 'Failed to get sale statistics' });
    }
});

// Export transaction history
app.get('/api/export-transactions', async (req, res) => {
    try {
        const { address, format = 'csv' } = req.query;

        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }

        const transactions = await Transaction.find({ buyerAddress: address })
            .sort({ timestamp: -1 });

        if (format === 'csv') {
            // Generate CSV
            const csv = [
                ['Date', 'Type', 'Amount', 'Status', 'Transaction Hash', 'Token Price', 'USDT Amount'],
                ...transactions.map(tx => [
                    new Date(tx.timestamp).toISOString(),
                    tx.type,
                    tx.amount,
                    tx.status,
                    tx.txHash,
                    tx.tokenPrice,
                    tx.usdtAmount
                ])
            ].map(row => row.join(',')).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
            res.send(csv);
        } else {
            res.json({ transactions });
        }
    } catch (error) {
        console.error('Error exporting transactions:', error);
        res.status(500).json({ error: 'Failed to export transactions' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 