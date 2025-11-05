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

function estimateTokenCount(text) {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
}

function chunkText(text, maxChunkSize = 100000) {
    // Split text into chunks if it's too large
    const chunks = [];
    for (let i = 0; i < text.length; i += maxChunkSize) {
        chunks.push(text.substring(i, i + maxChunkSize));
    }
    return chunks;
}

async function processLargeDocument(text, openai, abortSignal = null) {
    const chunks = chunkText(text, 80000); // Smaller chunks to be safe

    const extractedSections = {
        summary: 'Text not found',
        objectives: 'Text not found',
        proposed_solution: 'Text not found',
        deliverables: 'Text not found',
        project_plan_tech_stack: 'Text not found',
        timeline: 'Text not found',
        risk_assessment: 'Text not found',
        budget_estimate: 'Text not found',
        team_details: 'Text not found',
        certifications_awards: 'Text not found',
        case_studies: 'Text not found',
        past_projects: 'Text not found',
        partnership_overview: 'Text not found',
        references_proven_results: 'Text not found',
        why_us: 'Text not found',
        terms_conditions: 'Text not found',
        cover_letter: 'Text not found'
    };

    // Process each chunk and accumulate information
    for (let i = 0; i < chunks.length; i++) {
        // Check for abort signal
        if (abortSignal && abortSignal.aborted) {
            throw new Error('Process aborted');
        }
        const chunkPrompt = `Extract information from this PDF text chunk and return a JSON object. Look for content related to these sections and extract ALL relevant text (do not summarize):

Required sections: summary, objectives, proposed_solution, deliverables, project_plan_tech_stack, timeline, risk_assessment, budget_estimate, team_details, certifications_awards, case_studies, past_projects, partnership_overview, references_proven_results, why_us, terms_conditions, cover_letter

If a section is not found in this chunk, use 'Text not found' as the value.
Return ONLY a valid JSON object.`;

        // Add timeout for chunk processing
        const chunkTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Chunk ${i + 1} processing timed out after 5 minutes`));
            }, 300000); // 5 minute timeout for chunks
        });

        const completion = await Promise.race([
            openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: chunkPrompt },
                    { role: "user", content: chunks[i] }
                ],
                temperature: 0.0
            }),
            chunkTimeoutPromise
        ]);
        if (!completion) {
            throw new Error("No completion from OpenAI");
        }

        try {
            const chunkResponse = completion?.choices[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            if (!chunkResponse) {
                throw new Error("No JSON response from OpenAI");
            }
            const chunkData = JSON.parse(chunkResponse);

            // Merge non-empty sections from this chunk
            Object.keys(chunkData).forEach(key => {
                if (chunkData[key] && chunkData[key] !== 'Text not found' && chunkData[key].length > 0) {
                    if (extractedSections[key] === 'Text not found') {
                        extractedSections[key] = chunkData[key];
                    } else {
                        // Append to existing content
                        extractedSections[key] += '\n\n' + chunkData[key];
                    }
                }
            });
        } catch (parseError) {
            console.error(`Error parsing chunk ${i + 1}:`, parseError);
        }
    }

    return JSON.stringify(extractedSections, null, 2);
}

async function convertPdfToJson(text, abortSignal = null) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const estimatedTokens = estimateTokenCount(text);

    // If the text is very large, we might need to process it in chunks
    if (estimatedTokens > 120000) { // GPT-4o has ~128k context limit
        return await processLargeDocument(text, openai, abortSignal);
    }

    const prompt = `You are a helpful assistant that extracts text from a PDF document and converts it to JSON format. 

CRITICAL INSTRUCTIONS:
1. Extract ALL relevant content for each section - do not truncate or summarize
2. Include complete paragraphs, full details, and comprehensive information for each key
3. Do not hallucinate any information - only use text that is actually present in the PDF
4. For each section, extract the ENTIRE content related to that topic, not just a summary
5. Be thorough and comprehensive - this is critical for proposal evaluation

Required JSON keys (extract FULL content for each):
- summary: Complete company/project summary with all details
- objectives: Full project objectives and goals
- proposed_solution: Detailed solution description with all components
- deliverables: Complete list of all deliverables with descriptions
- project_plan_tech_stack: Detailed technical approach and technology stack
- timeline: Full project timeline with all phases and milestones
- risk_assessment: Complete risk analysis with all identified risks
- budget_estimate: Detailed budget breakdown with all cost components
- team_details: Full team information including roles and qualifications
- certifications_awards: All certifications, awards, and recognitions
- case_studies: Complete case study descriptions
- past_projects: Detailed past project information
- partnership_overview: Full partnership and collaboration details
- references_proven_results: Complete reference information and proven results
- why_us: Full value proposition and competitive advantages
- terms_conditions: All terms and conditions if present
- cover_letter: Complete cover letter content if present

If a section is not found in the document, use 'Text not found' as the value.
Return ONLY a valid JSON object with no other text, no markdown formatting, no code blocks, and no additional explanation.`;

    let completion;

    try {
        // Check for abort signal before starting
        if (abortSignal && abortSignal.aborted) {
            throw new Error('Process aborted');
        }

        // Add timeout wrapper for OpenAI API call
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('OpenAI API call timed out after 5 minutes'));
            }, 600000); // 10 minute timeout
        });

        completion = await Promise.race([
            openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: text }
                ],
                temperature: 0.0
            }),
            timeoutPromise
        ]);

    } catch (error) {
        //Try once more with gpt-4o-mini model
        try {
            const retryTimeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('OpenAI API retry call timed out after 5 minutes'));
                }, 600000);
            });

            completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: text }
                    ],
                    temperature: 0.0
                }),
                retryTimeoutPromise
            ]);

        } catch (retryError) {
            console.error("Failed to parse JSON response after retry:", retryError);
            throw new Error(`Invalid JSON response from OpenAI: ${retryError.message}`);
        }
    } finally {
        //No need to return anything
    }

    let jsonResponse = completion?.choices[0]?.message?.content;
    if (!jsonResponse) {
        throw new Error("No JSON response from OpenAI");
    }

    // Clean up the response - remove markdown formatting if present
    jsonResponse = jsonResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Attempt to parse the JSON to ensure it's valid
    try {
        const parsedJson = JSON.parse(jsonResponse);

        // Log which sections have content vs "Text not found"
        const sectionStatus = {};
        Object.keys(parsedJson).forEach(key => {
            const value = parsedJson[key];
            const hasContent = value && value !== 'Text not found' && value.length > 0;
            sectionStatus[key] = hasContent ? `${value.length} chars` : 'No content';
        });

        return JSON.stringify(parsedJson, null, 2); // Return formatted JSON string
    } catch (parseError) {
        console.error("Failed to parse JSON response:", parseError);
        console.error("Raw response:", jsonResponse);
        throw new Error(`Invalid JSON response from OpenAI: ${parseError.message}`);
    }
}

//Function to accept the pdf buffer and return the json
exports.convertPdfToJsonBuffer = async (pdfBuffer) => {
    try {
        const pdfText = await extractPdfText(pdfBuffer);
        const json = await convertPdfToJson(pdfText);
        return json;
    } catch (err) {
        console.error("Error:", err);
        throw err;
    }
};

exports.convertPdfToJsonFile = async (pdfFile, abortSignal = null) => {
    try {
        const pdfText = await extractPdfText(pdfFile);
        const json = await convertPdfToJson(pdfText, abortSignal);
        return json;
    } catch (err) {
        console.error("Error:", err);
        throw err;
    }
};