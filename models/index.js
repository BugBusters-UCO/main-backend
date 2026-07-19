const User = require("./User");
const ScanJob = require("./ScanJob");
const GithubAccount = require("./GithubAccount");
const ImportedRepository = require("./ImportedRepository");
const Agent = require("./Agent");
const AgentScanJob = require("./AgentScanJob");
const RiskAssessment = require("./RiskAssessment");
const ScheduledScan = require("./ScheduledScan");
const Advisory = require("./Advisory");
const FindingReview = require("./FindingReview");
const AuditEvent = require("./AuditEvent");
const QuarantineRecord = require("./QuarantineRecord");
const AdvisoryFeedState = require("./AdvisoryFeedState");
const SecretFinding = require("./SecretFinding");
const SecretRotationAction = require("./SecretRotationAction");
const AiExplanation = require("./AiExplanation");

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

  if (RiskAssessment) {
    User.hasMany(RiskAssessment, { foreignKey: "userId", as: "riskAssessments" });
    RiskAssessment.belongsTo(User, { foreignKey: "userId", as: "user" });
  }

  if (ScheduledScan) {
    User.hasMany(ScheduledScan, { foreignKey: "userId", as: "scheduledScans" });
    ScheduledScan.belongsTo(User, { foreignKey: "userId", as: "user" });
    ImportedRepository.hasMany(ScheduledScan, { foreignKey: "importedRepositoryId", as: "scheduledScans" });
    ScheduledScan.belongsTo(ImportedRepository, { foreignKey: "importedRepositoryId", as: "repository" });
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
  RiskAssessment,
  ScheduledScan,
  Advisory,
  FindingReview,
  AuditEvent,
  QuarantineRecord,
  AdvisoryFeedState,
  SecretFinding,
  SecretRotationAction,
  AiExplanation,
  applyAssociations
};
