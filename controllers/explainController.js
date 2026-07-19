const { AiExplanation } = require("../models");
const { generateExplanation } = require("../services/explainService");

exports.explainCipherSection = async (req, res) => {
  try {
    const { jobId, sectionId, data } = req.body;

    if (!jobId || !sectionId || !data) {
      return res.status(400).json({ message: "jobId, sectionId, and data are required" });
    }

    // Check database cache first
    const cachedExplanation = await AiExplanation.findOne({
      where: { jobId, sectionId }
    });

    if (cachedExplanation) {
      return res.json({ explanation: cachedExplanation.content, cached: true });
    }

    // Generate new explanation via OpenAI
    const explanation = await generateExplanation(sectionId, data);

    // Cache the explanation in DB
    try {
      await AiExplanation.create({
        jobId,
        sectionId,
        content: explanation
      });
    } catch (dbError) {
      // Ignore unique constraint errors caused by concurrent identical requests (e.g., React Strict Mode)
      if (dbError.name !== 'SequelizeUniqueConstraintError') {
        console.error("Failed to cache explanation in DB:", dbError);
      }
    }

    return res.json({ explanation, cached: false });
  } catch (error) {
    console.error("Error in explainCipherSection:", error);
    return res.status(500).json({ message: "Failed to generate explanation", error: error.message });
  }
};
