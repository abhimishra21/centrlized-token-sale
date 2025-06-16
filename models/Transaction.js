const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  buyerAddress: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['BUY', 'APPROVE'],
    required: true
  },
  amount: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED', 'PENDING'],
    required: true
  },
  txHash: {
    type: String,
    required: true,
    unique: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  tokenPrice: {
    type: Number,
    required: true
  },
  usdtAmount: {
    type: String,
    required: true
  }
});

// Add indexes for better query performance
transactionSchema.index({ timestamp: -1 });
transactionSchema.index({ buyerAddress: 1, timestamp: -1 });

module.exports = mongoose.model('Transaction', transactionSchema); 