
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Subtitle } from "../types";

export const processVideoWithAI = async (
  audioBase64: string,
  onProgress: (msg: string) => void
): Promise<Subtitle[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  onProgress("Using Gemini to analyze audio and generate exhaustive bilingual subtitles...");

  const prompt = `
    TASK: Exhaustive Bilingual Transcription & Translation.
    1. Listen to the entire audio carefully from START TO FINISH.
    2. Identify EVERY spoken English sentence or phrase. 
    3. CRITICAL: Do not truncate the output. You MUST provide the full transcription for the entire duration of the provided audio, even if it is long.
    4. For each segment, provide the exact English transcription.
    5. Provide a high-quality Simplified Chinese translation for each segment.
    6. Ensure timestamps (HH:MM:SS,mmm) are perfectly synchronized with the speech.
    7. Maintain a continuous timeline in the JSON array.

    Output the result as a JSON array of objects with the following structure:
    {
      "index": number,
      "startTime": "HH:MM:SS,mmm",
      "endTime": "HH:MM:SS,mmm",
      "originalText": "Full English transcription",
      "translatedText": "Simplified Chinese translation"
    }
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "audio/wav",
                data: audioBase64
              }
            }
          ]
        }
      ],
      config: {
        // Increase output tokens to accommodate longer subtitle lists for long videos.
        maxOutputTokens: 8192,
        // Use thinking budget to help the model plan out the entire timeline accurately.
        thinkingConfig: { thinkingBudget: 4000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              startTime: { type: Type.STRING },
              endTime: { type: Type.STRING },
              originalText: { type: Type.STRING },
              translatedText: { type: Type.STRING }
            },
            required: ["index", "startTime", "endTime", "originalText", "translatedText"]
          }
        }
      }
    });

    if (!response.text) {
      throw new Error("EMPTY_RESPONSE");
    }

    const jsonStr = response.text.trim();
    const rawSubs = JSON.parse(jsonStr) as any[];
    
    // Check if the list seems cut off (e.g., ends way before the end of audio)
    // In a real production app, we might trigger a recursive call here for the remaining duration.

    const processed = rawSubs.map(sub => ({
      ...sub,
      startSeconds: parseSRTTime(sub.startTime),
      endSeconds: parseSRTTime(sub.endTime)
    }));

    return processed.sort((a, b) => a.startSeconds - b.startSeconds);
  } catch (error: any) {
    console.error("Gemini Error Detail:", error);
    
    if (error.message?.includes("fetch")) {
      throw new Error("Network error: Please check your internet connection.");
    }
    if (error.message?.includes("429")) {
      throw new Error("Rate limit exceeded: Please wait a moment before trying again.");
    }
    if (error.message?.includes("SAFETY")) {
      throw new Error("Content filtered: The AI cannot process this audio due to safety guidelines.");
    }
    if (error.message === "EMPTY_RESPONSE") {
      throw new Error("Processing failed: No speech was detected or identified in the audio.");
    }
    
    throw new Error(`AI Analysis Error: ${error.message || "An unexpected error occurred during processing."}`);
  }
};

const parseSRTTime = (timeStr: string): number => {
  const parts = timeStr.replace(',', '.').split(':');
  const seconds = parseFloat(parts[parts.length - 1]);
  const minutes = parseInt(parts[parts.length - 2] || "0");
  const hours = parseInt(parts[parts.length - 3] || "0");
  return hours * 3600 + minutes * 60 + seconds;
};
