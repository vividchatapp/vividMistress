// Vivid Mistress — single always-on chat front end.
(function () {
  'use strict';

  // ---- Console helpers ---------------------------------------------------
  // Every step is logged to the browser console (F12) so it is easy to see
  // exactly what the page is doing: message sending, mp3 playback, button
  // generation, button clicks and the auto-continue timer.
  function log() { console.log('[Vivid Mistress]', ...arguments); }
  function warn() { console.warn('[Vivid Mistress]', ...arguments); }
  function errorLog() { console.error('[Vivid Mistress]', ...arguments); }

  const $ = (id) => document.getElementById(id);

  async function api(path, options) {
    options = options || {};
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'X-Client-ID': getClientId(),
    }, options.headers || {});
    const opts = { method: options.method || 'GET', ...options, headers };
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Request failed (' + resp.status + ')');
    return data;
  }

  // ---- State --------------------------------------------------------------
  const state = {
    convId: null,
    conv: null,
    sending: false,
    role: '',
  };

  let voiceOn = true;                  // spoken (mp3) replies on/off
  let voiceName = 'en-GB-SoniaNeural'; // internal voice id
  let voiceFriendly = '';              // external (friendly) voice name e.g. Sonia
  let voiceLabel = '';                 // e.g. "Sonia — British, Clear/Expressive"
  let voiceSpeed = 3;
  let suggestionButtons = [];          // currently displayed button labels
  let responseTimer = null;            // auto-continue timeout id
  let audioPlayer = null;
  let autoStreak = 0;                  // consecutive auto "continue" sends
  let autoContinueOn = true;           // "start"/"stop": push "continue" after replies
  let autoDelaySeconds = 10;           // pause after the mp3 before auto-continue
  let suggestionCount = 5;             // suggestion buttons to show (1-5)
  let textOn = true;                   // show reply text on screen ("text on/off")

  const MAX_AUTO_CONTINUES = 3;        // safety cap so the chat never runs away
  const DEFAULT_AUTO_DELAY = 10;       // default pause after the mp3 (seconds)
  const MAX_AUTO_DELAY = 300;          // largest allowed "delay [n]" (seconds)
  const MAX_SUGGESTION_BUTTONS = 5;    // largest allowed "buttons [n]"

  const KEY_CLIENT = 'vm_client_id';
  const KEY_VOICE = 'vm_voice_pref';
  const KEY_PUSH = 'vm_push_on';       // '1' = auto-continue on, '0' = off
  const KEY_DELAY = 'vm_push_delay';   // seconds to wait after the mp3
  const KEY_BUTTONS = 'vm_buttons';    // suggestion button count (1-5)
  const KEY_TEXT = 'vm_text_on';       // '1' = text shown, '0' = text hidden

  // ---- Per-browser client id ---------------------------------------------
  function getClientId() {
    let id = null;
    try { id = localStorage.getItem(KEY_CLIENT); } catch (e) { /* ignore */ }
    if (!id) {
      id = 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(KEY_CLIENT, id); } catch (e) { /* ignore */ }
      log('created new client id', id);
    }
    return id;
  }

  // ---- Per-browser session preferences ------------------------------------
  function readLocalInt(key, dflt) {
    try {
      const v = parseInt(localStorage.getItem(key), 10);
      if (!Number.isNaN(v)) return v;
    } catch (e) { /* ignore */ }
    return dflt;
  }

  function saveLocalStr(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }

  // Restores the auto-continue ("push") settings for this browser: whether
  // pushing is on, how many seconds to wait after the voice reply, and how
  // many suggestion buttons to show.
  function loadSessionPrefs() {
    try {
      if (localStorage.getItem(KEY_PUSH) === '0') autoContinueOn = false;
      if (localStorage.getItem(KEY_TEXT) === '0') textOn = false;
    } catch (e) { /* ignore */ }
    autoDelaySeconds = Math.min(Math.max(0, readLocalInt(KEY_DELAY, DEFAULT_AUTO_DELAY)), MAX_AUTO_DELAY);
    suggestionCount = Math.min(Math.max(1, readLocalInt(KEY_BUTTONS, MAX_SUGGESTION_BUTTONS)), MAX_SUGGESTION_BUTTONS);
    log('session prefs: auto-continue=' + (autoContinueOn ? 'on' : 'off') +
      ' delay=' + autoDelaySeconds + 's buttons=' + suggestionCount +
      ' text=' + (textOn ? 'on' : 'off'));
  }

  // ---- DOM refs -----------------------------------------------------------
  const el = {
    chatMessages: $('chat-messages'),
    emptyState: $('empty-state'),
    inputMessage: $('input-message'),
    btnSend: $('btn-send'),
    suggestionButtons: $('suggestion-buttons'),
    btnVoice: $('btn-voice'),
    roleChip: $('role-chip'),
    voiceChip: $('voice-chip'),
    speedChip: $('speed-chip'),
  };

  // ---- Markdown rendering (lightweight, always escaped) -------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(src) {
    const escaped = escapeHtml(src);
    let html = escaped;

    // Protect fenced code blocks, then style the rest of the text.
    const preBlocks = [];
    html = html.replace(/```([\s\S]*?)```/g, function (m, code) {
      preBlocks.push('<pre class="md-pre"><code>' + code.replace(/^[\r\n]+|[\r\n]+$/g, '') + '</code></pre>');
      return '\u0000PRE' + (preBlocks.length - 1) + '\u0000';
    });
    html = html.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Remove unwanted line feeds: the LLM often emits runs of blank lines
    // ("\n\n\n...") which would open big vertical gaps inside a bubble.
    // Collapse every whitespace-only line down to a single line break.
    html = html.replace(/\r\n?/g, '\n');
    html = html.replace(/[ \t]*\n[ \t]*/g, '\n');
    html = html.replace(/\n+/g, '\n');
    html = html.replace(/^\n+|\n+$/g, '');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/\u0000PRE(\d+)\u0000/g, function (m, i) {
      return preBlocks[Number(i)];
    });

    // Drop stray breaks caused by leading/trailing newlines.
    const body = html.replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');
    return '<p>' + body + '</p>';
  }

  // ---- Message rendering ---------------------------------------------------
  function scrollToBottom() {
    if (el.chatMessages) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function createMessageEl(role, content, extra) {
    extra = extra || {};
    const div = document.createElement('div');
    div.className = 'message ' + role + (extra.notice ? ' notice' : '') + (extra.error ? ' error' : '');

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'U' : (extra.notice ? 'I' : 'V');
    div.appendChild(avatar);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content' + (role === 'assistant' ? ' md' : '');

    if (role === 'assistant') {
      contentDiv.innerHTML = renderMarkdown(content || '');
    } else {
      contentDiv.textContent = content || '';
    }

    // User bubbles are direct children of .message.user (the avatar is pushed
    // to the far side with CSS) so the bubble can size to its own text and
    // never gets crushed into a narrow column that breaks words mid-way.
    if (role === 'user') {
      div.appendChild(contentDiv);
    } else {
      const body = document.createElement('div');
      body.className = 'message-body';
      body.appendChild(contentDiv);
      div.appendChild(body);
    }

    // No per-message action buttons — the response mp3 plays automatically.
    return div;
  }

  function appendMessage(role, content, extra) {
    if (el.emptyState) el.emptyState.style.display = 'none';
    const node = createMessageEl(role, content, extra || {});
    if (el.chatMessages) {
      el.chatMessages.appendChild(node);
      scrollToBottom();
    }
    return node;
  }

  function renderMessages(messages) {
    const list = messages || [];
    if (!el.chatMessages) return;
    // Remove only rendered message nodes — keep #empty-state in the DOM so it
    // can be shown again after the context is cleared.
    el.chatMessages.querySelectorAll('.message').forEach((n) => n.remove());
    if (!list.length) {
      if (el.emptyState) el.emptyState.style.display = '';
      return;
    }
    if (el.emptyState) el.emptyState.style.display = 'none';
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      // With "text off" the narration bubbles are hidden, but the voice mp3
      // still plays and the suggestion buttons are still shown.
      if (m.role === 'assistant' && !textOn) continue;
      el.chatMessages.appendChild(createMessageEl(m.role, m.content));
    }
    scrollToBottom();
  }

  // ---- Voice ----------------------------------------------------------------
  // updateStatus refreshes the role / voice / speed chips in the status bar.
  // Only external names are shown (e.g. "Sonia"), never the internal ids.
  function updateStatus() {
    if (el.roleChip) {
      el.roleChip.textContent = 'Role: ' + (state.role || '—');
    }
    const shownVoice = voiceFriendly || voiceName;
    if (el.voiceChip) {
      el.voiceChip.textContent = (voiceOn ? '\u{1F50A} ' : '\u{1F507} ') + (shownVoice || '—');
      el.voiceChip.title = 'Voice: ' + (voiceLabel || shownVoice || '—') +
        (voiceOn ? ' · spoken replies ON' : ' · spoken replies OFF');
    }
    if (el.speedChip) {
      const mult = (1 + voiceSpeed / 10).toFixed(1);
      el.speedChip.textContent = 'Speed: ' + voiceSpeed + ' (' + mult + 'x)';
      el.speedChip.title = 'Speech speed ' + voiceSpeed + ' = ' + mult + 'x. Type "speed <1-9>" to change.';
    }
  }

  // applyVoiceState copies the voice fields a server response carries.
  function applyVoiceState(data) {
    if (typeof data.voice === 'boolean') voiceOn = data.voice;
    if (data.voice_name) voiceName = data.voice_name;
    if (data.voice_display) voiceFriendly = data.voice_display;
    if (data.voice_label) voiceLabel = data.voice_label;
    if (data.voice_speed) voiceSpeed = data.voice_speed;
    updateStatus();
  }

  function renderVoiceButton() {
    if (!el.btnVoice) return;
    el.btnVoice.textContent = voiceOn ? '\u{1F50A}' : '\u{1F507}';
    el.btnVoice.title = voiceOn ? 'Spoken replies are ON — click to mute' : 'Spoken replies are OFF — click to unmute';
    el.btnVoice.setAttribute('aria-pressed', String(voiceOn));
    el.btnVoice.classList.toggle('muted', !voiceOn);
    updateStatus();
  }

  async function loadVoice() {
    try {
      const data = await api('/api/voice');
      applyVoiceState(data);
      let pref = null;
      try { pref = localStorage.getItem(KEY_VOICE); } catch (e) { /* ignore */ }
      if (pref === null) {
        // First visit: default spoken replies to ON (mp3 is the core flow).
        if (data.voice !== true) {
          log('defaulting voice to ON for this browser');
          await setVoicePref(true);
          return;
        }
      }
      renderVoiceButton();
      log('voice state loaded:', voiceOn, voiceFriendly || voiceName, 'speed', voiceSpeed);
    } catch (e) {
      warn('failed to load voice state:', e.message);
      renderVoiceButton();
    }
  }

  async function setVoicePref(on) {
    const data = await api('/api/voice', { method: 'PUT', body: { voice: !!on } });
    applyVoiceState(data);
    try { localStorage.setItem(KEY_VOICE, voiceOn ? '1' : '0'); } catch (e) { /* ignore */ }
    renderVoiceButton();
    log('voice preference saved:', voiceOn);
  }

  // ---- Audio ----------------------------------------------------------------
  // Each assistant reply is played automatically when the server returns an
  // mp3. There are no per-message audio buttons any more.

  // playAudio plays a base64 mp3 and calls onEnded when playback finishes
  // (or immediately when there is nothing to play / it fails). onMetadata
  // (optional) is called with the mp3 duration in seconds when known, so the
  // auto-continue timer can be armed as soon as the length is available.
  function playAudio(base64Data, mimeType, onEnded, onMetadata) {
    const done = () => { if (onEnded) onEnded(); };
    if (!base64Data) { done(); return; }
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      if (audioPlayer) {
        try { audioPlayer.pause(); } catch (e) { /* ignore */ }
        try { URL.revokeObjectURL(audioPlayer.src); } catch (e) { /* ignore */ }
      }
      audioPlayer = new Audio(url);
      audioPlayer.onloadedmetadata = () => {
        let dur = 0;
        try {
          if (audioPlayer.duration && isFinite(audioPlayer.duration)) dur = audioPlayer.duration;
        } catch (e) { /* ignore */ }
        log('mp3 length loaded: ' + dur.toFixed(2) + 's');
        if (onMetadata) onMetadata(dur);
      };
      audioPlayer.onended = done;
      audioPlayer.onerror = () => { warn('audio playback error'); done(); };
      log('playing mp3 (' + binary.length + ' bytes)');
      audioPlayer.play().catch((e) => { errorLog('audio play() rejected:', e); done(); });
    } catch (e) {
      errorLog('failed to decode audio:', e);
      done();
    }
  }

  // ---- Role / status chip ----------------------------------------------------
  function setRole(name) {
    state.role = name || '';
    updateStatus();
  }

  // ---- Suggestion buttons + auto-continue timer ------------------------------
  async function fetchSuggestions() {
    if (!state.convId) return;
    log('requesting ' + suggestionCount + ' button responses from the LLM (Generating buttons)…');
    try {
      const data = await api('/api/chat/suggestions', {
        method: 'POST',
        body: { conversation_id: state.convId },
      });
      const list = (data && Array.isArray(data.suggestions)) ? data.suggestions : [];
      log('LLM returned ' + list.length + ' buttons');
      if (list.length > 0) {
        renderSuggestionButtons(list);
      } else {
        warn('no buttons returned by the LLM');
      }
    } catch (e) {
      warn('failed to fetch buttons:', e.message);
    }
  }

  function renderSuggestionButtons(list) {
    const container = el.suggestionButtons;
    if (!container) return;
    container.innerHTML = '';
    suggestionButtons = list.slice(0, suggestionCount);
    for (let i = 0; i < suggestionButtons.length; i++) {
      const text = suggestionButtons[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggestion-btn';
      btn.textContent = text;
      btn.addEventListener('click', () => handleSuggestionClick(text));
      container.appendChild(btn);
    }
    container.classList.remove('hidden');
    log('rendered ' + suggestionButtons.length + ' suggestion buttons:', suggestionButtons);
  }

  function clearSuggestions() {
    clearResponseTimer();
    if (el.suggestionButtons && !el.suggestionButtons.classList.contains('hidden')) {
      el.suggestionButtons.classList.add('hidden');
      el.suggestionButtons.innerHTML = '';
      log('buttons disappeared');
    }
    suggestionButtons = [];
  }

  function handleSuggestionClick(text) {
    log('suggestion button clicked:', JSON.stringify(text));
    clearSuggestions();
    autoStreak = 0;
    void sendText(text, 'button');
  }

  function clearResponseTimer() {
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
      log('auto-continue timer cancelled');
    }
  }

  function startResponseTimer(seconds) {
    clearResponseTimer();
    const ms = Math.max(0, Number(seconds) || 0) * 1000;
    log('auto-continue timer armed: fires in ' + ms + 'ms (' + seconds + 's, mp3 finished)');
    responseTimer = setTimeout(() => {
      responseTimer = null;
      if (!autoContinueOn) {
        log('auto-continue stopped since the timer was armed — not pushing');
        return;
      }
      if (state.sending || !state.convId) return;
      log('auto-continue timer fired — sending "continue" on your behalf');
      void sendText('continue', 'auto');
    }, ms);
  }

  // ---- Local chat commands (status / delay / stop / start / buttons / text) --
  // These control or display browser-side behaviour (auto-continue "pushing",
  // whether the narration text is shown), so they are handled right here
  // instead of being sent to the server / LLM.
  function handleLocalCommand(raw) {
    const text = String(raw || '').trim();
    const lower = text.toLowerCase();
    const match = lower.match(/^(delay|buttons)(?:\s+(\d+))?$/);
    const textMatch = lower.match(/^text(?:\s+(on|off))?$/);
    const isStatus = lower === 'status';
    if (lower !== 'stop' && lower !== 'start' && !match && !textMatch && !isStatus) return false;

    const notice = (md) => appendMessage('assistant', md, { notice: true });

    // "status" is rendered here (instead of on the server) so it can also show
    // the browser-side delay and buttons settings. It mirrors the help-list
    // style, but without the [n] argument hints — those live in "help" only.
    if (isStatus) {
      appendMessage('user', text);
      const voiceState = voiceOn ? 'ON' : 'OFF (muted)';
      const voiceDesc = voiceLabel || voiceFriendly || voiceName || '—';
      const speedMult = (1 + (voiceSpeed || 3) / 10).toFixed(1);
      notice('`voice` – ' + voiceState + ' — ' + voiceDesc + '\n' +
        '`role` – ' + (state.role || '—') + '\n' +
        '`speed` – ' + voiceSpeed + ' (' + speedMult + 'x)\n' +
        '`delay` – ' + autoDelaySeconds + 's\n' +
        '`buttons` – ' + suggestionCount);
      return true;
    }

    // "text on/off" hides/shows the narration bubbles. The voice reply and the
    // suggestion buttons are unaffected.
    if (textMatch) {
      const want = textMatch[1];
      if (!want) {
        appendMessage('user', text);
        notice('**Text display:** ' + (textOn ? 'ON' : 'OFF') + ' — narration is ' +
          (textOn ? 'shown on screen' : 'voice-only') + '. Toggle with `text on` / `text off`.');
        return true;
      }
      const next = want === 'on';
      if (next === textOn) {
        appendMessage('user', text);
        notice('**Text display** is already ' + (textOn ? 'ON' : 'OFF') + '.');
        return true;
      }
      textOn = next;
      saveLocalStr(KEY_TEXT, textOn ? '1' : '0');
      // Redraw the transcript so the narration hides (text off) or comes back
      // (text on) immediately. The command bubbles are re-added below.
      if (state.conv) renderMessages(state.conv.messages);
      appendMessage('user', text);
      notice(textOn
        ? '**Text display ON.** Replies are shown on screen again (voice and buttons still work).'
        : '**Text display OFF.** Narration is voice-only now — the voice still plays and the buttons still show.');
      return true;
    }

    appendMessage('user', text);   // same look as the server-side commands
    autosizeInput();

    if (lower === 'stop') {
      if (!autoContinueOn) {
        notice('Auto-continue is already **stopped** — no messages are being pushed.');
      } else {
        autoContinueOn = false;
        autoStreak = 0;
        clearResponseTimer();
        saveLocalStr(KEY_PUSH, '0');
        notice('**Auto-continue stopped.** No more messages will be pushed — you stay in control.');
      }
      return true;
    }

    if (lower === 'start') {
      autoContinueOn = true;
      autoStreak = 0;
      saveLocalStr(KEY_PUSH, '1');
      notice('**Auto-continue started.** After each voice reply, "continue" is pushed (delay ' + autoDelaySeconds + 's).');
      return true;
    }

    const cmd = match[1];
    const hasValue = match[2] !== undefined;
    const n = hasValue ? parseInt(match[2], 10) : 0;

    if (cmd === 'delay') {
      if (!hasValue) {
        notice('**Push delay:** ' + autoDelaySeconds + 's — the pause after the voice reply before "continue" is pushed. Set with `delay [n]`.');
        return true;
      }
      if (n > MAX_AUTO_DELAY) {
        notice('`delay` takes a number of seconds from 0 to ' + MAX_AUTO_DELAY + '.');
        return true;
      }
      autoDelaySeconds = n;
      saveLocalStr(KEY_DELAY, autoDelaySeconds);
      notice('**Push delay set to ' + autoDelaySeconds + 's.** She now waits that long after each voice reply before pushing "continue".');
      return true;
    }

    // cmd === 'buttons'
    if (!hasValue) {
      notice('**Suggestion buttons:** ' + suggestionCount + ' per reply (1–' + MAX_SUGGESTION_BUTTONS + '). Set with `buttons [n]`.');
      return true;
    }
    if (n < 1 || n > MAX_SUGGESTION_BUTTONS) {
      notice('`buttons` takes a number from 1 to ' + MAX_SUGGESTION_BUTTONS + '.');
      return true;
    }
    suggestionCount = n;
    saveLocalStr(KEY_BUTTONS, suggestionCount);
    notice('**Suggestion buttons set to ' + suggestionCount + '.** Future replies will show ' + suggestionCount + ' button' + (suggestionCount === 1 ? '' : 's') + '.');
    return true;
  }

  // ---- Sending messages ------------------------------------------------------
  async function sendText(text, source) {
    text = String(text || '').trim();
    if (!text || state.sending || !state.convId) {
      warn('send skipped', { text: text, sending: state.sending, hasConv: !!state.convId });
      return;
    }
    if (source === 'auto' && autoStreak >= MAX_AUTO_CONTINUES) {
      warn('auto-continue cap reached (' + autoStreak + ') — waiting for you to type or press a button');
      return;
    }
    if (source !== 'auto') autoStreak = 0;

    clearSuggestions();
    state.sending = true;
    el.btnSend.disabled = true;
    if (source === 'typed') el.inputMessage.value = '';
    appendMessage('user', text);
    log('POST /api/chat', { user_message: text, source: source || 'typed' });

    try {
      const data = await api('/api/chat', {
        method: 'POST',
        body: { conversation_id: state.convId, user_message: text },
      });
      const updated = data.conversation || data;
      state.conv = updated;
      if (data.role) setRole(data.role);
      if (typeof data.voice === 'boolean' || data.voice_name || data.voice_display || data.voice_speed) {
        applyVoiceState(data);
        if (typeof data.voice === 'boolean') {
          try { localStorage.setItem(KEY_VOICE, voiceOn ? '1' : '0'); } catch (e) { /* ignore */ }
        }
        renderVoiceButton();
      }
      renderMessages(updated.messages);
      log('chat reply received. auto =', data.auto);

      if (data.notice) {
        log('server notice:', String(data.notice).split('\n')[0]);
        const shown = (updated.messages || []).some((m) => m.role === 'user' && m.content === text);
        if (!shown && source !== 'auto') appendMessage('user', text);
        appendMessage('assistant', data.notice, { notice: true });
        return;
      }
      if (data.auto) {
        if (source === 'auto') autoStreak += 1;
        handleAutoReply(data);
      } else {
        log('reply is a local/system message — no buttons or timer scheduled');
      }
    } catch (e) {
      errorLog('chat request failed:', e.message);
      appendMessage('assistant', 'Error: ' + e.message, { error: true });
    } finally {
      state.sending = false;
      el.btnSend.disabled = false;
      if (el.inputMessage) el.inputMessage.focus();
    }
  }

  // Called for every real LLM reply. The suggestion buttons are requested
  // immediately (so the person can answer while the mp3 is still playing).
  // The auto-continue timer is armed to fire mp3-length + autoDelaySeconds
  // after the reply arrived, using the loaded mp3 duration when available.
  function handleAutoReply(data) {
    const startedAt = Date.now();
    let scheduled = false;

    const schedule = (durSeconds) => {
      if (!autoContinueOn) {
        log('auto-continue stopped — not arming the push timer');
        return;
      }
      if (scheduled) return;
      if (state.sending || !state.convId) {
        // Retry shortly — the in-flight message usually finishes immediately.
        setTimeout(() => schedule(durSeconds), 250);
        return;
      }
      scheduled = true;
      const totalMs = (Math.max(0, Number(durSeconds) || 0) + autoDelaySeconds) * 1000;
      const elapsed = Date.now() - startedAt;
      const waitSec = Math.max(0.5, (totalMs - elapsed) / 1000);
      log('auto-continue: mp3=' + (Number(durSeconds) || 0).toFixed(1) +
        's + ' + autoDelaySeconds + 's delay, arming in ' + waitSec.toFixed(1) + 's');
      startResponseTimer(waitSec);
    };

    // Ask for the buttons right away — they can be pressed while speaking.
    void fetchSuggestions();

    if (data.audio) {
      log('mp3 received (' + data.audio.length + ' base64 chars)');
      playAudio(data.audio, data.audio_mime || 'audio/mpeg', () => {
        log('mp3 finished playing');
        // Fallback in case the duration metadata never arrived.
        schedule(0);
      }, (dur) => schedule(dur));
    } else {
      log('no mp3 in reply (voice muted or TTS failed)');
      schedule(0);
    }
  }

  // ---- Composer + events -----------------------------------------------------
  function sendMessage() {
    const text = el.inputMessage.value.trim();
    if (!text) return;
    el.inputMessage.value = '';
    autosizeInput();
    if (handleLocalCommand(text)) return;
    void sendText(text, 'typed');
  }

  function autosizeInput() {
    const ta = el.inputMessage;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }

  if (el.btnSend) el.btnSend.addEventListener('click', sendMessage);

  if (el.inputMessage) {
    el.inputMessage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // While the user types, any suggestion buttons (and the auto-continue
    // timer) disappear so they never fight the user.
    el.inputMessage.addEventListener('input', () => {
      autosizeInput();
      if (suggestionButtons.length > 0) {
        log('user is typing — making the buttons disappear');
        clearSuggestions();
      }
    });
  }

  if (el.btnVoice) {
    el.btnVoice.addEventListener('click', async () => {
      try {
        await setVoicePref(!voiceOn);
      } catch (e) {
        alert(e.message);
      }
    });
  }

  autosizeInput();

  // ---- Init ----------------------------------------------------------------
  (async function init() {
    loadSessionPrefs();
    log('Vivid Mistress loading…');
    try {
      const data = await api('/api/session');
      state.conv = data.conversation;
      state.convId = state.conv.id;
      if (data.role) setRole(data.role);
      renderMessages(state.conv.messages);
      await loadVoice();
      if (el.inputMessage) el.inputMessage.focus();
      log('session ready: conversation=' + state.convId + ' messages=' + ((state.conv.messages || []).length));
    } catch (e) {
      errorLog('init failed — is the server running?', e.message);
      appendMessage('assistant', 'Could not start a session: ' + e.message, { error: true });
    }
  })();
})();





