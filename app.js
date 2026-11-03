(function () {
  'use strict';

  const MAX_USERS = 10;
  const STORAGE_KEYS = {
    CURRENT_USER: 'wm2000_current_user_v1',
    USERS_DB: 'wm2000_users_db_v1',
    GAS_URL: 'wm2000_gas_url_v1',
    GH_SYNC: 'wm2000_gh_sync_v1',
    THEME: 'wm2000_theme_v1',
    TUTORIAL_DONE: 'wm2000_tutorial_done_v1'
  };

  // 전체 2,000단어 플랫 리스트 및 Day 맵 준비
  const RAW_DATA = window.WORDMASTER_2000 || {};
  const ALL_WORDS = [];
  for (let d = 1; d <= 50; d++) {
    const list = RAW_DATA[String(d)] || [];
    list.forEach((w) => ALL_WORDS.push(w));
  }
  const WORD_BY_ID = new Map(ALL_WORDS.map((w) => [w.id, w]));

  // 앱 상태
  const state = {
    user: null, // { email, name, picture, userSheetUrl, slot }
    usersDb: {}, // { [email]: { email, name, userSheetUrl, known: [], unknown: [], lastDay: '1', lastIdx: 0, updatedAt } }
    currentDay: '1', // '1'~'50', 'ALL', 'UNKNOWN', 'KNOWN'
    deck: [],
    currentIndex: 0,
    isShuffled: false,
    autoSpeak: true,
    autoPlayTimer: null,
    blindMode: 'none', // 'none' | 'ko' | 'en'
    tempRevealed: false,
    mode: 'study', // 'study' | 'quiz'
    quiz: {
      scope: 'current', // 'current' | 'all' | 'unknown'
      dir: 'en2ko', // 'en2ko' | 'ko2en'
      correct: 0,
      total: 0,
      streak: 0,
      currentWord: null,
      options: [],
      locked: false
    }
  };

  // DOM 요소
  const el = {
    daySelect: document.getElementById('daySelect'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    autoSpeakBtn: document.getElementById('autoSpeakBtn'),
    autoPlayBtn: document.getElementById('autoPlayBtn'),
    accountBtn: document.getElementById('accountBtn'),
    syncDot: document.getElementById('syncDot'),
    helpBtn: document.getElementById('helpBtn'),
    tabStudy: document.getElementById('tabStudy'),
    tabQuiz: document.getElementById('tabQuiz'),
    studyPanel: document.getElementById('studyPanel'),
    quizPanel: document.getElementById('quizPanel'),
    cardCounter: document.getElementById('cardCounter'),
    knownCountBadge: document.getElementById('knownCountBadge'),
    unknownCountBadge: document.getElementById('unknownCountBadge'),
    wordCard: document.getElementById('wordCard'),
    cardDayLabel: document.getElementById('cardDayLabel'),
    cardStatusTag: document.getElementById('cardStatusTag'),
    enWordText: document.getElementById('enWordText'),
    speakWordBtn: document.getElementById('speakWordBtn'),
    koMeaningText: document.getElementById('koMeaningText'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    markUnknownBtn: document.getElementById('markUnknownBtn'),
    markKnownBtn: document.getElementById('markKnownBtn'),
    quizScoreText: document.getElementById('quizScoreText'),
    quizStreakBadge: document.getElementById('quizStreakBadge'),
    quizScopeCurrent: document.getElementById('quizScopeCurrent'),
    quizScopeAll: document.getElementById('quizScopeAll'),
    quizScopeUnknown: document.getElementById('quizScopeUnknown'),
    quizDirBtn: document.getElementById('quizDirBtn'),
    quizMetaDay: document.getElementById('quizMetaDay'),
    quizSpeakBtn: document.getElementById('quizSpeakBtn'),
    quizPromptText: document.getElementById('quizPromptText'),
    quizOptionsBox: document.getElementById('quizOptionsBox'),
    quizSkipBtn: document.getElementById('quizSkipBtn'),
    quizResetBtn: document.getElementById('quizResetBtn'),
    loginModal: document.getElementById('loginModal'),
    loginNameInput: document.getElementById('loginNameInput'),
    loginEmailInput: document.getElementById('loginEmailInput'),
    loginPersonalSheetInput: document.getElementById('loginPersonalSheetInput'),
    loginSubmitBtn: document.getElementById('loginSubmitBtn'),
    accountModal: document.getElementById('accountModal'),
    closeAccountModal: document.getElementById('closeAccountModal'),
    accUserName: document.getElementById('accUserName'),
    accUserEmail: document.getElementById('accUserEmail'),
    accTotalStats: document.getElementById('accTotalStats'),
    accSyncStatus: document.getElementById('accSyncStatus'),
    openMySheetBtn: document.getElementById('openMySheetBtn'),
    syncNowBtn: document.getElementById('syncNowBtn'),
    userCountLabel: document.getElementById('userCountLabel'),
    userSlotList: document.getElementById('userSlotList'),
    copyInviteLinkBtn: document.getElementById('copyInviteLinkBtn'),
    gasUrlInput: document.getElementById('gasUrlInput'),
    saveGasUrlBtn: document.getElementById('saveGasUrlBtn'),
    copyGasCodeBtn: document.getElementById('copyGasCodeBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    tutorialModal: document.getElementById('tutorialModal'),
    closeTutorialModal: document.getElementById('closeTutorialModal'),
    startFromTutorialBtn: document.getElementById('startFromTutorialBtn'),
    toastMsg: document.getElementById('toastMsg')
  };

  let toastTimer = null;
  function showToast(msg) {
    if (!el.toastMsg) return;
    el.toastMsg.textContent = msg;
    el.toastMsg.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toastMsg.classList.add('hidden');
    }, 2200);
  }

  // URL 해시(#ghSync=..., #sheetSync=...) 파싱 및 자동 저장
  function parseUrlHashConfig() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const params = new URLSearchParams(hash.slice(1));
    let updated = false;
    if (params.get('ghSync')) {
      try {
        const decoded = atob(params.get('ghSync'));
        localStorage.setItem(STORAGE_KEYS.GH_SYNC, decoded);
        updated = true;
      } catch (e) {}
    }
    if (params.get('sheetSync')) {
      try {
        const sheetUrl = decodeURIComponent(params.get('sheetSync'));
        localStorage.setItem(STORAGE_KEYS.GAS_URL, sheetUrl);
        updated = true;
      } catch (e) {}
    }
    if (updated) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showToast('🔗 클라우드 & 구글시트 연동 설정이 자동 적용되었습니다!');
    }
  }

  // 원어민 발음 재생 (Web Speech API + 모바일 폴백)
  function speakEnglish(wordText) {
    if (!wordText) return;
    const cleanWord = String(wordText).trim();
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanWord);
        utter.lang = 'en-US';
        utter.rate = 0.92;
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find(
          (v) => v.lang && (v.lang.includes('en-US') || v.lang.includes('en_US')) && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Natural'))
        ) || voices.find((v) => v.lang && v.lang.startsWith('en'));
        if (enVoice) utter.voice = enVoice;
        window.speechSynthesis.speak(utter);
        return;
      }
    } catch (e) {}
    try {
      const audio = new Audio(
        'https://translate.googleapis.com/translate_tts?ie=UTF-8&q=' +
          encodeURIComponent(cleanWord) +
          '&tl=en&client=tw-ob'
      );
      audio.play().catch(() => {});
    } catch (e) {}
  }

  // 현재 사용자의 데이터 객체 반환
  function getCurrentUserRecord() {
    if (!state.user || !state.user.email) {
      return {
        email: 'guest@gmail.com',
        name: '학습자',
        userSheetUrl: '',
        known: [],
        unknown: [],
        lastDay: '1',
        lastIdx: 0,
        updatedAt: new Date().toISOString()
      };
    }
    const email = state.user.email.toLowerCase();
    if (!state.usersDb[email]) {
      state.usersDb[email] = {
        email: email,
        name: state.user.name || email.split('@')[0],
        userSheetUrl: state.user.userSheetUrl || '',
        known: [],
        unknown: [],
        lastDay: '1',
        lastIdx: 0,
        updatedAt: new Date().toISOString()
      };
    }
    return state.usersDb[email];
  }

  function saveLocalDb() {
    const rec = getCurrentUserRecord();
    rec.lastDay = state.currentDay;
    rec.lastIdx = state.currentIndex;
    rec.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.USERS_DB, JSON.stringify(state.usersDb));
    if (state.user) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(state.user));
    }
  }

  // Day 선택 드롭다운 렌더링
  function renderDaySelect() {
    const rec = getCurrentUserRecord();
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);
    const prevVal = state.currentDay || '1';

    let html = '';
    html += `<option value="UNKNOWN">❌ 몰라요 단어장 (${unknownSet.size}개)</option>`;
    html += `<option value="ALL">🌎 전체 2,000단어 (⭕${knownSet.size})</option>`;
    for (let d = 1; d <= 50; d++) {
      const key = String(d);
      const dayWords = RAW_DATA[key] || [];
      let kCnt = 0;
      dayWords.forEach((w) => {
        if (knownSet.has(w.id)) kCnt++;
      });
      const padD = String(d).padStart(2, '0');
      const checkMark = kCnt === dayWords.length && dayWords.length > 0 ? ' ✅' : ` (${kCnt}/${dayWords.length})`;
      html += `<option value="${key}">Day ${padD}${checkMark}</option>`;
    }
    html += `<option value="KNOWN">⭕ 알아요 단어장 (${knownSet.size}개)</option>`;

    el.daySelect.innerHTML = html;
    el.daySelect.value = prevVal;
    if (!el.daySelect.value) {
      el.daySelect.value = '1';
      state.currentDay = '1';
    }
  }

  // 선택된 Day 또는 필터로 덱 구성
  function loadDeck(dayKey, keepIndex) {
    state.currentDay = dayKey;
    const rec = getCurrentUserRecord();
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);

    let list = [];
    if (dayKey === 'ALL') {
      list = ALL_WORDS.slice();
    } else if (dayKey === 'UNKNOWN') {
      list = ALL_WORDS.filter((w) => unknownSet.has(w.id));
      if (list.length === 0) {
        showToast('현재 ❌ 몰라요로 표시된 단어가 없어 Day 01로 이동합니다.');
        state.currentDay = '1';
        el.daySelect.value = '1';
        list = (RAW_DATA['1'] || []).slice();
      }
    } else if (dayKey === 'KNOWN') {
      list = ALL_WORDS.filter((w) => knownSet.has(w.id));
      if (list.length === 0) {
        showToast('현재 ⭕ 알아요로 표시된 단어가 없어 Day 01로 이동합니다.');
        state.currentDay = '1';
        el.daySelect.value = '1';
        list = (RAW_DATA['1'] || []).slice();
      }
    } else {
      list = (RAW_DATA[dayKey] || []).slice();
    }

    if (state.isShuffled) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }

    state.deck = list;
    if (!keepIndex || state.currentIndex >= list.length) {
      state.currentIndex = 0;
    }
    state.tempRevealed = false;
    renderStudyCard(true);
    saveLocalDb();
  }

  // 학습 카드 렌더링
  function renderStudyCard(triggerAutoSpeak) {
    if (!state.deck || state.deck.length === 0) return;
    const word = state.deck[state.currentIndex];
    if (!word) return;

    const rec = getCurrentUserRecord();
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);

    // 현재 덱 내 O/X 카운트
    let deckKnown = 0;
    let deckUnknown = 0;
    state.deck.forEach((w) => {
      if (knownSet.has(w.id)) deckKnown++;
      if (unknownSet.has(w.id)) deckUnknown++;
    });

    el.cardCounter.textContent = `${state.currentIndex + 1} / ${state.deck.length}`;
    el.knownCountBadge.textContent = `⭕ ${deckKnown}`;
    el.unknownCountBadge.textContent = `❌ ${deckUnknown}`;

    el.cardDayLabel.textContent = `Day ${String(word.day).padStart(2, '0')} · #${String(word.id).padStart(4, '0')}`;

    el.wordCard.classList.remove('status-known', 'status-unknown');
    el.cardStatusTag.className = 'word-status-tag';
    if (knownSet.has(word.id)) {
      el.wordCard.classList.add('status-known');
      el.cardStatusTag.classList.add('known');
      el.cardStatusTag.textContent = '⭕ 알아요';
    } else if (unknownSet.has(word.id)) {
      el.wordCard.classList.add('status-unknown');
      el.cardStatusTag.classList.add('unknown');
      el.cardStatusTag.textContent = '❌ 몰라요';
    } else {
      el.cardStatusTag.textContent = '미분류';
    }

    el.enWordText.textContent = word.en;
    el.koMeaningText.textContent = word.ko;

    // 가림판 처리
    const hideEn = state.blindMode === 'en' && !state.tempRevealed;
    const hideKo = state.blindMode === 'ko' && !state.tempRevealed;
    el.enWordText.classList.toggle('masked-blur', hideEn);
    el.koMeaningText.classList.toggle('masked-blur', hideKo);

    if (triggerAutoSpeak && state.autoSpeak && state.mode === 'study') {
      speakEnglish(word.en);
    }
  }

  function moveCard(delta) {
    if (!state.deck.length) return;
    state.currentIndex = (state.currentIndex + delta + state.deck.length) % state.deck.length;
    state.tempRevealed = false;
    renderStudyCard(true);
    saveLocalDb();
  }

  function markCurrentWord(isKnown) {
    if (!state.deck.length) return;
    const word = state.deck[state.currentIndex];
    const rec = getCurrentUserRecord();
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);

    if (isKnown) {
      knownSet.add(word.id);
      unknownSet.delete(word.id);
    } else {
      unknownSet.add(word.id);
      knownSet.delete(word.id);
    }

    rec.known = Array.from(knownSet);
    rec.unknown = Array.from(unknownSet);
    renderDaySelect();
    moveCard(1);
    scheduleCloudSync();
  }

  // 연속 자동 재생 (오디오 모드)
  function toggleAutoPlay() {
    if (state.autoPlayTimer) {
      clearInterval(state.autoPlayTimer);
      state.autoPlayTimer = null;
      el.autoPlayBtn.classList.remove('active');
      el.autoPlayBtn.textContent = '▶ 연속';
      showToast('⏹ 연속 자동 듣기를 멈췄습니다.');
    } else {
      el.autoPlayBtn.classList.add('active');
      el.autoPlayBtn.textContent = '⏸ 정지';
      showToast('🎧 2.5초 간격으로 발음하며 자동 넘김됩니다.');
      const word = state.deck[state.currentIndex];
      if (word) speakEnglish(word.en);
      state.autoPlayTimer = setInterval(() => {
        moveCard(1);
      }, 2500);
    }
  }

  // 무작위 테스트 (Random Quiz) 로직
  function getQuizPool() {
    const rec = getCurrentUserRecord();
    const unknownSet = new Set(rec.unknown || []);
    if (state.quiz.scope === 'unknown') {
      const pool = ALL_WORDS.filter((w) => unknownSet.has(w.id));
      if (pool.length >= 4) return pool;
      showToast('❌ 몰라요 단어가 4개 미만이어서 현재 Day 범위로 출제합니다.');
      state.quiz.scope = 'current';
      updateQuizScopeButtons();
    }
    if (state.quiz.scope === 'all') {
      return ALL_WORDS;
    }
    return state.deck.length >= 4 ? state.deck : ALL_WORDS;
  }

  function updateQuizScopeButtons() {
    el.quizScopeCurrent.classList.toggle('active', state.quiz.scope === 'current');
    el.quizScopeAll.classList.toggle('active', state.quiz.scope === 'all');
    el.quizScopeUnknown.classList.toggle('active', state.quiz.scope === 'unknown');
    el.quizDirBtn.textContent = state.quiz.dir === 'en2ko' ? '영➔한' : '한➔영';
  }

  function nextQuizQuestion() {
    state.quiz.locked = false;
    const pool = getQuizPool();
    const answer = pool[Math.floor(Math.random() * pool.length)];
    state.quiz.currentWord = answer;

    // 오답 보기 3개 추출
    const distractors = [];
    const usedIds = new Set([answer.id]);
    while (distractors.length < 3) {
      const cand = ALL_WORDS[Math.floor(Math.random() * ALL_WORDS.length)];
      if (!usedIds.has(cand.id) && cand.ko !== answer.ko) {
        usedIds.add(cand.id);
        distractors.push(cand);
      }
    }

    const options = [answer, ...distractors];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    state.quiz.options = options;

    el.quizMetaDay.textContent = `Day ${String(answer.day).padStart(2, '0')} · #${String(answer.id).padStart(4, '0')}`;
    el.quizPromptText.textContent = state.quiz.dir === 'en2ko' ? answer.en : answer.ko;

    el.quizOptionsBox.innerHTML = '';
    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-opt-btn';
      const label = state.quiz.dir === 'en2ko' ? opt.ko : opt.en;
      btn.innerHTML = `<span class="quiz-opt-num">${idx + 1}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>`;
      btn.addEventListener('click', () => handleQuizAnswer(opt, btn));
      el.quizOptionsBox.appendChild(btn);
    });

    if (state.autoSpeak && state.quiz.dir === 'en2ko') {
      speakEnglish(answer.en);
    }
  }

  function handleQuizAnswer(selectedOpt, clickedBtn) {
    if (state.quiz.locked) return;
    state.quiz.locked = true;
    const answer = state.quiz.currentWord;
    const isCorrect = selectedOpt && selectedOpt.id === answer.id;

    state.quiz.total++;
    const rec = getCurrentUserRecord();
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);

    const buttons = el.quizOptionsBox.querySelectorAll('.quiz-opt-btn');
    buttons.forEach((b, i) => {
      if (state.quiz.options[i].id === answer.id) {
        b.classList.add('correct');
      }
    });

    if (isCorrect) {
      state.quiz.correct++;
      state.quiz.streak++;
      knownSet.add(answer.id);
      unknownSet.delete(answer.id);
    } else {
      if (clickedBtn) clickedBtn.classList.add('wrong');
      state.quiz.streak = 0;
      unknownSet.add(answer.id);
      knownSet.delete(answer.id);
    }

    if (state.quiz.dir === 'ko2en' && state.autoSpeak) {
      speakEnglish(answer.en);
    }

    rec.known = Array.from(knownSet);
    rec.unknown = Array.from(unknownSet);
    el.quizScoreText.textContent = `정답 ${state.quiz.correct} / ${state.quiz.total}`;
    el.quizStreakBadge.textContent = `🔥 ${state.quiz.streak}연속`;
    renderDaySelect();
    saveLocalDb();
    scheduleCloudSync();

    setTimeout(() => {
      nextQuizQuestion();
    }, isCorrect ? 550 : 1100);
  }

  // 구글 로그인 & 최대 10명 계정 관리
  function performLogin(emailRaw, nameRaw, personalSheetRaw, pictureUrl) {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      showToast('올바른 구글 이메일 주소를 입력해 주세요.');
      return false;
    }
    const name = String(nameRaw || email.split('@')[0]).trim();
    const existingEmails = Object.keys(state.usersDb);
    if (!state.usersDb[email] && existingEmails.length >= MAX_USERS) {
      showToast(`⚠️ 최대 접속 인원(${MAX_USERS}명)이 초과되었습니다.`);
      return false;
    }

    if (!state.usersDb[email]) {
      state.usersDb[email] = {
        email: email,
        name: name,
        userSheetUrl: personalSheetRaw || '',
        known: [],
        unknown: [],
        lastDay: '1',
        lastIdx: 0,
        updatedAt: new Date().toISOString()
      };
    } else {
      state.usersDb[email].name = name || state.usersDb[email].name;
      if (personalSheetRaw) {
        state.usersDb[email].userSheetUrl = personalSheetRaw;
      }
    }

    state.user = {
      email: email,
      name: state.usersDb[email].name,
      picture: pictureUrl || '',
      userSheetUrl: state.usersDb[email].userSheetUrl || ''
    };

    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(state.user));
    localStorage.setItem(STORAGE_KEYS.USERS_DB, JSON.stringify(state.usersDb));

    el.loginModal.classList.add('hidden');

    const rec = getCurrentUserRecord();
    state.currentDay = rec.lastDay || '1';
    renderDaySelect();
    loadDeck(state.currentDay, false);
    state.currentIndex = Math.min(rec.lastIdx || 0, Math.max(0, state.deck.length - 1));
    renderStudyCard(false);

    showToast(`👋 ${state.user.name}님 자동로그인 설정 완료!`);
    syncAllClouds(false);

    // 처음 접속한 경우 튜토리얼 표시 여부 체크
    if (!localStorage.getItem(STORAGE_KEYS.TUTORIAL_DONE)) {
      el.tutorialModal.classList.remove('hidden');
      localStorage.setItem(STORAGE_KEYS.TUTORIAL_DONE, '1');
    }
    return true;
  }

  // Google Identity Services JWT 디코딩 (공식 구글 버튼 연동용)
  window.handleGoogleCredentialResponse = function (response) {
    try {
      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(decodeURIComponent(escape(window.atob(base64))));
      if (payload && payload.email) {
        performLogin(payload.email, payload.name || payload.given_name, '', payload.picture);
      }
    } catch (e) {
      showToast('구글 인증 정보를 읽는 중 오류가 발생했습니다.');
    }
  };

  // 클라우드 동기화 (1. 내 구글시트 Apps Script + 2. GitHub db-store 브랜치)
  let syncTimeout = null;
  function scheduleCloudSync() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      syncAllClouds(true);
    }, 1200);
  }

  async function syncAllClouds(silent) {
    if (!state.user) return;
    const rec = getCurrentUserRecord();
    const unknownDetails = (rec.unknown || [])
      .map((id) => WORD_BY_ID.get(id))
      .filter(Boolean);

    // 1) 구글 시트 (Apps Script 웹앱 URL) 동기화
    const gasUrl = localStorage.getItem(STORAGE_KEYS.GAS_URL) || '';
    if (gasUrl && gasUrl.startsWith('https://script.google.com/')) {
      try {
        const res = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'save',
            email: state.user.email,
            name: state.user.name,
            payload: {
              known: rec.known,
              unknown: rec.unknown,
              unknownDetails: unknownDetails,
              lastDay: state.currentDay,
              lastIdx: state.currentIndex,
              updatedAt: new Date().toISOString()
            }
          })
        });
        const data = await res.json();
        if (data && data.ok) {
          if (data.userSheetUrl) {
            state.user.userSheetUrl = data.userSheetUrl;
            rec.userSheetUrl = data.userSheetUrl;
            saveLocalDb();
          }
          if (!silent) showToast('📊 내 전용 구글시트와 실시간 동기화 완료!');
        } else if (data && data.error && !silent) {
          showToast(data.error);
        }
      } catch (e) {}
    }

    // 2) GitHub db-store 브랜치 실시간 동기화 (최대 10명 프로필 통합 동기화)
    const ghRaw = localStorage.getItem(STORAGE_KEYS.GH_SYNC);
    if (ghRaw) {
      try {
        const cfg = JSON.parse(ghRaw);
        if (cfg && cfg.token && cfg.repo) {
          const apiUrl = `https://api.github.com/repos/${cfg.repo}/contents/users_db.json?ref=db-store`;
          const getRes = await fetch(apiUrl, {
            headers: {
              Authorization: `token ${cfg.token}`,
              Accept: 'application/vnd.github.v3+json'
            }
          });
          let sha = null;
          let remoteUsers = {};
          if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
            const contentStr = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
            const parsed = JSON.parse(contentStr);
            remoteUsers = parsed.users || {};
          }

          // 10명 제한 병합
          const mergedEmails = new Set([...Object.keys(remoteUsers), ...Object.keys(state.usersDb)]);
          const finalUsers = {};
          Array.from(mergedEmails)
            .slice(0, MAX_USERS)
            .forEach((em) => {
              const rU = remoteUsers[em];
              const lU = state.usersDb[em];
              if (rU && lU) {
                finalUsers[em] = new Date(lU.updatedAt || 0) >= new Date(rU.updatedAt || 0) ? lU : rU;
              } else {
                finalUsers[em] = lU || rU;
              }
            });

          state.usersDb = finalUsers;
          saveLocalDb();

          const bodyPayload = {
            updatedAt: new Date().toISOString(),
            maxUsers: MAX_USERS,
            users: state.usersDb
          };
          const encodedContent = btoa(unescape(encodeURIComponent(JSON.stringify(bodyPayload, null, 2))));
          await fetch(`https://api.github.com/repos/${cfg.repo}/contents/users_db.json`, {
            method: 'PUT',
            headers: {
              Authorization: `token ${cfg.token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: `Sync WordMaster 2000 (${state.user.email})`,
              content: encodedContent,
              branch: 'db-store',
              ...(sha ? { sha } : {})
            })
          });
          if (!silent) showToast('☁️ 클라우드 DB 동기화 완료!');
        }
      } catch (e) {}
    }

    renderDaySelect();
    renderStudyCard(false);
  }

  // 계정 & 구글시트 모달 렌더링
  function openAccountModal() {
    const rec = getCurrentUserRecord();
    el.accUserName.textContent = state.user ? state.user.name : '미로그인';
    el.accUserEmail.textContent = state.user ? state.user.email : '-';
    el.accTotalStats.textContent = `⭕ 알아요 ${(rec.known || []).length}개 / ❌ 몰라요 ${(rec.unknown || []).length}개 (진도 Day ${String(state.currentDay).padStart(2, '0')})`;

    const gasUrl = localStorage.getItem(STORAGE_KEYS.GAS_URL) || rec.userSheetUrl || '';
    el.gasUrlInput.value = gasUrl;

    const usersArr = Object.values(state.usersDb).slice(0, MAX_USERS);
    el.userCountLabel.textContent = `${usersArr.length} / ${MAX_USERS}명`;
    el.userSlotList.innerHTML = '';
    usersArr.forEach((u, i) => {
      const div = document.createElement('div');
      div.className = 'user-slot-item';
      const isMe = state.user && u.email === state.user.email;
      div.innerHTML = `
        <span><strong>#${i + 1} ${u.name}</strong> (${u.email}) ${isMe ? '🟢' : ''}</span>
        <span>⭕${(u.known || []).length} · ❌${(u.unknown || []).length}</span>
      `;
      el.userSlotList.appendChild(div);
    });

    el.accountModal.classList.remove('hidden');
  }

  // 내 전용 구글 시트 바로 열기 (연결된 시트가 있으면 즉시 열고, 없으면 내 학습데이터를 복사한 뒤 새 구글시트 생성 페이지 오픈)
  function openMyPersonalGoogleSheet() {
    const rec = getCurrentUserRecord();
    const directSheetUrl = rec.userSheetUrl || localStorage.getItem(STORAGE_KEYS.GAS_URL) || '';
    if (directSheetUrl && directSheetUrl.includes('docs.google.com/spreadsheets')) {
      window.open(directSheetUrl, '_blank');
      return;
    }

    // 내 오답 & 암기 현황을 탭 구분(TSV)으로 클립보드에 자동 복사 후 새 구글시트(sheets.new) 열기
    const rows = [
      ['워드마스터 수능 2000 - 내 전용 단어장', state.user ? state.user.name : '', state.user ? state.user.email : '', new Date().toLocaleString('ko-KR')],
      ['단어번호', 'Day', '영단어', '한글뜻', '내 암기상태']
    ];
    const knownSet = new Set(rec.known || []);
    const unknownSet = new Set(rec.unknown || []);
    ALL_WORDS.forEach((w) => {
      const st = knownSet.has(w.id) ? '⭕ 알아요' : unknownSet.has(w.id) ? '❌ 몰라요' : '미학습';
      rows.push([w.id, `Day ${String(w.day).padStart(2, '0')}`, w.en, w.ko, st]);
    });
    const tsv = rows.map((r) => r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).catch(() => {});
    showToast('📊 내 2,000단어 기록이 복사되었습니다! 열리는 구글 시트 A1 칸에 붙여넣기(Ctrl+V) 하세요.');
    setTimeout(() => {
      window.open('https://sheets.new', '_blank');
    }, 600);
  }

  // 이벤트 바인딩
  function bindEvents() {
    el.daySelect.addEventListener('change', (e) => {
      loadDeck(e.target.value, false);
      if (state.mode === 'quiz') nextQuizQuestion();
    });

    el.shuffleBtn.addEventListener('click', () => {
      state.isShuffled = !state.isShuffled;
      el.shuffleBtn.classList.toggle('active', state.isShuffled);
      loadDeck(state.currentDay, false);
      showToast(state.isShuffled ? '🔀 단어 순서를 무작위로 섞었습니다.' : '🔢 원래 번호 순서로 정렬했습니다.');
    });

    el.autoSpeakBtn.addEventListener('click', () => {
      state.autoSpeak = !state.autoSpeak;
      el.autoSpeakBtn.classList.toggle('active', state.autoSpeak);
      showToast(state.autoSpeak ? '🔊 자동 발음 듣기 ON' : '🔇 자동 발음 듣기 OFF');
    });

    el.autoPlayBtn.addEventListener('click', toggleAutoPlay);

    // 모드 탭 전환
    el.tabStudy.addEventListener('click', () => {
      state.mode = 'study';
      el.tabStudy.classList.add('active');
      el.tabQuiz.classList.remove('active');
      el.studyPanel.classList.remove('hidden');
      el.quizPanel.classList.add('hidden');
      renderStudyCard(false);
    });

    el.tabQuiz.addEventListener('click', () => {
      if (state.autoPlayTimer) toggleAutoPlay();
      state.mode = 'quiz';
      el.tabQuiz.classList.add('active');
      el.tabStudy.classList.remove('active');
      el.quizPanel.classList.remove('hidden');
      el.studyPanel.classList.add('hidden');
      updateQuizScopeButtons();
      nextQuizQuestion();
    });

    // 가림판 버튼
    document.querySelectorAll('[data-blind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.blindMode = btn.getAttribute('data-blind');
        state.tempRevealed = false;
        document.querySelectorAll('[data-blind]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderStudyCard(false);
      });
    });

    // 카드 클릭 & 발음 버튼
    el.speakWordBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const word = state.deck[state.currentIndex];
      if (word) speakEnglish(word.en);
    });

    el.wordCard.addEventListener('click', () => {
      const word = state.deck[state.currentIndex];
      if (!word) return;
      if (state.blindMode !== 'none') {
        state.tempRevealed = !state.tempRevealed;
        renderStudyCard(false);
      }
      speakEnglish(word.en);
    });

    // 터치 스와이프 제스처
    let touchStartX = 0;
    let touchStartY = 0;
    el.wordCard.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    el.wordCard.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].screenX - touchStartX;
      const dy = e.changedTouches[0].screenY - touchStartY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) moveCard(1);
        else moveCard(-1);
      }
    }, { passive: true });

    // 하단 4버튼
    el.prevBtn.addEventListener('click', () => moveCard(-1));
    el.nextBtn.addEventListener('click', () => moveCard(1));
    el.markUnknownBtn.addEventListener('click', () => markCurrentWord(false));
    el.markKnownBtn.addEventListener('click', () => markCurrentWord(true));

    // 키보드 단축키 지원
    window.addEventListener('keydown', (e) => {
      if (!el.loginModal.classList.contains('hidden') || !el.accountModal.classList.contains('hidden')) return;
      if (state.mode === 'study') {
        if (e.key === 'ArrowRight') moveCard(1);
        else if (e.key === 'ArrowLeft') moveCard(-1);
        else if (e.key === ' ') {
          e.preventDefault();
          const w = state.deck[state.currentIndex];
          if (w) speakEnglish(w.en);
        }
      } else if (state.mode === 'quiz') {
        if (['1', '2', '3', '4'].includes(e.key)) {
          const idx = Number(e.key) - 1;
          const btns = el.quizOptionsBox.querySelectorAll('.quiz-opt-btn');
          if (btns[idx]) btns[idx].click();
        }
      }
    });

    // 테스트 옵션 버튼
    el.quizScopeCurrent.addEventListener('click', () => {
      state.quiz.scope = 'current';
      updateQuizScopeButtons();
      nextQuizQuestion();
    });
    el.quizScopeAll.addEventListener('click', () => {
      state.quiz.scope = 'all';
      updateQuizScopeButtons();
      nextQuizQuestion();
    });
    el.quizScopeUnknown.addEventListener('click', () => {
      state.quiz.scope = 'unknown';
      updateQuizScopeButtons();
      nextQuizQuestion();
    });
    el.quizDirBtn.addEventListener('click', () => {
      state.quiz.dir = state.quiz.dir === 'en2ko' ? 'ko2en' : 'en2ko';
      updateQuizScopeButtons();
      nextQuizQuestion();
    });
    el.quizSpeakBtn.addEventListener('click', () => {
      if (state.quiz.currentWord) speakEnglish(state.quiz.currentWord.en);
    });
    el.quizSkipBtn.addEventListener('click', () => {
      if (state.quiz.currentWord) {
        handleQuizAnswer({ id: -1 }, null);
      }
    });
    el.quizResetBtn.addEventListener('click', () => {
      state.quiz.correct = 0;
      state.quiz.total = 0;
      state.quiz.streak = 0;
      el.quizScoreText.textContent = '정답 0 / 0';
      el.quizStreakBadge.textContent = '🔥 0연속';
      nextQuizQuestion();
      showToast('🔄 테스트 점수를 초기화했습니다.');
    });

    // 로그인 및 계정 모달
    el.loginSubmitBtn.addEventListener('click', () => {
      performLogin(
        el.loginEmailInput.value,
        el.loginNameInput.value,
        el.loginPersonalSheetInput.value
      );
    });

    el.accountBtn.addEventListener('click', openAccountModal);
    el.closeAccountModal.addEventListener('click', () => el.accountModal.classList.add('hidden'));
    el.openMySheetBtn.addEventListener('click', openMyPersonalGoogleSheet);
    el.syncNowBtn.addEventListener('click', () => syncAllClouds(false));

    el.saveGasUrlBtn.addEventListener('click', () => {
      const val = el.gasUrlInput.value.trim();
      localStorage.setItem(STORAGE_KEYS.GAS_URL, val);
      const rec = getCurrentUserRecord();
      if (val.includes('docs.google.com/spreadsheets')) {
        rec.userSheetUrl = val;
        if (state.user) state.user.userSheetUrl = val;
        saveLocalDb();
      }
      showToast('💾 구글 시트 연동 주소가 저장되었습니다.');
      syncAllClouds(false);
    });

    el.copyGasCodeBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('./google_apps_script.gs');
        const code = await res.text();
        await navigator.clipboard.writeText(code);
        showToast('📋 구글시트 10인 자동생성 스크립트가 복사되었습니다!');
      } catch (e) {
        showToast('스크립트 파일을 복사했습니다.');
      }
    });

    el.copyInviteLinkBtn.addEventListener('click', () => {
      const baseUrl = window.location.origin + window.location.pathname;
      const hashParts = [];
      const ghRaw = localStorage.getItem(STORAGE_KEYS.GH_SYNC);
      if (ghRaw) hashParts.push('ghSync=' + encodeURIComponent(btoa(ghRaw)));
      const gasUrl = localStorage.getItem(STORAGE_KEYS.GAS_URL);
      if (gasUrl) hashParts.push('sheetSync=' + encodeURIComponent(gasUrl));
      const fullLink = hashParts.length ? `${baseUrl}#${hashParts.join('&')}` : baseUrl;
      navigator.clipboard.writeText(fullLink).then(() => {
        showToast('🔗 10인 접속용 원클릭 초대 링크가 복사되었습니다! 카톡에 붙여넣으세요.');
      });
    });

    el.themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEYS.THEME, next);
    });

    el.logoutBtn.addEventListener('click', () => {
      el.accountModal.classList.add('hidden');
      el.loginEmailInput.value = state.user ? state.user.email : '';
      el.loginNameInput.value = state.user ? state.user.name : '';
      el.loginPersonalSheetInput.value = state.user ? state.user.userSheetUrl || '' : '';
      el.loginModal.classList.remove('hidden');
    });

    // 튜토리얼 모달
    el.helpBtn.addEventListener('click', () => el.tutorialModal.classList.remove('hidden'));
    el.closeTutorialModal.addEventListener('click', () => el.tutorialModal.classList.add('hidden'));
    el.startFromTutorialBtn.addEventListener('click', () => el.tutorialModal.classList.add('hidden'));
  }

  // 앱 초기화 (자동 로그인 점검)
  function initApp() {
    parseUrlHashConfig();

    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    try {
      const savedDb = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS_DB) || '{}');
      state.usersDb = savedDb || {};
    } catch (e) {
      state.usersDb = {};
    }

    bindEvents();

    // 저장된 구글 로그인 세션 확인 (1회 로그인 후 영구 자동 로그인)
    let savedUser = null;
    try {
      savedUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_USER) || 'null');
    } catch (e) {
      savedUser = null;
    }

    if (savedUser && savedUser.email) {
      state.user = savedUser;
      const rec = getCurrentUserRecord();
      state.currentDay = rec.lastDay || '1';
      renderDaySelect();
      loadDeck(state.currentDay, false);
      state.currentIndex = Math.min(rec.lastIdx || 0, Math.max(0, state.deck.length - 1));
      renderStudyCard(false);
      syncAllClouds(true);
    } else {
      renderDaySelect();
      loadDeck('1', false);
      el.loginModal.classList.remove('hidden');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  initApp();
})();
