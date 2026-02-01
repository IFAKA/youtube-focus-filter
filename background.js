import { OllamaClient } from './lib/ollama.js';
import { getCachedDecision, setCachedDecision, clearExpiredCache, getStats, clearAllCache } from './lib/cache.js';

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  strictMode: false,
  goals: '',
  activeProfileId: null,
  profiles: [],
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  whitelistedChannels: [],
  blacklistedChannels: []
};

// Starter templates (shown when no profiles exist)
const STARTER_TEMPLATES = [
  { name: 'Learning', goals: 'Learning and self-improvement. Allow: educational videos, documentaries, tutorials, lectures, skill-building, science, history. Block: drama, gossip, reaction videos, pranks, clickbait, celebrity news, political rants.' },
  { name: 'Coding', goals: 'Software development and tech. Allow: programming tutorials, system design, tech talks, CS concepts, developer tools, startup advice. Block: gaming, vlogs, drama, unboxings, entertainment, reaction content.' },
  { name: 'Fitness', goals: 'Health and fitness. Allow: workouts, exercise tutorials, nutrition science, sports technique, physical therapy, mobility. Block: mukbangs, junk food, sedentary entertainment, drama, gossip.' },
  { name: 'Music', goals: 'Music learning and production. Allow: music theory, instrument tutorials, production techniques, song analysis, ear training. Block: drama, gossip, celebrity news, reaction videos, pranks.' }
];

let settings = { ...DEFAULT_SETTINGS };
let ollamaClient = null;

// Initialize
async function init() {
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }

  ollamaClient = new OllamaClient({
    baseUrl: settings.ollamaUrl,
    model: settings.ollamaModel
  });

  // Clear expired cache on startup
  clearExpiredCache().catch(console.error);
}

init();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'EVALUATE_VIDEOS':
      return evaluateVideos(message.videos);

    case 'GET_SETTINGS':
      return { settings, starterTemplates: STARTER_TEMPLATES };

    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.settings };
      await chrome.storage.local.set({ settings });

      // Reinitialize client if URL/model changed
      ollamaClient = new OllamaClient({
        baseUrl: settings.ollamaUrl,
        model: settings.ollamaModel
      });

      return { success: true };

    case 'CHECK_HEALTH':
      const healthResult = await ollamaClient.checkHealth();
      return healthResult;

    case 'GET_STATS':
      const stats = await getStats();
      return { stats };

    case 'CLEAR_CACHE':
      await clearExpiredCache();
      return { success: true };

    case 'GOALS_CHANGED':
      // Clear all cache since goals changed
      await clearAllCache();

      // Notify all YouTube tabs to re-process
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'REPROCESS_VIDEOS' }).catch(() => {});
      }
      return { success: true, tabsNotified: tabs.length };

    case 'STRICT_MODE_CHANGED':
      // Notify all YouTube tabs to update strict mode display
      const ytTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      for (const tab of ytTabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_STRICT_MODE', strictMode: settings.strictMode }).catch(() => {});
      }
      return { success: true };

    case 'GENERATE_PROFILE_NAME':
      return generateProfileName(message.goals);

    default:
      return { error: 'Unknown message type' };
  }
}

async function generateProfileName(goals) {
  if (!goals || !ollamaClient) {
    return { error: 'No goals provided' };
  }

  try {
    const prompt = `Generate a short profile name (1-3 words, max 20 characters) for this focus profile:

"${goals.slice(0, 500)}"

Reply with ONLY the profile name, nothing else. Examples: "Web Dev", "Fitness", "Music Production", "Data Science"`;

    const response = await ollamaClient.generate(prompt, { maxTokens: 20 });
    const name = response.trim().replace(/["']/g, '').slice(0, 25);
    return { name };
  } catch (error) {
    console.error('Failed to generate profile name:', error);
    return { error: error.message };
  }
}

async function evaluateVideos(videos) {
  if (!settings.enabled) {
    return { decisions: videos.map(v => ({ videoId: v.videoId, decision: 'ALLOW' })) };
  }

  const decisions = [];
  const toEvaluate = [];

  // Check cache and channel lists first
  for (const video of videos) {
    // Check whitelist
    if (settings.whitelistedChannels.some(c =>
      video.channel.toLowerCase().includes(c.toLowerCase())
    )) {
      decisions.push({ videoId: video.videoId, decision: 'ALLOW', source: 'whitelist' });
      continue;
    }

    // Check blacklist
    if (settings.blacklistedChannels.some(c =>
      video.channel.toLowerCase().includes(c.toLowerCase())
    )) {
      decisions.push({ videoId: video.videoId, decision: 'BLOCK', source: 'blacklist' });
      continue;
    }

    // Check cache
    const cached = await getCachedDecision(video.videoId);
    if (cached) {
      decisions.push({ ...cached, source: 'cache' });
      continue;
    }

    toEvaluate.push(video);
  }

  // Evaluate remaining videos with LLM
  if (toEvaluate.length > 0 && settings.goals) {
    try {
      const llmResults = await ollamaClient.evaluateVideos(toEvaluate, settings.goals);

      for (const result of llmResults) {
        await setCachedDecision(result);
        decisions.push({ ...result, source: 'llm' });
      }
    } catch (error) {
      console.error('LLM evaluation failed:', error);
      // Default to ALLOW on error
      for (const video of toEvaluate) {
        decisions.push({ videoId: video.videoId, decision: 'ALLOW', source: 'error' });
      }
    }
  }

  return { decisions };
}
