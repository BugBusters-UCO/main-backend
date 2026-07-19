const axios = require("axios");

/**
 * Calls OpenAI to explain technical scanner data without generating scores or severity.
 */
async function generateExplanation(sectionId, data) {
  const apiKey = process.env.OPENAI_API_KEY;
  const apiModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the backend.");
  }

  let prompt = "";
  if (sectionId.endsWith("business-risk")) {
    prompt = `You are a security analyst. Explain this Business Risk Assessment data in a simple, easy-to-understand paragraph. Do not invent any scores or severity metrics. Focus on the business impact of the identified risks.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  } else if (sectionId.endsWith("key-risk-factors")) {
    prompt = `You are a security analyst. Explain these Key Risk Factors in a simple, easy-to-understand way. Do not invent any scores or severity metrics. Explain what the risks are and why they matter.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  } else if (sectionId === "posture") {
    prompt = `You are a security analyst. Explain this Pre-Deployment TLS Intelligence (Posture) data. Do not invent any scores or severity metrics. Summarize the deployment readiness and posture in simple terms.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  } else if (sectionId === "banking-intel") {
    prompt = `You are a security analyst. Explain this Banking Intel data (Drift, Agility, MTLS Gaps, Blockers, Warnings, Strengths). Do not invent any scores or severity metrics. Break down the findings so a normal user can understand the implications.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  } else if (sectionId === "attack-paths") {
    prompt = `You are a security analyst. Explain these Cipher Attack Paths. Do not invent any scores or severity metrics. Explain how these vulnerabilities could be chained or exploited by an attacker in plain English.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  } else {
    prompt = `You are a security analyst. Explain this technical data simply. Do not invent scores.\n\nData:\n${JSON.stringify(data, null, 2)}`;
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: apiModel,
        messages: [
          { role: "system", content: "You are an expert cybersecurity communicator. Your job is to translate complex technical scan data into clear, concise, score-free explanations for non-experts." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 25000
      }
    );

    const usage = response.data.usage;
    if (usage) {
      console.log(`[AI Explanation] Generated for section '${sectionId}' using model '${apiModel}'. Tokens - Prompt: ${usage.prompt_tokens}, Completion: ${usage.completion_tokens}, Total: ${usage.total_tokens}`);
    } else {
      console.log(`[AI Explanation] Generated for section '${sectionId}' using model '${apiModel}'. (Token usage not provided in response)`);
    }

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("OpenAI API Error:", error.response?.data || error.message);
    throw new Error("Failed to generate AI explanation.");
  }
}

module.exports = {
  generateExplanation
};
