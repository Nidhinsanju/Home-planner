import { HfInference } from '@huggingface/inference';

export interface AIRequest {
  projectId: string;
  message: string;
  context: any; // The current building state
}

export interface AIResponse {
  success: boolean;
  message: string;
  operations: any[];
}

export interface AIProvider {
  generateResponse(input: AIRequest): Promise<AIResponse>;
}

export class HuggingFaceProvider implements AIProvider {
  private hf: HfInference;
  private model: string;

  constructor() {
    const token = process.env.HF_TOKEN;
    this.hf = new HfInference(token);
    this.model = process.env.AI_MODEL || 'meta-llama/Llama-3.3-70B-Instruct'; // A solid JSON/tool calling model
  }

  async generateResponse(input: AIRequest): Promise<AIResponse> {
    const systemPrompt = `You are an AI architect and home planner. 
You are given the current state of a building and a user request.
You must output a JSON object with a list of building operations to satisfy the request.

Available operations:
{ "type": "RESIZE_ROOM", "payload": { "roomId": "...", "width": number, "depth": number } }
{ "type": "CREATE_ROOM", "payload": { "id": "...", "type": "...", "name": "...", "x": number, "y": number, "width": number, "depth": number } }
{ "type": "MOVE_ROOM", "payload": { "roomId": "...", "x": number, "y": number } }

Constraints:
Only output valid JSON matching this schema:
{
  "message": "A friendly message explaining what you did",
  "operations": [ ... ]
}`;

    const prompt = `Current Building State: ${JSON.stringify(input.context)}
User Request: ${input.message}`;

    const response = await this.hf.chatCompletion({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    try {
      const content = response.choices[0].message.content;
      if (!content) throw new Error("Empty response from AI");
      const parsed = JSON.parse(content);
      return {
        success: true,
        message: parsed.message || "Operations generated",
        operations: parsed.operations || []
      };
    } catch (e: any) {
      console.error("Failed to parse AI response:", e);
      return {
        success: false,
        message: "Failed to generate valid operations",
        operations: []
      };
    }
  }
}
