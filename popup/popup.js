// Popup script
document.addEventListener('DOMContentLoaded', init);

const PRESETS = {
  learning: 'Learning and self-improvement. Allow: educational videos, documentaries, tutorials, lectures, skill-building, science, history. Block: drama, gossip, reaction videos, pranks, clickbait, celebrity news, political rants.',
  coding: 'Software development and tech. Allow: programming tutorials, system design, tech talks, CS concepts, developer tools, startup advice. Block: gaming, vlogs, drama, unboxings, entertainment, reaction content.',
  fitness: 'Health and fitness. Allow: workouts, exercise tutorials, nutrition science, sports technique, physical therapy, mobility. Block: mukbangs, junk food, sedentary entertainment, drama, gossip.',
  music: 'Music learning and production. Allow: music theory, instrument tutorials, production techniques, song analysis, ear training. Block: drama, gossip, celebrity news, reaction videos, pranks.'
};

async function init() {
  await loadSettings();
  await checkConnection();
  await loadStats();
  setupEventListeners();
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const settings = response.settings;

    document.getElementById('enableToggle').checked = settings.enabled;
    document.getElementById('statusText').textContent = settings.enabled ? 'Enabled' : 'Disabled';
    document.getElementById('goalsInput').value = settings.goals || '';
    document.getElementById('ollamaUrl').value = settings.ollamaUrl || 'http://localhost:11434';
    document.getElementById('ollamaModel').value = settings.ollamaModel || 'llama3.2:3b';
    document.getElementById('whitelistedChannels').value = (settings.whitelistedChannels || []).join('\n');
    document.getElementById('blacklistedChannels').value = (settings.blacklistedChannels || []).join('\n');
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function checkConnection() {
  const statusEl = document.getElementById('connectionStatus');
  const textEl = statusEl.querySelector('.status-text');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' });

    if (response.healthy) {
      statusEl.className = 'status connected';
      textEl.textContent = `Connected (${response.model})`;
    } else if (response.error) {
      statusEl.className = 'status disconnected';
      if (response.availableModels && response.availableModels.length > 0) {
        textEl.textContent = `${response.error}. Try: ${response.availableModels[0]}`;
      } else if (response.error.includes('not found')) {
        textEl.textContent = `${response.error}. Run: ollama pull ${document.getElementById('ollamaModel').value}`;
      } else {
        textEl.textContent = response.error + ' - run: ollama serve';
      }
    } else {
      statusEl.className = 'status disconnected';
      textEl.textContent = 'Ollama not running - start with: ollama serve';
    }
  } catch (error) {
    statusEl.className = 'status disconnected';
    textEl.textContent = 'Connection error';
  }
}

async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    const stats = response.stats;

    document.getElementById('todayBlocked').textContent = stats.today.blocked;
    document.getElementById('todayTotal').textContent = stats.today.total;
    document.getElementById('totalCached').textContent = stats.total;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function setupEventListeners() {
  // Enable toggle
  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    document.getElementById('statusText').textContent = enabled ? 'Enabled' : 'Disabled';

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { enabled }
    });

    // If re-enabling, trigger re-processing
    if (enabled) {
      await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
    }
  });

  // Save goals
  document.getElementById('saveGoals').addEventListener('click', async () => {
    const goals = document.getElementById('goalsInput').value.trim();
    const currentGoals = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })).settings?.goals || '';

    // Check if goals actually changed
    const goalsChanged = goals !== currentGoals;

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { goals }
    });

    // If goals changed, clear cache and re-filter
    if (goalsChanged) {
      await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
      showSaveConfirmation(document.getElementById('saveGoals'), 'Saved! Re-filtering...');
    } else {
      showSaveConfirmation(document.getElementById('saveGoals'), 'Saved!');
    }
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (PRESETS[preset]) {
        document.getElementById('goalsInput').value = PRESETS[preset];
      }
    });
  });

  // Clear cache button
  document.getElementById('clearCache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
    showSaveConfirmation(document.getElementById('clearCache'), 'Cleared! Reloading...');
    await loadStats();
  });

  // Save advanced settings
  document.getElementById('saveAdvanced').addEventListener('click', async () => {
    const ollamaUrl = document.getElementById('ollamaUrl').value.trim();
    const ollamaModel = document.getElementById('ollamaModel').value.trim();
    const whitelistedChannels = document.getElementById('whitelistedChannels').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    const blacklistedChannels = document.getElementById('blacklistedChannels').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: {
        ollamaUrl,
        ollamaModel,
        whitelistedChannels,
        blacklistedChannels
      }
    });

    showSaveConfirmation(document.getElementById('saveAdvanced'));
    await checkConnection();
  });
}

function showSaveConfirmation(button, message = 'Saved!') {
  const originalText = button.textContent;
  button.textContent = message;
  button.style.background = '#22c55e';

  setTimeout(() => {
    button.textContent = originalText;
    button.style.background = '';
  }, 1500);
}
