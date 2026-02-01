// Popup script
document.addEventListener('DOMContentLoaded', init);

let settings = {};
let starterTemplates = [];
let isOllamaConnected = false;

async function init() {
  setupTabs();
  await loadSettings();
  await checkConnection();
  await loadStats();
  renderProfiles();
  setupEventListeners();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.querySelector(`.tab-content[data-tab="${target}"]`).classList.add('active');

      localStorage.setItem('ytff_activeTab', target);
    });
  });

  // Restore last active tab, or go to Focus on first run
  const isFirstRun = !localStorage.getItem('ytff_activeTab');
  const saved = localStorage.getItem('ytff_activeTab') || 'home';
  const savedTab = document.querySelector(`.tab-btn[data-tab="${saved}"]`);
  if (savedTab) {
    savedTab.click();
  }

  // On first run with no profiles, navigate to Focus tab
  if (isFirstRun) {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(response => {
        if (!response.settings.profiles || response.settings.profiles.length === 0) {
          document.querySelector('.tab-btn[data-tab="focus"]')?.click();
        }
      });
    }, 100);
  }
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    settings = response.settings;
    starterTemplates = response.starterTemplates || [];

    document.getElementById('enableToggle').checked = settings.enabled;
    document.getElementById('strictModeToggle').checked = settings.strictMode || false;
    document.getElementById('ollamaUrl').value = settings.ollamaUrl || 'http://localhost:11434';
    document.getElementById('ollamaModel').value = settings.ollamaModel || 'llama3.2:3b';
    document.getElementById('whitelistedChannels').value = (settings.whitelistedChannels || []).join('\n');
    document.getElementById('blacklistedChannels').value = (settings.blacklistedChannels || []).join('\n');

    // Load active profile or show empty state
    loadActiveProfile();
    updateActiveProfileCard();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

function loadActiveProfile() {
  const activeProfile = settings.profiles?.find(p => p.id === settings.activeProfileId);

  if (activeProfile) {
    document.getElementById('goalsInput').value = activeProfile.goals;
    document.getElementById('profileNameInput').value = activeProfile.name;
    document.getElementById('goalsTitle').textContent = 'Edit Profile';
    document.getElementById('deleteProfileBtn').style.display = 'flex';
  } else {
    document.getElementById('goalsInput').value = settings.goals || '';
    document.getElementById('profileNameInput').value = '';
    document.getElementById('goalsTitle').textContent = 'New Profile';
    document.getElementById('deleteProfileBtn').style.display = 'none';
  }
}

function updateActiveProfileCard() {
  const activeProfile = settings.profiles?.find(p => p.id === settings.activeProfileId);
  const card = document.getElementById('activeProfileCard');
  const nameEl = document.getElementById('activeProfileName');

  if (activeProfile) {
    card.style.display = 'block';
    nameEl.textContent = activeProfile.name;
  } else {
    card.style.display = 'none';
  }
}

function renderProfiles() {
  const listEl = document.getElementById('profilesList');
  const templatesSection = document.getElementById('starterTemplates');
  const templatesGrid = document.getElementById('templatesGrid');

  const profiles = settings.profiles || [];

  // Render profile list
  if (profiles.length === 0) {
    listEl.innerHTML = '';

    // Show starter templates with onboarding guidance
    templatesSection.style.display = 'block';
    templatesGrid.innerHTML = `
      <div class="onboarding">
        <div class="onboarding__step">
          <span class="onboarding__number">1</span>
          <span class="onboarding__text">Pick a template or write your own goals below</span>
        </div>
        <div class="templates-row">
          ${starterTemplates.map(t =>
            `<button class="template-btn" data-template="${t.name}">${t.name}</button>`
          ).join('')}
        </div>
        <div class="onboarding__step">
          <span class="onboarding__number">2</span>
          <span class="onboarding__text">Click Save to start filtering</span>
        </div>
      </div>
    `;
  } else {
    listEl.innerHTML = profiles.map(p => `
      <div class="profile-item ${p.id === settings.activeProfileId ? 'active' : ''}" data-id="${p.id}">
        <span class="profile-item__name">${escapeHtml(p.name)}</span>
        <span class="profile-item__check">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </span>
      </div>
    `).join('');

    templatesSection.style.display = 'none';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

async function saveSettings(updates) {
  settings = { ...settings, ...updates };
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: updates
  });
}

async function checkConnection() {
  const statusEl = document.getElementById('connectionStatus');
  const statusText = statusEl.querySelector('.connection-card__status');
  const detailText = statusEl.querySelector('.connection-card__detail');
  const iconEl = statusEl.querySelector('.connection-card__icon');

  // Update icon based on state
  const icons = {
    checking: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',
    connected: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    disconnected: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'
  };

  iconEl.innerHTML = icons.checking;
  statusEl.className = 'connection-card';
  statusText.textContent = 'Checking connection...';
  detailText.textContent = '';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' });

    if (response.healthy) {
      isOllamaConnected = true;
      statusEl.className = 'connection-card connected';
      iconEl.innerHTML = icons.connected;
      statusText.textContent = 'Connected';
      detailText.textContent = response.model;
      updateFocusTabConnectionWarning();
    } else if (response.error) {
      isOllamaConnected = false;
      statusEl.className = 'connection-card disconnected';
      iconEl.innerHTML = icons.disconnected;
      statusText.textContent = 'Connection failed';

      if (response.availableModels && response.availableModels.length > 0) {
        detailText.textContent = `Model not found. Try: ${response.availableModels[0]}`;
      } else if (response.error.includes('not found')) {
        detailText.textContent = `Run: ollama pull ${document.getElementById('ollamaModel').value}`;
      } else {
        detailText.textContent = 'Run: ollama serve';
      }
      updateFocusTabConnectionWarning();
    } else {
      isOllamaConnected = false;
      statusEl.className = 'connection-card disconnected';
      iconEl.innerHTML = icons.disconnected;
      statusText.textContent = 'Ollama not running';
      detailText.textContent = 'Run: ollama serve';
      updateFocusTabConnectionWarning();
    }
  } catch (error) {
    isOllamaConnected = false;
    statusEl.className = 'connection-card disconnected';
    iconEl.innerHTML = icons.disconnected;
    statusText.textContent = 'Connection error';
    detailText.textContent = 'Try reloading the extension';
    updateFocusTabConnectionWarning();
  }
}

function updateFocusTabConnectionWarning() {
  const existingWarning = document.getElementById('focusConnectionWarning');

  if (!isOllamaConnected) {
    if (!existingWarning) {
      const warning = document.createElement('div');
      warning.id = 'focusConnectionWarning';
      warning.className = 'focus-connection-warning';
      warning.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span>Ollama not connected</span>
        <button class="focus-connection-warning__btn" id="goToSettingsBtn">Setup</button>
      `;
      const focusTab = document.querySelector('.tab-content[data-tab="focus"]');
      focusTab.insertBefore(warning, focusTab.firstChild);

      document.getElementById('goToSettingsBtn').addEventListener('click', () => {
        document.querySelector('.tab-btn[data-tab="settings"]').click();
      });
    }
  } else {
    existingWarning?.remove();
  }
}

async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    const stats = response.stats;

    // Update stats tab
    document.getElementById('todayFocused').textContent = stats.today.focused;
    document.getElementById('todayBlocked').textContent = stats.today.blocked;
    document.getElementById('todayTotal').textContent = stats.today.total;
    document.getElementById('totalCached').textContent = stats.total;

    // Update home tab quick stats
    document.getElementById('homeStatFocused').textContent = stats.today.focused;
    document.getElementById('homeStatBlocked').textContent = stats.today.blocked;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function setupEventListeners() {
  // Enable toggle
  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await saveSettings({ enabled });

    if (enabled) {
      await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
      showToast('Filter enabled');
    } else {
      showToast('Filter paused');
    }
  });

  // Strict mode toggle
  document.getElementById('strictModeToggle').addEventListener('change', async (e) => {
    const strictMode = e.target.checked;
    await saveSettings({ strictMode });
    await chrome.runtime.sendMessage({ type: 'STRICT_MODE_CHANGED' });
    showToast(strictMode ? 'Strict mode on' : 'Strict mode off');
  });

  // Strict mode info button
  document.getElementById('strictModeInfo').addEventListener('click', (e) => {
    e.preventDefault();
    showInfoDialog('How Filtering Works', `
      <div class="info-list">
        <div class="info-item info-item--focus">
          <strong>FOCUS</strong> — Directly helps your goals<br>
          <span class="info-example">Always shown (highlighted with gold border)</span>
        </div>
        <div class="info-item info-item--allow">
          <strong>ALLOW</strong> — Not distracting, but not directly relevant<br>
          <span class="info-example">Hidden in Strict Mode</span>
        </div>
        <div class="info-item info-item--block">
          <strong>BLOCK</strong> — Distracting content<br>
          <span class="info-example">Always hidden</span>
        </div>
      </div>
    `);
  });

  // Profile list click
  document.getElementById('profilesList').addEventListener('click', async (e) => {
    const profileItem = e.target.closest('.profile-item');
    if (!profileItem) return;

    const profileId = profileItem.dataset.id;
    await selectProfile(profileId);
  });

  // Template buttons
  document.getElementById('templatesGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('.template-btn');
    if (!btn) return;

    const templateName = btn.dataset.template;
    const template = starterTemplates.find(t => t.name === templateName);
    if (template) {
      await createProfileFromTemplate(template);
    }
  });

  // New profile button
  document.getElementById('newProfileBtn').addEventListener('click', () => {
    settings.activeProfileId = null;
    document.getElementById('goalsInput').value = '';
    document.getElementById('profileNameInput').value = '';
    document.getElementById('goalsTitle').textContent = 'New Profile';
    document.getElementById('deleteProfileBtn').style.display = 'none';
    renderProfiles();
    document.getElementById('profileNameInput').focus();
  });

  // Generate name with AI button
  document.getElementById('generateNameBtn').addEventListener('click', async () => {
    const goals = document.getElementById('goalsInput').value.trim();
    if (!goals) {
      showToast('Enter goals first', 'error');
      return;
    }

    const btn = document.getElementById('generateNameBtn');
    btn.classList.add('loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_PROFILE_NAME',
        goals
      });

      if (response.name) {
        document.getElementById('profileNameInput').value = response.name;
      } else if (response.error) {
        showToast('Failed to generate', 'error');
      }
    } catch (error) {
      showToast('Connection error', 'error');
    } finally {
      btn.classList.remove('loading');
    }
  });

  // Save goals button
  document.getElementById('saveGoals').addEventListener('click', async () => {
    const goals = document.getElementById('goalsInput').value.trim();
    const name = document.getElementById('profileNameInput').value.trim() || 'Untitled';

    if (!goals) {
      showToast('Please enter your goals', 'error');
      return;
    }

    if (!isOllamaConnected) {
      showToast('Connect Ollama first (see Settings)', 'error');
      return;
    }

    if (settings.activeProfileId) {
      // Update existing profile
      await updateProfile(settings.activeProfileId, name, goals);
    } else {
      // Create new profile
      await createProfile(name, goals);
    }
  });

  // Delete profile button
  document.getElementById('deleteProfileBtn').addEventListener('click', () => {
    const activeProfile = settings.profiles?.find(p => p.id === settings.activeProfileId);
    if (activeProfile) {
      showConfirmDialog(
        'Delete Profile',
        `Are you sure you want to delete "${activeProfile.name}"?`,
        async () => {
          await deleteProfile(settings.activeProfileId);
        }
      );
    }
  });

  // Clear cache button
  document.getElementById('clearCache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
    showToast('Cache cleared', 'success');
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

    await saveSettings({
      ollamaUrl,
      ollamaModel,
      whitelistedChannels,
      blacklistedChannels
    });

    showToast('Settings saved', 'success');
    await checkConnection();
  });
}

async function selectProfile(profileId) {
  const profile = settings.profiles?.find(p => p.id === profileId);
  if (!profile) return;

  // Update active profile
  settings.activeProfileId = profileId;
  await saveSettings({
    activeProfileId: profileId,
    goals: profile.goals  // Also update current goals
  });

  // Update UI
  document.getElementById('goalsInput').value = profile.goals;
  document.getElementById('profileNameInput').value = profile.name;
  document.getElementById('goalsTitle').textContent = 'Edit Profile';
  document.getElementById('deleteProfileBtn').style.display = 'flex';
  renderProfiles();
  updateActiveProfileCard();

  // Re-filter videos with new goals
  await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
  showToast(`Switched to "${profile.name}"`, 'success');
}

async function createProfile(name, goals) {
  const newProfile = {
    id: generateId(),
    name,
    goals
  };

  const profiles = [...(settings.profiles || []), newProfile];

  await saveSettings({
    profiles,
    activeProfileId: newProfile.id,
    goals
  });

  settings.profiles = profiles;
  settings.activeProfileId = newProfile.id;

  document.getElementById('goalsTitle').textContent = 'Edit Profile';
  document.getElementById('deleteProfileBtn').style.display = 'flex';
  renderProfiles();
  updateActiveProfileCard();

  await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
  showSuccessOverlay(`"${name}" is now active`, 'Go to YouTube to see filtering in action');
}

async function createProfileFromTemplate(template) {
  await createProfile(template.name, template.goals);
}

async function updateProfile(profileId, name, goals) {
  const profiles = (settings.profiles || []).map(p =>
    p.id === profileId ? { ...p, name, goals } : p
  );

  await saveSettings({
    profiles,
    goals  // Also update current goals
  });

  settings.profiles = profiles;
  renderProfiles();
  updateActiveProfileCard();

  await chrome.runtime.sendMessage({ type: 'GOALS_CHANGED' });
  showToast('Profile updated — refresh YouTube to apply', 'success');
}

async function deleteProfile(profileId) {
  const profiles = (settings.profiles || []).filter(p => p.id !== profileId);

  // If deleting active profile, clear it
  const newActiveId = profileId === settings.activeProfileId ? null : settings.activeProfileId;

  await saveSettings({
    profiles,
    activeProfileId: newActiveId,
    goals: newActiveId ? settings.goals : ''
  });

  settings.profiles = profiles;
  settings.activeProfileId = newActiveId;

  // Reset form
  document.getElementById('goalsInput').value = '';
  document.getElementById('profileNameInput').value = '';
  document.getElementById('goalsTitle').textContent = 'New Profile';
  document.getElementById('deleteProfileBtn').style.display = 'none';
  renderProfiles();
  updateActiveProfileCard();

  showToast('Profile deleted', 'success');
}

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type ? ` ${type}` : '');

  // Trigger reflow to restart animation if already showing
  toast.offsetHeight;

  toast.classList.add('show');

  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

function showSuccessOverlay(title, subtitle) {
  const overlay = document.createElement('div');
  overlay.className = 'success-overlay';
  overlay.innerHTML = `
    <div class="success-overlay__content">
      <div class="success-overlay__icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      </div>
      <div class="success-overlay__title">${title}</div>
      <div class="success-overlay__subtitle">${subtitle}</div>
      <button class="btn primary" id="successOkBtn">Got it</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Auto-dismiss after 5 seconds
  const autoClose = setTimeout(() => overlay.remove(), 5000);

  document.getElementById('successOkBtn').addEventListener('click', () => {
    clearTimeout(autoClose);
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      clearTimeout(autoClose);
      overlay.remove();
    }
  });
}

function showInfoDialog(title, content) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog dialog--info">
      <div class="dialog__title">${title}</div>
      <div class="dialog__content">${content}</div>
      <button class="btn primary" id="infoOkBtn">Got it</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('infoOkBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function showConfirmDialog(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <div class="dialog__title">${title}</div>
      <div class="dialog__message">${message}</div>
      <div class="dialog__actions">
        <button class="btn" id="dialogCancel">Cancel</button>
        <button class="btn btn-danger" id="dialogConfirm">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#dialogCancel').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#dialogConfirm').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
}
