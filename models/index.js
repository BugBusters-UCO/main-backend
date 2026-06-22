const User = require("./User");
const ScanJob = require("./ScanJob");
const GithubAccount = require("./GithubAccount");
const ImportedRepository = require("./ImportedRepository");

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
}

applyAssociations();

module.exports = {
  User,
  ScanJob,
  GithubAccount,
  ImportedRepository,
  applyAssociations
};
