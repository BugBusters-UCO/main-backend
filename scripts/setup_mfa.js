const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { User } = require('../models');
const { generateSecret, encrypt, totp } = require('../services/mfaService');
const env = require('../config/env');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("❌ Please provide your user email as an argument.");
    console.error("Example: node setup_mfa.js user@example.com");
    process.exit(1);
  }

  try {
    const user = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (!user) {
      console.error(`❌ User with email '${email}' not found in the database.`);
      process.exit(1);
    }

    const secret = generateSecret();
    await user.update({ 
      mfaSecretEncrypted: encrypt(secret, env.identity.mfaEncryptionKey), 
      mfaEnabled: true 
    });

    console.log(`\n✅ MFA Successfully Enabled for ${user.email} (DEV OVERRIDE)`);
    console.log(`Current TOTP Code: ${totp(secret)}`);
    console.log(`(You can use this code immediately on the VM Agents page or login)`);
    console.log(`=================================================================\n`);
    
  } catch (error) {
    console.error("Error setting up MFA:", error);
  } finally {
    process.exit(0);
  }
}

main();
