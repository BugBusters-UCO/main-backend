const Groq = require("groq-sdk");

const handleChat = async (req, res) => {
  try {
    const { messages, pageContext } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === "your_groq_api_key_here") {
      return res.status(500).json({ error: "Groq API key is not configured" });
    }

    const groq = new Groq({ apiKey });
    
    const systemPrompt = `You are BugBusters AI, an expert security assistant embedded in a banking-grade vulnerability management dashboard. 
You explain findings clearly using simple, non-technical language so that normal banking users and managers can easily understand them. 

CRITICAL FORMATTING RULES:
1. ALWAYS structure your responses cleanly. Never output large, unbroken blocks of text.
2. Use markdown bullet points (- ) or numbered lists to break down multiple items, steps, or features.
3. Use bold text (**bold**) for key terms, metrics, or section headers to make scanning easy.
4. Use short paragraphs and ensure there is an empty line between different paragraphs and lists.
5. Keep your responses short and concise unless the user specifically asks for detailed information.
6. Do NOT include raw JSON data directly in the response unless the user specifically asks for it.
7. Be concise, use plain English, and provide actionable advice. 
8. Never make up data — only use the context provided.
9. ABSOLUTELY NO EMOJIS in your responses.
10. GUARDRAIL: Focus strictly on the provided context and banking security. Politely decline to answer questions outside of this scope.
11. GUARDRAIL: NEVER include any type of score, confidence value, probability, or percentage rating in your response.

Current Page Context:
${JSON.stringify(pageContext || {}, null, 2)}`;

    // Prepare history
    let historyParts = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

    historyParts.unshift({
      role: 'system',
      content: systemPrompt
    });

    const chatCompletion = await groq.chat.completions.create({
      messages: historyParts,
      model: "qwen/qwen3.6-27b",
      temperature: 0.6,
      max_completion_tokens: 2048,
      top_p: 0.95,
      stream: true,
      reasoning_effort: "none",
      stop: null
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let isThinking = false;
    let hasSeenThinkStart = false;
    let buffer = "";

    for await (const chunk of chatCompletion) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (!content) continue;
      
      buffer += content;

      if (!hasSeenThinkStart) {
        if (buffer.includes("<think>")) {
          isThinking = true;
          hasSeenThinkStart = true;
        } else if (buffer.length > 15 && !buffer.includes("<")) {
          res.write(`data: ${JSON.stringify({ text: buffer })}\n\n`);
          buffer = "";
          hasSeenThinkStart = true;
          isThinking = false;
        }
      } else if (isThinking) {
        if (buffer.includes("</think>")) {
          isThinking = false;
          const parts = buffer.split("</think>");
          const afterThink = parts.slice(1).join("</think>");
          if (afterThink) {
            res.write(`data: ${JSON.stringify({ text: afterThink })}\n\n`);
          }
          buffer = "";
        }
      } else {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        await new Promise(r => setTimeout(r, 60));
      }
    }

    if (!hasSeenThinkStart && buffer) {
      res.write(`data: ${JSON.stringify({ text: buffer })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error("Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate AI response" });
    } else {
      res.end();
    }
  }
};

module.exports = {
  handleChat
};
