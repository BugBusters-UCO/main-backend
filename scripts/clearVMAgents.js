const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sequelize, connectDatabase } = require("../dbConnection/sequelize");
const { User, Agent, AgentScanJob } = require("../models");

async function clearVMAgents() {
  const email = process.argv[2];
  
  if (!email) {
    console.error("❌ Error: Please provide the email address of the account.");
    console.error("Usage: node clearVMAgents.js <user-email>");
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
    console.log("Clearing all VM-agent data...");
    
    if (AgentScanJob) {
      const agentScanJobsDeleted = await AgentScanJob.destroy({ where: { userId: user.id } });
      console.log(`🗑️  Deleted ${agentScanJobsDeleted} VM agent scan jobs.`);
    }

    if (Agent) {
      const agentsDeleted = await Agent.destroy({ where: { userId: user.id } });
      console.log(`🗑️  Deleted ${agentsDeleted} registered VM agents.`);
    }
    
    console.log("✨ VM Agent data successfully cleared for the user!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error clearing VM Agent data:", error);
    process.exit(1);
  }
}

clearVMAgents();
