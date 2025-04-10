// api/generate-image.js
import { HfInference } from "@huggingface/inference";

// IMPORTANT: Set your Hugging Face Token as an Environment Variable in Vercel
// named HF_TOKEN later in the Vercel dashboard. DO NOT PASTE IT HERE.
const HF_ACCESS_TOKEN = process.env.HF_TOKEN;

// Default model if none is specified by the frontend
// You can change this to your preferred default, e.g., "stabilityai/stable-diffusion-xl-base-1.0"
const DEFAULT_MODEL = "runwayml/stable-diffusion-v1-5";

export default async function handler(req, res) {
    // --- CORS Headers ---
    // IMPORTANT: Replace this placeholder with YOUR GitHub Pages URL!
    const allowedOrigin = 'https://deprived999x.github.io'; // <--- CHANGE THIS LINE!

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        console.log("Responding to OPTIONS request");
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        console.log(`Method Not Allowed: ${req.method}`);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Check if API key is configured on Vercel
    if (!HF_ACCESS_TOKEN) {
        console.error("HF_TOKEN environment variable not set on Vercel.");
        return res.status(500).json({ error: 'Server configuration error. API token missing.' });
    }

    // Get prompt and optional modelId from request body
    const { prompt, modelId } = req.body;

    if (!prompt) {
        console.log("Bad Request: Prompt is missing.");
        return res.status(400).json({ error: 'Prompt is required' });
    }

    // Use the model requested by frontend, or fallback to default
    const effectiveModel = modelId || DEFAULT_MODEL;

    try {
        const inference = new HfInference(HF_ACCESS_TOKEN);
        console.log(`[Proxy] Received request for model: ${effectiveModel}, prompt: "${prompt.substring(0, 50)}..."`);

        // Call the Hugging Face API
        const imageBlob = await inference.textToImage({
            model: effectiveModel,
            inputs: prompt,
            parameters: { // Optional: Add negative prompts or other parameters if needed
                negative_prompt: 'blurry, ugly, deformed, low quality, text, words, letters, watermark, signature',
                // width: 512, // Some models might need explicit sizes
                // height: 512,
            }
        });

        console.log("[Proxy] Image Blob received from Hugging Face.");

        // Check if the response is actually JSON (which indicates an error from HF)
        if (imageBlob.type.startsWith('application/json')) {
             const errorText = await imageBlob.text();
             console.error(`[Proxy] Hugging Face API returned an error: ${errorText}`);
             let errorMessage = 'Hugging Face API error.';
             try {
                 const errorJson = JSON.parse(errorText);
                 errorMessage = errorJson.error || errorMessage;
                 if (errorJson.estimated_time) {
                     errorMessage += ` Model may be loading (estimated time: ${errorJson.estimated_time.toFixed(1)}s). Try again shortly.`;
                 }
             } catch(e) { /* Ignore parsing error, use default */ }
             // Send a 503 if it's potentially a loading issue, otherwise 500
             const statusCode = errorMessage.includes('loading') ? 503 : 500;
             return res.status(statusCode).json({ error: errorMessage, promptUsed: prompt });
        }

        // Convert Blob to base64 string to send back as JSON
        const arrayBuffer = await imageBlob.arrayBuffer();
        const base64String = Buffer.from(arrayBuffer).toString('base64');

        console.log("[Proxy] Sending base64 image data back to client.");
        // Send the base64 data back to your frontend
        res.status(200).json({ imageData: base64String });

    } catch (error) {
        console.error('[Proxy] Error processing request:', error);
        const errorMessage = error.message || 'Unknown error during image generation';
        res.status(500).json({
            error: `Failed to generate image: ${errorMessage}`,
            promptUsed: prompt // Include prompt for debugging on client-side
        });
    }
}