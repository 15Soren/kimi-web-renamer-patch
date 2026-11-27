const npmPatch = require("./npm-patch");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
} = require("./kimi-config");

module.exports = {
  findKimiCodePath: npmPatch.findKimiCodePath,
  isValidKimiDir: npmPatch.isValidKimiDir,
  checkStatus: npmPatch.checkStatus,
  applyPatch: npmPatch.applyPatch,
  restorePatch: npmPatch.restorePatch,
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
};
