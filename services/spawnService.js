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

  const scriptPath = path.resolve(__dirname, "../../vm-agent/bugbusters-agent.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Mode",
    "loop",
    "-MfaCode",
    token,
    "-OwnerEmail",
    ownerEmail
  ];

  console.log(`Spawning local VM agent: ${args.join(" ")}`);
  
  const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

  activeAgentProcess = spawn(executable, args, {
    detached: false, // Keep it attached to the backend lifecycle or manage it here
    stdio: "pipe"
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
