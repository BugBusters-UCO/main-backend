const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sequelize, connectDatabase } = require("../dbConnection/sequelize");
const { User, ScanJob, AgentScanJob } = require("../models");

async function cleanHistory() {
  const email = process.argv[2];
  
  if (!email) {
    console.error("❌ Error: Please provide the email address of the account.");
    console.error("Usage: node cleanHistory.js <user-email>");
    process.exit(1);
  }

  try {
    console.log("Connecting to database...");
    await connectDatabase();
    
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error(`❌ User with email '${email}' not found in the database.`);
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user.email} (ID: ${user.id})`);
    console.log("Cleaning scanned history...");
    
    const scanJobsDeleted = await ScanJob.destroy({ where: { userId: user.id } });
    console.log(`🗑️  Deleted ${scanJobsDeleted} regular scan jobs.`);
    
    if (AgentScanJob) {
      const agentScanJobsDeleted = await AgentScanJob.destroy({ where: { userId: user.id } });
      console.log(`🗑️  Deleted ${agentScanJobsDeleted} VM agent scan jobs.`);
    }
    
    console.log("✨ Scanned history successfully cleaned!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error cleaning history:", error);
    process.exit(1);
  }
}

cleanHistory();
