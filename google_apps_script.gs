/**
 * 워드마스터 수능 2000 - 구글 계정 로그인(최대 10인) & 개인별 전용 구글 시트 자동 생성/동기화 스크립트
 * 사용법:
 * 1. https://script.google.com 접속 -> [새 프로젝트] 클릭
 * 2. 아래 코드를 전체 붙여넣기 후 상단 [배포] -> [새 배포] 클릭
 * 3. 유형: [웹 앱], 다음 사용자 인증 정보로 실행: [나], 액세스 권한이 있는 사용자: [모든 사용자]로 배포
 * 4. 발급된 웹 앱 URL을 워드마스터 2000 앱의 [구글시트 연동] 창에 붙여넣으면 10명 초대 링크가 완성됩니다!
 */

const MAX_USERS = 10;
const MASTER_PROP_KEY = 'WM2000_MASTER_SHEET_ID';

function getOrCreateMasterSheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty(MASTER_PROP_KEY);
  let ss = null;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('워드마스터2000_마스터관리(최대10인)');
    props.setProperty(MASTER_PROP_KEY, ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.setName('접속자명단_10인');
    sheet.appendRow(['순번', '구글이메일', '이름', '전용시트ID', '전용시트URL', '암기단어수(O)', '미암기단어수(X)', '최근학습Day', '최근접속일시', '학습데이터JSON']);
    sheet.getRange('A1:J1').setFontWeight('bold').setBackground('#dbeafe');
  }
  return ss;
}

function createPersonalUserSheet(email, name) {
  const userSs = SpreadsheetApp.create('워드마스터2000_' + name + '(' + email + ')');
  try {
    userSs.addEditor(email);
  } catch (e) {
    // 지메일 외 계정이거나 공유 알림 제한 시 무시하고 링크 권한 부여
  }
  const summarySheet = userSs.getActiveSheet();
  summarySheet.setName('내_학습현황');
  summarySheet.appendRow(['항목', '내용']);
  summarySheet.appendRow(['사용자 이름', name]);
  summarySheet.appendRow(['구글 계정', email]);
  summarySheet.appendRow(['현재 학습 Day', 'Day 01']);
  summarySheet.appendRow(['알아요(O) 단어 수', 0]);
  summarySheet.appendRow(['몰라요(X) 단어 수', 0]);
  summarySheet.appendRow(['최근 동기화 일시', new Date().toLocaleString('ko-KR')]);
  summarySheet.getRange('A1:B1').setFontWeight('bold').setBackground('#fef3c7');

  const wrongSheet = userSs.insertSheet('몰라요_오답단어장');
  wrongSheet.appendRow(['단어번호', 'Day', '영단어', '한글뜻', '상태']);
  wrongSheet.getRange('A1:E1').setFontWeight('bold').setBackground('#fee2e2');

  const dataSheet = userSs.insertSheet('동기화_원본DB');
  dataSheet.appendRow(['updatedAt', 'jsonPayload']);
  dataSheet.appendRow([new Date().toISOString(), '{}']);

  return {
    id: userSs.getId(),
    url: userSs.getUrl()
  };
}

function updatePersonalUserSheet(sheetId, payload) {
  if (!sheetId) return;
  try {
    const userSs = SpreadsheetApp.openById(sheetId);
    const summarySheet = userSs.getSheetByName('내_학습현황');
    if (summarySheet) {
      const knownCount = (payload.known || []).length;
      const unknownCount = (payload.unknown || []).length;
      summarySheet.getRange('B4').setValue('Day ' + String(payload.lastDay || 1).padStart(2, '0'));
      summarySheet.getRange('B5').setValue(knownCount);
      summarySheet.getRange('B6').setValue(unknownCount);
      summarySheet.getRange('B7').setValue(new Date().toLocaleString('ko-KR'));
    }
    const wrongSheet = userSs.getSheetByName('몰라요_오답단어장');
    if (wrongSheet && Array.isArray(payload.unknownDetails)) {
      wrongSheet.clearContents();
      const rows = [['단어번호', 'Day', '영단어', '한글뜻', '상태']];
      payload.unknownDetails.slice(0, 500).forEach(function(w) {
        rows.push([w.id, 'Day ' + String(w.day).padStart(2, '0'), w.en, w.ko, '몰라요(X)']);
      });
      wrongSheet.getRange(1, 1, rows.length, 5).setValues(rows);
    }
    const dataSheet = userSs.getSheetByName('동기화_원본DB');
    if (dataSheet) {
      dataSheet.getRange('A2:B2').setValues([[new Date().toISOString(), JSON.stringify(payload)]]);
    }
  } catch (e) {}
}

function handleRequest(params) {
  const ss = getOrCreateMasterSheet();
  const sheet = ss.getSheetByName('접속자명단_10인');
  const data = sheet.getDataRange().getValues();
  const action = params.action || 'loginAndLoad';
  const email = String(params.email || '').trim().toLowerCase();
  const name = String(params.name || email.split('@')[0] || '학습자').trim();

  if (!email) {
    return { ok: false, error: '구글 이메일 계정이 필요합니다.' };
  }

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === email) {
      rowIndex = i + 1;
      break;
    }
  }

  const currentUsersCount = Math.max(0, data.length - 1);

  if (rowIndex === -1) {
    if (currentUsersCount >= MAX_USERS) {
      return {
        ok: false,
        error: '접속 허용 인원(최대 10명)이 초과되었습니다. 관리자에게 문의하세요.',
        maxUsers: MAX_USERS,
        currentUsersCount: currentUsersCount
      };
    }
    const personal = createPersonalUserSheet(email, name);
    const initPayload = params.payload || { known: [], unknown: [], lastDay: '1', lastIdx: 0 };
    rowIndex = data.length + 1;
    sheet.appendRow([
      currentUsersCount + 1,
      email,
      name,
      personal.id,
      personal.url,
      (initPayload.known || []).length,
      (initPayload.unknown || []).length,
      initPayload.lastDay || '1',
      new Date().toLocaleString('ko-KR'),
      JSON.stringify(initPayload)
    ]);
    return {
      ok: true,
      isNew: true,
      email: email,
      name: name,
      userSheetId: personal.id,
      userSheetUrl: personal.url,
      masterSheetUrl: ss.getUrl(),
      slotNumber: currentUsersCount + 1,
      maxUsers: MAX_USERS,
      payload: initPayload
    };
  }

  const rowValues = sheet.getRange(rowIndex, 1, 1, 10).getValues()[0];
  let userSheetId = rowValues[3];
  let userSheetUrl = rowValues[4];
  if (!userSheetId) {
    const personal = createPersonalUserSheet(email, name);
    userSheetId = personal.id;
    userSheetUrl = personal.url;
    sheet.getRange(rowIndex, 4, 1, 2).setValues([[userSheetId, userSheetUrl]]);
  }

  if (action === 'save' && params.payload) {
    const p = params.payload;
    sheet.getRange(rowIndex, 3).setValue(name);
    sheet.getRange(rowIndex, 6).setValue((p.known || []).length);
    sheet.getRange(rowIndex, 7).setValue((p.unknown || []).length);
    sheet.getRange(rowIndex, 8).setValue(p.lastDay || '1');
    sheet.getRange(rowIndex, 9).setValue(new Date().toLocaleString('ko-KR'));
    sheet.getRange(rowIndex, 10).setValue(JSON.stringify(p));
    updatePersonalUserSheet(userSheetId, p);
    return {
      ok: true,
      email: email,
      name: name,
      userSheetId: userSheetId,
      userSheetUrl: userSheetUrl,
      masterSheetUrl: ss.getUrl(),
      slotNumber: rowValues[0],
      maxUsers: MAX_USERS,
      payload: p
    };
  }

  let savedPayload = {};
  try { savedPayload = JSON.parse(rowValues[9] || '{}'); } catch (e) { savedPayload = {}; }
  sheet.getRange(rowIndex, 9).setValue(new Date().toLocaleString('ko-KR'));

  const allUsers = [];
  const latestData = sheet.getDataRange().getValues();
  for (let i = 1; i < latestData.length; i++) {
    allUsers.push({
      slot: latestData[i][0],
      email: latestData[i][1],
      name: latestData[i][2],
      sheetUrl: latestData[i][4],
      knownCount: latestData[i][5],
      unknownCount: latestData[i][6],
      lastDay: latestData[i][7],
      lastSeen: latestData[i][8]
    });
  }

  return {
    ok: true,
    email: email,
    name: name,
    userSheetId: userSheetId,
    userSheetUrl: userSheetUrl,
    masterSheetUrl: ss.getUrl(),
    slotNumber: rowValues[0],
    maxUsers: MAX_USERS,
    usersList: allUsers,
    payload: savedPayload
  };
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (params.payload) {
    try { params.payload = JSON.parse(params.payload); } catch (err) {}
  }
  const res = handleRequest(params);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = (e && e.parameter) ? e.parameter : {};
  }
  const res = handleRequest(body);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}
