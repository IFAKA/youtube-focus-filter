import { OllamaClient } from './lib/ollama.js';
import { getCachedDecision, setCachedDecision, clearExpiredCache, getStats } from './lib/cache.js';

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  goals: 'I want to learn programming, improve my skills, and stay productive. Block entertainment, drama, gossip, and time-wasting content.',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  whitelistedChannels: [],
  blacklistedChannels: []
};

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
      return { settings };

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
      const healthy = await ollamaClient.checkHealth();
      return { healthy };

    case 'GET_STATS':
      const stats = await getStats();
      return { stats };

    case 'CLEAR_CACHE':
      await clearExpiredCache();
      return { success: true };

    case 'GOALS_CHANGED':
      // Clear all cache since goals changed
      const { clearAllCache } = await import('./lib/cache.js');
      await clearAllCache();

      // Notify all YouTube tabs to re-process
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'REPROCESS_VIDEOS' }).catch(() => {});
      }
      return { success: true, tabsNotified: tabs.length };

    default:
      return { error: 'Unknown message type' };
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
