// Ollama client for video classification
export class OllamaClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'llama3.2:3b';
  }

  async checkHealth() {
    try {
      // First check if Ollama is running and get available models
      const tagsResponse = await fetch(`${this.baseUrl}/api/tags`);
      if (!tagsResponse.ok) return { healthy: false, error: 'Ollama not responding' };

      const data = await tagsResponse.json();
      const models = data.models || [];
      const modelNames = models.map(m => m.name);

      // Check if our configured model is available
      const hasModel = modelNames.some(name =>
        name === this.model || name.startsWith(this.model + ':')
      );

      if (!hasModel) {
        return {
          healthy: false,
          error: `Model "${this.model}" not found`,
          availableModels: modelNames.slice(0, 5)
        };
      }

      // Test that we can actually make generate requests (CORS check)
      const testResponse = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: 'test',
          stream: false,
          options: { num_predict: 1 }
        })
      });

      if (testResponse.status === 403) {
        return {
          healthy: false,
          error: 'CORS blocked. Restart Ollama with: OLLAMA_ORIGINS=* ollama serve'
        };
      }

      if (!testResponse.ok) {
        return {
          healthy: false,
          error: `Model error (${testResponse.status})`
        };
      }

      return { healthy: true, model: this.model };
    } catch (err) {
      if (err.message?.includes('Failed to fetch')) {
        return { healthy: false, error: 'Cannot connect to Ollama' };
      }
      return { healthy: false, error: err.message || 'Connection error' };
    }
  }

  async generate(prompt, options = {}) {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 50
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return data.response.trim();
  }

  buildPrompt(videoMetadata, userGoals) {
    const channel = videoMetadata.channel || 'Unknown';
    const desc = videoMetadata.description ? `\nDescription snippet: ${videoMetadata.description.slice(0, 150)}` : '';

    return `You filter YouTube videos. Be strict but fair.

USER'S FOCUS: ${userGoals}

VIDEO: "${videoMetadata.title}" by ${channel}${desc}

RULES:
- BLOCK if clearly entertainment, drama, gossip, clickbait, or time-wasting
- BLOCK if unrelated to user's focus AND not educational
- ALLOW if educational, informative, or skill-building (even if tangentially related)
- ALLOW if ambiguous or uncertain - don't over-block
- ALLOW tutorials, documentaries, lectures, how-tos
- Judge by title intent, not just keywords

Reply with one word: ALLOW or BLOCK`;
  }

  async evaluateVideo(videoMetadata, userGoals) {
    const prompt = this.buildPrompt(videoMetadata, userGoals);

    try {
      const response = await this.generate(prompt);
      const decision = response.toUpperCase().includes('ALLOW') ? 'ALLOW' : 'BLOCK';

      return {
        decision,
        videoId: videoMetadata.videoId,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Ollama evaluation error:', error);
      // Default to ALLOW on error to avoid hiding content unintentionally
      return {
        decision: 'ALLOW',
        videoId: videoMetadata.videoId,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async evaluateVideos(videos, userGoals) {
    // Process videos in parallel with concurrency limit
    const results = [];
    const batchSize = 5;

    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(video => this.evaluateVideo(video, userGoals))
      );
      results.push(...batchResults);
    }

    return results;
  }
}
