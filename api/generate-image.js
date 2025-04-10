// api/generate-image.js
import { HfInference } from "@huggingface/inference";

// IMPORTANT: Your Hugging Face Token MUST be set as an Environment Variable
// in Vercel named HF_TOKEN. It is read via process.env.HF_TOKEN below.
const HF_ACCESS_TOKEN = process.env.HF_TOKEN;

// Default model if none is specified by the frontend
// You can change this to your preferred default
const DEFAULT_MODEL = "runwayml/stable-diffusion-v1-5";

// --- CORS Configuration ---
// This MUST be the URL where your HBS GitHub Pages site is hosted.
const allowedOrigin = 'https://deprived999x.github.io';
// -------------------------


export default async function handler(req, res) {
    // --- Set CORS Headers ---
    // Allows requests from your specific GitHub Pages site
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    // Allows the browser to make complex requests (like POST with JSON)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    // Allows the browser to send the 'Content-Type' header
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // --- Handle Browser Preflight (OPTIONS request) ---
    // Browsers send this before a POST request to check CORS permissions
    if (req.method === 'OPTIONS') {
        console.log("Responding to OPTIONS request");
        return res.status(200).end(); // Respond OK to allow the actual POST
    }

    // --- Handle Actual Request (POST) ---
    // Only allow POST requests for generating images
    if (req.method !== 'POST') {
        console.log(`Method Not Allowed: ${req.method}`);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Check if the secret API key is configured on Vercel
    if (!HF_ACCESS_TOKEN) {
        console.error("CRITICAL: HF_TOKEN environment variable not set on Vercel.");
        return res.status(500).json({ error: 'Server configuration error. API token missing.' });
    }

    // Get prompt and optional modelId from the request body sent by the frontend
    const { prompt, modelId } = req.body;

    // Check if prompt was provided
    if (!prompt) {
        console.log("Bad Request: Prompt is missing from request body.");
        return res.status(400).json({ error: 'Prompt is required' });
    }

    // Determine which model to use (frontend choice or default)
    const effectiveModel = modelId || DEFAULT_MODEL;
    const promptUsedForLog = prompt.substring(0, 70); // For cleaner logs

    try {
        // Initialize the Hugging Face client
        const inference = new HfInference(HF_ACCESS_TOKEN);
        console.log(`[Proxy] Requesting image for model: ${effectiveModel}, prompt: "${promptUsedForLog}..."`);

        // Call the Hugging Face textToImage API
        const imageBlob = await inference.textToImage({
            model: effectiveModel,
            inputs: prompt,
            parameters: {} // Parameters object is now empty (removed negative_prompt)
        });

        console.log(`[Proxy] Response received from Hugging Face for prompt: "${promptUsedForLog}..."`);

        // Check if Hugging Face returned an error JSON instead of an image
        if (imageBlob.type.startsWith('application/json')) {
             const errorText = await imageBlob.text();
             console.error(`[Proxy] Hugging Face API returned an error JSON: ${errorText}`);
             let errorMessage = 'Hugging Face API error.';
             try {
                 // Try parsing the error message from HF
                 const errorJson = JSON.parse(errorText);
                 errorMessage = errorJson.error || errorMessage;
                 // Add specific message if model is loading
                 if (errorJson.estimated_time) {
                     errorMessage += ` Model (${effectiveModel}) may be loading (est: ${errorJson.estimated_time.toFixed(1)}s). Try again shortly.`;
                 }
             } catch(e) { /* Ignore parsing error, use default errorMessage */ }

             // Send a 503 status if it's a loading issue, otherwise 500
             const statusCode = errorMessage.includes('loading') ? 503 : 500;
             return res.status(statusCode).json({ error: errorMessage, promptUsed: prompt });
        }

        // If we got here, it should be an image Blob
        // Convert the image Blob to a base64 string
        const arrayBuffer = await imageBlob.arrayBuffer();
        const base64String = Buffer.from(arrayBuffer).toString('base64');

        console.log(`[Proxy] Successfully generated image, sending base64 data back to client for prompt: "${promptUsedForLog}..."`);

        // Send the successful response back to the frontend
        res.status(200).json({ imageData: base64String });

    } catch (error) {
        // Catch any unexpected errors during the process
        console.error('[Proxy] Unexpected error processing request:', error);
        const errorMessage = error.message || 'Unknown server error during image generation';
        res.status(500).json({
            error: `Failed to generate image: ${errorMessage}`,
            promptUsed: prompt // Include prompt for debugging on client-side
        });
    }
}
