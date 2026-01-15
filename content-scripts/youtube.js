// YouTube Focus Filter - Content Script
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  const VIDEO_SELECTORS = {
    homepage: 'ytd-rich-item-renderer',
    search: 'ytd-video-renderer',
    sidebarOld: 'ytd-compact-video-renderer',
    sidebarNew: 'yt-lockup-view-model',  // New YouTube sidebar component
    shortsShelf: 'ytd-reel-item-renderer',
    shortsPage: 'ytd-shorts'
  };

  const ALL_VIDEO_SELECTOR = Object.values(VIDEO_SELECTORS).join(', ');
  const DEBOUNCE_DELAY = 300;
  const BATCH_SIZE = 10;
  const CONNECTION_CHECK_INTERVAL = 30000;

  // ============================================
  // STATE
  // ============================================
  const processedVideos = new Set();
  const pendingVideos = new Map(); // videoId -> element
  let debounceTimer = null;
  let isConnected = false;
  let isEnabled = true;
  let connectionCheckTimer = null;
  let sessionStats = { evaluated: 0, blocked: 0 };

  // ============================================
  // MESSAGE LISTENER
  // ============================================
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'REPROCESS_VIDEOS') {
      console.log('[YouTube Focus Filter] Goals changed - re-processing all videos...');
      // Clear processed set to re-evaluate all videos
      processedVideos.clear();
      pendingVideos.clear();
      sessionStats = { evaluated: 0, blocked: 0 };
      window._ytffDebuggedElement = false;

      // Reset all video statuses
      document.querySelectorAll('[data-ytff-status]').forEach(el => {
        el.removeAttribute('data-ytff-status');
        el.querySelector('.ytff-loading-badge')?.remove();
      });

      // Re-process
      processVideos();
      sendResponse({ success: true });
    }
    return true;
  });

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    console.log('[YouTube Focus Filter] Initializing...');

    // Check connection first
    await checkConnection();

    // Start periodic connection checks
    connectionCheckTimer = setInterval(checkConnection, CONNECTION_CHECK_INTERVAL);

    // Load settings
    await loadSettings();

    // Process existing videos
    if (isEnabled && isConnected) {
      processVideos();
    }

    // Observe DOM for new videos
    observeDOM();

    // Observe navigation (YouTube SPA)
    observeNavigation();

    // Show initial stats badge
    updateStatsBadge();
  }

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      isEnabled = response.settings?.enabled ?? true;

      if (!isEnabled) {
        showDisabledIndicator();
      }
    } catch (error) {
      console.error('[YouTube Focus Filter] Failed to load settings:', error);
    }
  }

  // ============================================
  // CONNECTION MANAGEMENT
  // ============================================
  async function checkConnection() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' });
      const wasConnected = isConnected;
      isConnected = response.healthy;

      if (isConnected && !wasConnected) {
        // Just connected - remove error banner, process videos
        removeBanner();
        processVideos();
      } else if (!isConnected && wasConnected) {
        // Just disconnected - show error
        showBanner('error', 'Ollama disconnected. Run: ollama serve', 'Retry', checkConnection);
      } else if (!isConnected && !wasConnected) {
        // Still disconnected on init
        showBanner('error', 'Ollama not running. Start with: ollama serve', 'Retry', checkConnection);
      }

      return isConnected;
    } catch (error) {
      isConnected = false;
      showBanner('error', 'Extension error. Try reloading the page.', 'Reload', () => location.reload());
      return false;
    }
  }

  // ============================================
  // BANNER UI
  // ============================================
  function showBanner(type, message, actionText, actionCallback, autoHide = 0) {
    removeBanner();

    const banner = document.createElement('div');
    banner.className = `ytff-banner ytff-banner--${type}`;
    banner.id = 'ytff-banner';

    const icons = {
      error: '\u26A0\uFE0F',
      warning: '\u23F3',
      success: '\u2705'
    };

    banner.innerHTML = `
      <span class="ytff-banner__icon">${icons[type] || ''}</span>
      <span class="ytff-banner__message">${message}</span>
      ${actionText ? `<button class="ytff-banner__action">${actionText}</button>` : ''}
      <button class="ytff-banner__close">\u00D7</button>
    `;

    if (actionCallback) {
      banner.querySelector('.ytff-banner__action')?.addEventListener('click', actionCallback);
    }

    banner.querySelector('.ytff-banner__close').addEventListener('click', removeBanner);

    document.body.appendChild(banner);

    if (autoHide > 0) {
      setTimeout(removeBanner, autoHide);
    }
  }

  function removeBanner() {
    document.getElementById('ytff-banner')?.remove();
  }

  // ============================================
  // STATS BADGE
  // ============================================
  function updateStatsBadge() {
    let badge = document.getElementById('ytff-stats-badge');

    if (sessionStats.evaluated === 0) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ytff-stats-badge';
      badge.id = 'ytff-stats-badge';
      document.body.appendChild(badge);
    }

    badge.innerHTML = `
      <div class="ytff-stats-badge__item">
        <span class="ytff-stats-badge__icon">\uD83D\uDEE1\uFE0F</span>
        <span class="ytff-stats-badge__count">${sessionStats.blocked}</span>
        <span>blocked</span>
      </div>
      <div class="ytff-stats-badge__item">
        <span class="ytff-stats-badge__icon">\uD83D\uDCCA</span>
        <span class="ytff-stats-badge__count">${sessionStats.evaluated}</span>
        <span>evaluated</span>
      </div>
    `;

    // Auto-hide after 5 seconds of no updates
    clearTimeout(badge.hideTimer);
    badge.hideTimer = setTimeout(() => {
      badge.style.opacity = '0';
      setTimeout(() => badge.remove(), 300);
    }, 5000);
  }

  function showDisabledIndicator() {
    let indicator = document.getElementById('ytff-disabled');
    if (indicator) return;

    indicator = document.createElement('div');
    indicator.className = 'ytff-disabled-indicator';
    indicator.id = 'ytff-disabled';
    indicator.textContent = 'Focus Filter paused';
    document.body.appendChild(indicator);
  }

  // ============================================
  // DOM OBSERVATION
  // ============================================
  function observeDOM() {
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isEnabled && isConnected) {
          processVideos();
        }
      }, DEBOUNCE_DELAY);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function observeNavigation() {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[YouTube Focus Filter] Navigation detected');
        processedVideos.clear();
        pendingVideos.clear();
        sessionStats = { evaluated: 0, blocked: 0 };

        setTimeout(() => {
          if (isEnabled && isConnected) {
            processVideos();
          }
        }, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================
  // VIDEO PROCESSING
  // ============================================
  async function processVideos() {
    if (!isEnabled || !isConnected) return;

    const videoElements = document.querySelectorAll(ALL_VIDEO_SELECTOR);
    console.log(`[YouTube Focus Filter] Found ${videoElements.length} video elements on page`);

    // Debug: log what selectors matched
    if (videoElements.length === 0) {
      console.log('[YouTube Focus Filter] DEBUG - Checking individual selectors:');
      Object.entries(VIDEO_SELECTORS).forEach(([name, selector]) => {
        const count = document.querySelectorAll(selector).length;
        console.log(`  - ${name} (${selector}): ${count} elements`);
      });
    }

    const videosToEvaluate = [];

    let skippedProcessed = 0;
    let skippedNoMetadata = 0;
    let skippedDuplicate = 0;

    for (const element of videoElements) {
      // Skip already processed
      if (element.dataset.ytffStatus && element.dataset.ytffStatus !== 'pending') {
        skippedProcessed++;
        continue;
      }

      const metadata = extractVideoMetadata(element);
      if (!metadata) {
        skippedNoMetadata++;
        continue;
      }
      if (processedVideos.has(metadata.videoId)) {
        skippedDuplicate++;
        continue;
      }

      processedVideos.add(metadata.videoId);

      // Pre-hide immediately
      element.dataset.ytffStatus = 'pending';

      // Add loading badge
      addLoadingBadge(element);

      videosToEvaluate.push({
        ...metadata,
        element
      });

      pendingVideos.set(metadata.videoId, element);
    }

    console.log(`[YouTube Focus Filter] Skipped: ${skippedProcessed} already processed, ${skippedNoMetadata} no metadata, ${skippedDuplicate} duplicates`);

    if (videosToEvaluate.length === 0) {
      console.log('[YouTube Focus Filter] No new videos to evaluate');
      return;
    }

    console.log(`[YouTube Focus Filter] Evaluating ${videosToEvaluate.length} videos:`);
    videosToEvaluate.forEach((v, i) => {
      console.log(`  ${i + 1}. "${v.title}" by ${v.channel || '(no channel)'}`);
    });

    // Process in batches
    for (let i = 0; i < videosToEvaluate.length; i += BATCH_SIZE) {
      const batch = videosToEvaluate.slice(i, i + BATCH_SIZE);

      // Update status to evaluating
      batch.forEach(v => {
        v.element.dataset.ytffStatus = 'evaluating';
      });

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'EVALUATE_VIDEOS',
          videos: batch.map(v => ({
            videoId: v.videoId,
            title: v.title,
            channel: v.channel,
            description: v.description
          }))
        });

        if (response.decisions) {
          applyDecisions(batch, response.decisions);
        }
      } catch (error) {
        console.error('[YouTube Focus Filter] Batch evaluation error:', error);
        batch.forEach(v => {
          setVideoStatus(v.element, 'error');
          removeLoadingBadge(v.element);
        });
      }
    }

    updateStatsBadge();
  }

  function extractVideoMetadata(element) {
    // Try multiple ways to find the video URL
    let videoUrl = '';
    let videoId = null;

    // Method 1: Look for thumbnail link (works for most elements)
    const thumbnailLink = element.querySelector('a#thumbnail, a.ytd-thumbnail, a[href*="/watch"], a[href*="/shorts/"]');
    if (thumbnailLink?.href) {
      videoUrl = thumbnailLink.href;
      videoId = extractVideoId(videoUrl);
    }

    // Method 2: Look for any link with video ID in href
    if (!videoId) {
      const anyVideoLink = element.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
      if (anyVideoLink?.href) {
        videoUrl = anyVideoLink.href;
        videoId = extractVideoId(videoUrl);
      }
    }

    // Method 3: Check data attributes
    if (!videoId) {
      const videoIdAttr = element.getAttribute('data-video-id') ||
                          element.querySelector('[data-video-id]')?.getAttribute('data-video-id');
      if (videoIdAttr) {
        videoId = videoIdAttr;
        videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Method 4: Look in the element's links for title link
    if (!videoId) {
      const titleLink = element.querySelector('#video-title-link, a#video-title, h3 a, #dismissible a');
      if (titleLink?.href) {
        videoUrl = titleLink.href;
        videoId = extractVideoId(videoUrl);
      }
    }

    // Method 5: For new yt-lockup-view-model components - check parent/sibling links
    if (!videoId && element.tagName.toLowerCase() === 'yt-lockup-view-model') {
      // The link might be on the element itself or nearby
      const lockupLink = element.closest('a[href*="watch?v="]') ||
                         element.querySelector('a') ||
                         element.parentElement?.querySelector('a[href*="watch?v="]');
      if (lockupLink?.href) {
        videoUrl = lockupLink.href;
        videoId = extractVideoId(videoUrl);
      }
    }

    if (!videoId) {
      // Debug: log first failed element to understand structure
      if (!window._ytffDebuggedElement) {
        window._ytffDebuggedElement = true;
        console.log('[YouTube Focus Filter] DEBUG - Could not extract videoId from element:', element.tagName);
        console.log('  - All links in element:');
        element.querySelectorAll('a[href]').forEach((a, i) => {
          if (i < 5) console.log(`    ${i}: ${a.href.slice(0, 100)}`);
        });
        console.log('  - Element HTML (first 800 chars):', element.outerHTML.slice(0, 800));
      }
      return null;
    }

    // Extract title - try multiple selectors including new view-model components
    const titleElement = element.querySelector(
      '#video-title, ' +
      '#video-title-link, ' +
      'a#video-title, ' +
      'h3 a, ' +
      'h3 span, ' +
      '[id="video-title"], ' +
      'yt-formatted-string#video-title, ' +
      'yt-lockup-metadata-view-model h3, ' +
      'yt-lockup-metadata-view-model [class*="title"], ' +
      '.yt-lockup-metadata-view-model-wiz__title'
    );
    let title = titleElement?.textContent?.trim() || titleElement?.getAttribute('title') || '';

    // Fallback: get title from aria-label on links
    if (!title) {
      const linkWithLabel = element.querySelector('a[aria-label]');
      if (linkWithLabel) {
        title = linkWithLabel.getAttribute('aria-label');
      }
    }

    // Extract channel - try multiple selectors including new view-model components
    const channelElement = element.querySelector(
      'ytd-channel-name a, ' +
      'ytd-channel-name yt-formatted-string, ' +
      '#channel-name a, ' +
      '#channel-name yt-formatted-string, ' +
      '.ytd-channel-name a, ' +
      '[id="text"] a, ' +
      '#byline a, ' +
      'yt-lockup-metadata-view-model [class*="byline"], ' +
      'yt-content-metadata-view-model, ' +
      '.yt-lockup-metadata-view-model-wiz__metadata'
    );
    const channel = channelElement?.textContent?.trim() || '';

    const descElement = element.querySelector('.metadata-snippet-text, #description-text');
    const description = descElement?.textContent?.trim() || '';

    return { videoId, title, channel, description, url: videoUrl };
  }

  function extractVideoId(url) {
    if (!url) return null;

    const watchMatch = url.match(/[?&]v=([^&]+)/);
    if (watchMatch) return watchMatch[1];

    const shortsMatch = url.match(/\/shorts\/([^?&]+)/);
    if (shortsMatch) return shortsMatch[1];

    return null;
  }

  // ============================================
  // LOADING BADGE
  // ============================================
  function addLoadingBadge(element) {
    if (element.querySelector('.ytff-loading-badge')) return;

    const thumbnail = element.querySelector('ytd-thumbnail, .ytd-thumbnail');
    if (!thumbnail) return;

    thumbnail.style.position = 'relative';

    const badge = document.createElement('div');
    badge.className = 'ytff-loading-badge';
    badge.innerHTML = `
      <div class="ytff-loading-badge__spinner"></div>
      <span>Evaluating...</span>
    `;

    thumbnail.appendChild(badge);
  }

  function removeLoadingBadge(element) {
    element.querySelector('.ytff-loading-badge')?.remove();
  }

  // ============================================
  // DECISION APPLICATION
  // ============================================
  function applyDecisions(videos, decisions) {
    const decisionMap = new Map(decisions.map(d => [d.videoId, d]));

    for (const video of videos) {
      const decision = decisionMap.get(video.videoId);
      removeLoadingBadge(video.element);
      pendingVideos.delete(video.videoId);

      if (!decision) {
        setVideoStatus(video.element, 'allowed');
        continue;
      }

      sessionStats.evaluated++;

      if (decision.decision === 'BLOCK') {
        setVideoStatus(video.element, 'blocked');
        sessionStats.blocked++;
        console.log(`[YouTube Focus Filter] Blocked: "${video.title}" (${decision.source})`);
      } else {
        setVideoStatus(video.element, 'allowed');
      }
    }
  }

  function setVideoStatus(element, status) {
    element.dataset.ytffStatus = status;
  }

  // ============================================
  // CLEANUP
  // ============================================
  function cleanup() {
    clearInterval(connectionCheckTimer);
    clearTimeout(debounceTimer);
    removeBanner();
    document.getElementById('ytff-stats-badge')?.remove();
    document.getElementById('ytff-disabled')?.remove();
  }

  // Handle extension disable/unload
  window.addEventListener('beforeunload', cleanup);

  // ============================================
  // DEBUG HELPER (accessible from console)
  // ============================================
  window.ytffDebug = {
    status: () => ({
      isEnabled,
      isConnected,
      processedCount: processedVideos.size,
      pendingCount: pendingVideos.size,
      sessionStats
    }),
    forceProcess: () => processVideos(),
    checkSelectors: () => {
      console.log('Checking YouTube video selectors:');
      Object.entries(VIDEO_SELECTORS).forEach(([name, selector]) => {
        const elements = document.querySelectorAll(selector);
        console.log(`  ${name} (${selector}): ${elements.length} elements`);
        if (elements.length > 0) {
          const first = elements[0];
          const link = first.querySelector('a#thumbnail, a.ytd-thumbnail');
          console.log(`    - First element has thumbnail link: ${!!link}`);
          if (link) console.log(`    - Link href: ${link.href}`);
        }
      });
    },
    listVideos: () => {
      const all = document.querySelectorAll(ALL_VIDEO_SELECTOR);
      console.log(`Found ${all.length} total video elements`);
      all.forEach((el, i) => {
        const meta = extractVideoMetadata(el);
        console.log(`  ${i + 1}. ${meta ? `"${meta.title}" (${meta.videoId})` : '(no metadata)'} - status: ${el.dataset.ytffStatus || 'none'}`);
      });
    }
  };
  console.log('[YouTube Focus Filter] Debug helpers available: ytffDebug.status(), ytffDebug.forceProcess(), ytffDebug.checkSelectors(), ytffDebug.listVideos()');

  // ============================================
  // START
  // ============================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
