const User = require("./User");
const ScanJob = require("./ScanJob");
const GithubAccount = require("./GithubAccount");
const ImportedRepository = require("./ImportedRepository");
const Agent = require("./Agent");
const AgentScanJob = require("./AgentScanJob");

function applyAssociations() {
  if (!User || !ScanJob || !GithubAccount || !ImportedRepository) return;

  User.hasMany(GithubAccount, { foreignKey: "userId", as: "githubAccounts" });
  GithubAccount.belongsTo(User, { foreignKey: "userId", as: "user" });

  User.hasMany(ImportedRepository, { foreignKey: "userId", as: "repositories" });
  ImportedRepository.belongsTo(User, { foreignKey: "userId", as: "user" });
  GithubAccount.hasMany(ImportedRepository, { foreignKey: "githubAccountId", as: "repositories" });
  ImportedRepository.belongsTo(GithubAccount, { foreignKey: "githubAccountId", as: "githubAccount" });

  User.hasMany(ScanJob, { foreignKey: "userId", as: "scanJobs" });
  ScanJob.belongsTo(User, { foreignKey: "userId", as: "user" });
  ImportedRepository.hasMany(ScanJob, { foreignKey: "importedRepositoryId", as: "scanJobs" });
  ScanJob.belongsTo(ImportedRepository, { foreignKey: "importedRepositoryId", as: "repository" });

  if (Agent && AgentScanJob) {
    User.hasMany(Agent, { foreignKey: "userId", as: "agents" });
    Agent.belongsTo(User, { foreignKey: "userId", as: "user" });
    User.hasMany(AgentScanJob, { foreignKey: "userId", as: "agentScanJobs" });
    AgentScanJob.belongsTo(User, { foreignKey: "userId", as: "user" });
    Agent.hasMany(AgentScanJob, { foreignKey: "agentId", as: "scanJobs" });
    AgentScanJob.belongsTo(Agent, { foreignKey: "agentId", as: "agent" });
  }
}

applyAssociations();

module.exports = {
  User,
  ScanJob,
  GithubAccount,
  ImportedRepository,
  Agent,
  AgentScanJob,
  applyAssociations
};
