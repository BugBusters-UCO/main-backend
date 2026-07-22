const { spawn } = require("child_process");
const path = require("path");

let activeAgentProcess = null;

function spawnAgent(token, ownerEmail) {
  if (activeAgentProcess) {
    console.log("Terminating existing agent process before spawning new one...");
    activeAgentProcess.removeAllListeners();
    activeAgentProcess.kill();
    activeAgentProcess = null;
  }

  const isWindows = process.platform === 'win32';
  const scriptName = isWindows ? "bugbusters-agent.ps1" : "bugbusters-agent.sh";
  const scriptPath = path.resolve(__dirname, `../../vm-agent/${scriptName}`);
  const executable = isWindows ? 'powershell.exe' : 'bash';

  const args = [
    ...(isWindows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
    scriptPath,
    isWindows ? "-Mode" : "loop", // Bash uses arg $1 as mode, PS uses -Mode
    isWindows ? "loop" : "",
    ...(isWindows ? ["-MfaCode", token, "-OwnerEmail", ownerEmail] : [])
  ].filter(Boolean);

  console.log(`Spawning local VM agent: ${executable} ${args.join(" ")}`);
  
  // For the bash script, we pass environment variables instead of args
  const env = Object.assign({}, process.env, {
    BUGBUSTERS_MFA_CODE: token,
    BUGBUSTERS_OWNER_EMAIL: ownerEmail
  });

  activeAgentProcess = spawn(executable, args, {
    detached: false, // Keep it attached to the backend lifecycle or manage it here
    stdio: "pipe",
    env: env
  });

  activeAgentProcess.stdout.on("data", (data) => {
    console.log(`[VM Agent] ${data.toString().trim()}`);
  });

  activeAgentProcess.stderr.on("data", (data) => {
    console.error(`[VM Agent ERROR] ${data.toString().trim()}`);
  });

  activeAgentProcess.on("close", (code) => {
    console.log(`[VM Agent] Process exited with code ${code}`);
    activeAgentProcess = null;
  });

  return { success: true, message: "Agent spawned successfully." };
}

function killAgent() {
  if (!activeAgentProcess) {
    return { success: false, message: "No local agent is currently running." };
  }

  console.log("Terminating local VM agent...");
  activeAgentProcess.kill();
  activeAgentProcess = null;
  return { success: true, message: "Agent disconnected and process terminated." };
}

module.exports = {
  spawnAgent,
  killAgent
};
