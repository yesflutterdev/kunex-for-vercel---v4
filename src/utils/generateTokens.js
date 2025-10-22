const jwt = require('jsonwebtoken');
const Token = require('../models/token.model'); // Correct path to token.model.js

const generateTokens = async (user) => {
  try {
    console.log('🔑 Generating tokens for user:', user.email);
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" }
    );

    console.log('🔑 Tokens generated, saving refresh token...');

    // Save refresh token using Token model
    const newToken = new Token({
      userId: user._id,
      token: refreshToken,
      type: "refresh",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
    await newToken.save();

    console.log('✅ Tokens generated and saved successfully');
    return { token, refreshToken };
    
  } catch (error) {
    console.error('❌ Error generating tokens:', error);
    throw new Error('Failed to generate tokens: ' + error.message);
  }
};

module.exports = { generateTokens };
