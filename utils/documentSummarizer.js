const fs = require("fs");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

async function extractPdfText(filePathOrBuffer) {
    let buffer;

    // Check if it's a file path (string) or buffer
    if (typeof filePathOrBuffer === 'string') {
        // It's a file path, read from filesystem
        buffer = fs.readFileSync(filePathOrBuffer);
    } else if (Buffer.isBuffer(filePathOrBuffer)) {
        // It's already a buffer
        buffer = filePathOrBuffer;
    } else {
        throw new Error('Invalid input: expected file path (string) or buffer');
    }

    const data = await pdfParse(buffer);
    return data.text;
}

async function summarizeText(text) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = "You are a helpful assistant that summarizes documents in bullet points.";

    const completion = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: text }
        ],
        temperature: 0.3,
        max_tokens: 1024
    });

    return completion.choices[0].message.content;
}

//Function to accept the pdf buffer and return the summary
exports.summarizePdfBuffer = async (pdfBuffer) => {
    try {
        const pdfText = await extractPdfText(pdfBuffer);
        const summary = await summarizeText(pdfText);
        return summary;
    } catch (err) {
        console.error("Error:", err);
        throw err;
    }
};

exports.summarizePdf = async (pdfFile) => {
    try {
        const pdfText = await extractPdfText(pdfFile);
        const summary = await summarizeText(pdfText);
        return summary;
    } catch (err) {
        console.error("Error:", err);
        throw err;
    }
};